import { traceable } from 'langsmith/traceable';

import {
  buildTraceMetadata,
  buildTraceTags,
  detectInputFlags,
  getPreferredSingleToolAnswerFromToolCalls,
  persistConversationArtifacts
} from '../agent';
import type { AgentConversationStore } from '../stores';
import { logger } from '../utils';
import { synthesizeToolResults } from '../synthesis/tool-result-synthesizer';
import type {
  AgentChatResponse,
  AgentConversationMessage,
  AgentFeedbackMemory,
  AgentFeedbackMemoryProvider,
  AgentLlm,
  AgentTraceContext,
  AgentTraceStep,
  CreateOrderParams
} from '../types';
import { applyDomainConstraints } from '../verification/domain-constraints';
import { verifyClaimsAgainstToolEvidence } from '../verification/claim-verifier';
import { scoreConfidence } from '../verification/confidence-scorer';
import { validateOutput } from '../verification/output-validator';

export async function synthesizeAndFinalizeResponse({
  chatStartedAt,
  conversation,
  conversationId,
  conversationStore,
  draftCreateOrderParams,
  errors,
  feedbackMemoryProvider,
  intent,
  llm,
  llmConversation,
  message,
  previousState,
  routeDurationMs,
  selectedToolsCount,
  toolCalls,
  toolExecutionDurationMs,
  trace,
  traceContext
}: {
  chatStartedAt: number;
  conversation: AgentConversationMessage[];
  conversationId: string;
  conversationStore: AgentConversationStore;
  draftCreateOrderParams?: CreateOrderParams;
  errors: AgentChatResponse['errors'];
  feedbackMemoryProvider?: AgentFeedbackMemoryProvider;
  intent: 'finance' | 'general';
  llm?: AgentLlm;
  llmConversation: AgentConversationMessage[];
  message: string;
  previousState: Awaited<ReturnType<AgentConversationStore['getState']>>;
  routeDurationMs: number;
  selectedToolsCount: number;
  toolCalls: AgentChatResponse['toolCalls'];
  toolExecutionDurationMs: number;
  trace: AgentTraceStep[];
  traceContext: AgentTraceContext;
}): Promise<AgentChatResponse> {
  let feedbackMemory: AgentFeedbackMemory | undefined;
  if (feedbackMemoryProvider) {
    try {
      const toolSignature = toolCalls.map((call) => call.toolName).join('>');
      feedbackMemory = await feedbackMemoryProvider.getForToolSignature(toolSignature);
      if (feedbackMemory) {
        trace.push({
          type: 'tool',
          name: 'feedback_memory_lookup',
          output: {
            doCount: feedbackMemory.do.length,
            dontCount: feedbackMemory.dont.length,
            sources: feedbackMemory.sources,
            synthesisIssueCount: feedbackMemory.synthesisIssues.length,
            toolIssueCount: feedbackMemory.toolIssues.length,
            toolSignature
          }
        });
      }
    } catch {
      feedbackMemory = undefined;
    }
  }

  const synthesizeStartedAt = Date.now();
  const synthesized = await traceable(
    async (input: {
      existingFlags: string[];
      feedbackMemory?: AgentFeedbackMemory;
      userMessage?: string;
      toolCalls: AgentChatResponse['toolCalls'];
    }) => synthesizeToolResults(input),
    {
      metadata: buildTraceMetadata({
        step: 'agent.synthesize_tool_results',
        traceContext
      }),
      name: `agent.synthesize_tool_results.turn_${traceContext.turnId}`,
      run_type: 'chain',
      tags: buildTraceTags({
        step: 'agent.synthesize_tool_results',
        traceContext
      })
    }
  )({
    existingFlags: [],
    feedbackMemory,
    userMessage: message,
    toolCalls
  });

  logger.debug('[agent.chat] SYNTHESIZED', {
    answerLength: synthesized.answer.length,
    answerPreview:
      synthesized.answer.slice(0, 400) + (synthesized.answer.length > 400 ? '...' : ''),
    flags: synthesized.flags,
    toolCallCount: toolCalls.length
  });

  let baseAnswer = synthesized.answer;
  let synthesisMode: 'deterministic' | 'llm_grounded' | 'deterministic_fallback' =
    llm ? 'llm_grounded' : 'deterministic';
  if (llm) {
    try {
      const worthInstruction = isPortfolioWorthQuestion(message)
        ? [
            'For portfolio worth questions: state portfolio balance (portfolio field) explicitly, e.g. "Portfolio balance $X". Use balance only when it differs from portfolio. Use totalInvestment for total invested when comparing.'
          ]
        : [];
      const analysisWorthInstruction = shouldLeadWithPortfolioWorth(message)
        ? [
            'For portfolio analysis: the main number to report is from the line "Portfolio balance: N" in the findings—say "Portfolio balance $N" (use that exact N). Do NOT use the number from "Balance:" for the portfolio value; Balance is net worth and may differ. Then net performance, peak net worth, drawdown.'
          ]
        : [];
      const groundedPrompt = [
        'Answer the user question using only grounded tool findings below.',
        'Do not use section headers or report templates.',
        'Be concise and direct. Include exact values when available.',
        'If the user asked for one item (for example top performer), return only that.',
        ...worthInstruction,
        ...analysisWorthInstruction,
        '',
        `User question: ${message}`,
        '',
        'Grounded findings:',
        synthesized.answer
      ].join('\n');
      const llmAnswer = await llm.answerFinanceQuestion(groundedPrompt, llmConversation, traceContext);
      if (llmAnswer.trim().length > 0) {
        baseAnswer = llmAnswer.trim();
      }
    } catch {
      // Keep deterministic synthesis fallback when LLM synthesis fails.
      synthesisMode = 'deterministic_fallback';
    }
  }
  const clarification = getPreferredSingleToolAnswerFromToolCalls(toolCalls);
  if (clarification) {
    baseAnswer = clarification;
  }
  const synthesisDurationMs = Date.now() - synthesizeStartedAt;
  trace.push({
    type: 'llm',
    durationMs: synthesisDurationMs,
    name: 'synthesize',
    input: { messagePreview: message.slice(0, 200), toolCallCount: toolCalls.length },
    output: {
      answerPreview: baseAnswer.slice(0, 500),
      flags: synthesized.flags,
      mode: synthesisMode
    }
  });

  const claimVerification = verifyClaimsAgainstToolEvidence({
    answer: baseAnswer,
    message,
    toolCalls
  });
  if (claimVerification.flags.includes('unsupported_claim')) {
    baseAnswer =
      'I found unsupported numeric claims that could not be grounded in tool evidence. ' +
      'I am withholding those claims. Please retry or run a fresh fact check.';
  }

  const outputValidation = validateOutput({
    answer: baseAnswer,
    intent,
    toolCalls
  });
  if (outputValidation.severeErrors.length > 0) {
    baseAnswer =
      'I cannot provide a reliable answer because required validation checks failed. Please retry.';
  }
  const inputFlags = detectInputFlags(message);
  const constraints = applyDomainConstraints(
    baseAnswer,
    [...synthesized.flags, ...outputValidation.errors, ...inputFlags, ...claimVerification.flags],
    { intent }
  );
  const hasCriticalFlags = constraints.flags.some((flag) =>
    [
      'fact_check_mismatch',
      'fact_check_missing_for_price_claim',
      'missing_provenance',
      'tool_failure',
      'unsupported_claim'
    ].includes(flag)
  );

  const finalizeInput = {
    answer: baseAnswer,
    constraints,
    conversation,
    errors,
    hasCriticalFlags,
    toolCalls
  };
  logger.debug('[agent.chat] FINALIZE_INPUT', {
    answerLength: baseAnswer.length,
    answerPreview: baseAnswer.slice(0, 300) + (baseAnswer.length > 300 ? '...' : ''),
    constraintsIsValid: constraints.isValid,
    constraintFlags: constraints.flags,
    errorCount: errors.length,
    toolCallCount: toolCalls.length
  });

  const response: AgentChatResponse = await traceable(
    async (input: {
      answer: string;
      constraints: ReturnType<typeof applyDomainConstraints>;
      conversation: AgentConversationMessage[];
      errors: AgentChatResponse['errors'];
      hasCriticalFlags: boolean;
      toolCalls: AgentChatResponse['toolCalls'];
    }) => {
      return {
        answer: input.answer,
        conversation: [
          ...input.conversation,
          {
            content: input.answer,
            role: 'assistant' as const
          }
        ],
        errors: input.errors,
        toolCalls: input.toolCalls,
        verification: {
          confidence: scoreConfidence({
            hasCriticalFlags: input.hasCriticalFlags,
            hasErrors: input.errors.length > 0,
            invalid: !input.constraints.isValid
          }),
          flags: input.constraints.flags,
          isValid: input.constraints.isValid
        }
      } satisfies AgentChatResponse;
    },
    {
      metadata: buildTraceMetadata({
        step: 'agent.finalize_response',
        traceContext
      }),
      name: `agent.finalize_response.turn_${traceContext.turnId}`,
      run_type: 'chain',
      tags: buildTraceTags({
        step: 'agent.finalize_response',
        traceContext
      })
    }
  )(finalizeInput);

  await persistConversationArtifacts({
    conversationId,
    conversationStore,
    draftCreateOrderParams,
    previousState,
    response,
    toolCalls
  });
  response.trace = trace;

  logger.debug('[agent.chat] FINALIZE_OUTPUT', {
    answerLength: response.answer.length,
    answerPreview: response.answer.slice(0, 300) + (response.answer.length > 300 ? '...' : ''),
    verification: response.verification
  });
  logger.debug('[agent.chat] LATENCY', {
    routeDurationMs,
    selectedToolsCount,
    synthesisDurationMs,
    toolExecutionDurationMs,
    totalDurationMs: Date.now() - chatStartedAt
  });

  return response;
}

function isPortfolioWorthQuestion(message: string): boolean {
  const normalized = message.toLowerCase();
  return /\b(net worth|portfolio worth|portfolio value|how much is my portfolio worth|worth)\b/.test(
    normalized
  );
}

function shouldLeadWithPortfolioWorth(message: string): boolean {
  const normalized = message.toLowerCase();
  return /\b(analyze|analysis|how is|summary)\b/.test(normalized) && /\bportfolio\b/.test(normalized);
}

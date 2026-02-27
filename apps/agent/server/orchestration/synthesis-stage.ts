import { traceable } from 'langsmith/traceable';

import { persistConversationArtifacts } from '../agent-workflow-state';
import { detectInputFlags, getPreferredSingleToolAnswerFromToolCalls } from '../agent-llm-runtime';
import { buildTraceMetadata, buildTraceTags } from '../agent-tool-runtime';
import type { AgentConversationStore } from '../conversation-store';
import { logger } from '../logger';
import { synthesizeToolResults } from '../synthesis/tool-result-synthesizer';
import type {
  AgentChatResponse,
  AgentConversationMessage,
  AgentFeedbackMemory,
  AgentFeedbackMemoryProvider,
  AgentTraceContext,
  AgentTraceStep,
  CreateOrderParams
} from '../types';
import { applyDomainConstraints } from '../verification/domain-constraints';
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
          type: 'llm',
          name: 'feedback_memory_synthesis',
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

  const synthesisDurationMs = Date.now() - synthesizeStartedAt;
  logger.debug('[agent.chat] SYNTHESIZED', {
    answerLength: synthesized.answer.length,
    answerPreview:
      synthesized.answer.slice(0, 400) + (synthesized.answer.length > 400 ? '...' : ''),
    flags: synthesized.flags,
    synthesisDurationMs,
    toolCallCount: toolCalls.length
  });

  trace.push({
    type: 'llm',
    durationMs: Date.now() - synthesizeStartedAt,
    name: 'synthesize',
    input: { messagePreview: message.slice(0, 200), toolCallCount: toolCalls.length },
    output: { answerPreview: synthesized.answer.slice(0, 500), flags: synthesized.flags }
  });

  let baseAnswer = synthesized.answer;
  const clarification = getPreferredSingleToolAnswerFromToolCalls(toolCalls);
  if (clarification) {
    baseAnswer = clarification;
  }

  const outputValidation = validateOutput(baseAnswer);
  const inputFlags = detectInputFlags(message);
  const constraints = applyDomainConstraints(
    baseAnswer,
    [...synthesized.flags, ...outputValidation.errors, ...inputFlags],
    { intent }
  );
  const hasCriticalFlags = constraints.flags.some((flag) =>
    ['missing_provenance', 'tool_failure'].includes(flag)
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

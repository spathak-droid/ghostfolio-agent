import {
  AgentChatResponse,
  AgentConversationMessage,
  AgentLlm,
  AgentToolName,
  AgentTraceContext,
  AgentTraceStep
} from './types';
import { scoreConfidence } from './verification/confidence-scorer';
import { applyDomainConstraints } from './verification/domain-constraints';
import { validateOutput } from './verification/output-validator';
import {
  classifyIntent,
  isExplicitOrderExecutionIntent,
  messageMatchesRetrievalPatterns,
  removeOrderTools,
  selectToolsByKeyword
} from './agent-routing';
import { persistConversationArtifacts } from './agent-workflow-state';
import { type AgentConversationStore, type AgentWorkflowState } from './conversation-store';
import {
  isTimeoutError,
  timeoutMessageForOperation,
  withOperationTimeout
} from './agent-tool-runtime';

export function detectInputFlags(message: string): string[] {
  const normalized = message.toLowerCase();
  const flags: string[] = [];

  if (
    normalized.includes('invest all your money') ||
    normalized.includes('guaranteed return')
  ) {
    flags.push('deterministic_financial_advice');
  }

  return flags;
}

/**
 * Prefer direct tool answer for single order-tool calls:
 * - Clarification answers (needsClarification=true)
 * - Successful create/update order execution answers
 * This avoids LLM rephrasing that can introduce misleading confirmation text.
 */
export function getPreferredSingleToolAnswerFromToolCalls(
  toolCalls: AgentChatResponse['toolCalls']
): string | undefined {
  if (toolCalls.length !== 1 || !toolCalls[0].success) return undefined;
  const call = toolCalls[0];
  if (
    call.toolName !== 'create_order' &&
    call.toolName !== 'create_other_activities' &&
    call.toolName !== 'compliance_check' &&
    call.toolName !== 'static_analysis'
  ) {
    return undefined;
  }
  const result = call.result as Record<string, unknown>;
  if (call.toolName === 'compliance_check') {
    return buildComplianceAnswer(result);
  }
  if (call.toolName === 'static_analysis') {
    return buildStaticAnalysisAnswer(result);
  }
  const answer = typeof result.answer === 'string' ? result.answer.trim() : undefined;
  if (!answer || answer.length === 0) return undefined;
  if (result?.needsClarification === true) return answer;
  if (result?.success === true) return answer;
  return answer && answer.length > 0 ? answer : undefined;
}

function buildComplianceAnswer(result: Record<string, unknown>): string | undefined {
  const violations = normalizeComplianceItems(result.violations);
  const warnings = normalizeComplianceItems(result.warnings);

  if (violations.length > 0) {
    return [
      `I ran a compliance check and found ${violations.length} blocking violation(s), so you should not proceed yet.`,
      `Violations: ${violations.join(' | ')}`,
      warnings.length > 0 ? `Warnings: ${warnings.join(' | ')}` : '',
      'Next step: Resolve the blocking violations before executing this trade.'
    ]
      .filter((line) => line.length > 0)
      .join('\n');
  }

  if (warnings.length > 0) {
    return [
      `I ran a compliance check and found no blocking violations, but ${warnings.length} warning(s).`,
      `Warnings: ${warnings.join(' | ')}`,
      'Next step: Review the warnings before executing this trade.'
    ].join('\n');
  }

  return 'I ran a compliance check and found no blocking violations or warnings.';
}

function buildStaticAnalysisAnswer(result: Record<string, unknown>): string | undefined {
  const summary = typeof result.summary === 'string' ? result.summary.trim() : '';
  const risks = Array.isArray(result.risks) ? result.risks : [];
  if (result.success === false) {
    const answer = typeof result.answer === 'string' ? result.answer.trim() : '';
    return answer || summary || 'Could not fetch portfolio report.';
  }
  if (risks.length === 0) {
    return summary || 'Portfolio report: all checked rules are fulfilled; no potential risks identified.';
  }
  const lines: string[] = [summary];
  const maxRisks = 8;
  for (let i = 0; i < Math.min(risks.length, maxRisks); i++) {
    const r = risks[i] as Record<string, unknown> | undefined;
    if (!r || typeof r !== 'object') continue;
    const cat = typeof r.categoryName === 'string' ? r.categoryName : '';
    const name = typeof r.ruleName === 'string' ? r.ruleName : '';
    const eval_ = typeof r.evaluation === 'string' ? r.evaluation : '';
    if (cat || name || eval_) {
      lines.push(`• ${cat}${cat && name ? ' – ' : ''}${name}${(cat || name) && eval_ ? ': ' : ''}${eval_}`);
    }
  }
  if (risks.length > maxRisks) {
    lines.push(`… and ${risks.length - maxRisks} more potential risk(s).`);
  }
  return lines.join('\n');
}

function normalizeComplianceItems(items: unknown): string[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return undefined;
      }
      const record = item as Record<string, unknown>;
      const ruleId = typeof record.rule_id === 'string' ? record.rule_id : 'UNKNOWN_RULE';
      const message =
        typeof record.message === 'string' && record.message.trim().length > 0
          ? record.message.trim()
          : 'No details provided.';
      return `${ruleId}: ${message}`;
    })
    .filter((value): value is string => Boolean(value));
}

export async function selectTools({
  conversation,
  message,
  traceContext
}: {
  conversation: AgentConversationMessage[];
  message: string;
  traceContext: AgentTraceContext;
}): Promise<AgentToolName[]> {
  void conversation;
  void traceContext;
  const inferred = selectToolsByKeyword(message);
  const allowOrderTools = isExplicitOrderExecutionIntent(message);
  const inferredWithoutNonExplicitOrders = allowOrderTools
    ? inferred
    : removeOrderTools(inferred);
  if (classifyIntent(message) === 'general') {
    return [];
  }
  return inferredWithoutNonExplicitOrders;
}

export async function decideRoute({
  conversation,
  llm,
  message,
  traceContext
}: {
  conversation: AgentConversationMessage[];
  llm?: AgentLlm;
  message: string;
  traceContext: AgentTraceContext;
}) {
  const applyPriceFactCheckRouting = (tools: AgentToolName[]) =>
    routePriceQueriesWithFactCheckChain({
      message,
      tools
    });
  const inferredIntent = classifyIntent(message);
  const inferredTools = await selectTools({
    conversation,
    message,
    traceContext
  });
  const shouldBypassReasoning = shouldBypassReasoningForPortfolioRetrieval({
    message,
    inferredTools
  });

  if (shouldBypassReasoning) {
    return {
      intent: inferredIntent,
      tools: applyPriceFactCheckRouting(inferredTools)
    };
  }

  if (!llm?.reasonAboutQuery) {
    return {
      intent: inferredIntent,
      tools: applyPriceFactCheckRouting(inferredTools)
    };
  }

  try {
    const reasonAboutQuery = llm.reasonAboutQuery;
    if (!reasonAboutQuery) {
      return {
        intent: inferredIntent,
        tools: inferredTools
      };
    }
    const decision = await withOperationTimeout({
      operation: 'llm.reason_about_query',
      task: () => reasonAboutQuery(message, conversation, traceContext)
    });

    if (decision.mode === 'direct_reply') {
      if (inferredTools.includes('compliance_check')) {
        return { intent: decision.intent, tools: applyPriceFactCheckRouting(inferredTools) };
      }
      if (messageMatchesRetrievalPatterns(message) && inferredTools.length > 0) {
        return { intent: decision.intent, tools: applyPriceFactCheckRouting(inferredTools) };
      }
      const hasOrderTool = inferredTools.some(
        (t) => t === 'create_order' || t === 'create_other_activities'
      );
      if (hasOrderTool && isExplicitOrderExecutionIntent(message)) {
        return { intent: decision.intent, tools: applyPriceFactCheckRouting(inferredTools) };
      }
      return {
        intent: decision.intent,
        tools: [] as AgentToolName[]
      };
    }

    if (Array.isArray(decision.tools) && decision.tools.length > 0) {
      return {
        intent: decision.intent,
        tools: applyPriceFactCheckRouting([...new Set([...decision.tools, ...inferredTools])])
      };
    }

    if (decision.tool && decision.tool !== 'none') {
      return {
        intent: decision.intent,
        tools: applyPriceFactCheckRouting([...new Set([decision.tool, ...inferredTools])])
      };
    }
  } catch {
    return {
      intent: inferredIntent,
      tools: applyPriceFactCheckRouting(inferredTools)
    };
  }

  return {
    intent: inferredIntent,
    tools: applyPriceFactCheckRouting(inferredTools)
  };
}

function shouldBypassReasoningForPortfolioRetrieval({
  inferredTools,
  message
}: {
  inferredTools: AgentToolName[];
  message: string;
}) {
  if (
    inferredTools.includes('market_data') ||
    inferredTools.includes('fact_check') ||
    inferredTools.includes('fact_compliance_check') ||
    inferredTools.includes('compliance_check') ||
    inferredTools.includes('create_order') ||
    inferredTools.includes('create_other_activities')
  ) {
    return false;
  }

  const hasPortfolioFamilyTool =
    inferredTools.includes('portfolio_analysis') || inferredTools.includes('holdings_analysis');
  const hasTransactionRetrievalTool =
    inferredTools.includes('transaction_timeline') || inferredTools.includes('transaction_categorize');

  const normalized = message.toLowerCase();
  const clearlyPortfolioRetrieval = /\b(portfolio|holdings?|allocation|balance|net worth|performance|cash)\b/.test(
    normalized
  );
  const clearlyTransactionRetrieval =
    /\b(what|when|which)\b.*\b(did i|have i)?\b.*\b(buy|bought|sell|sold)\b/.test(normalized) ||
    /\b(last year|last month|last week|this year|in 20\d{2}|during 20\d{2})\b/.test(normalized);

  if (hasPortfolioFamilyTool && clearlyPortfolioRetrieval) {
    return true;
  }
  if (hasTransactionRetrievalTool && clearlyTransactionRetrieval) {
    return true;
  }

  return false;
}

function routePriceQueriesWithFactCheckChain({
  message,
  tools
}: {
  message: string;
  tools: AgentToolName[];
}): AgentToolName[] {
  if (!isPriceQuery(message)) {
    return tools;
  }

  const withoutMarketDataAndFactCheck = tools.filter(
    (tool) => tool !== 'market_data' && tool !== 'fact_check'
  );
  const hasMarketData = tools.includes('market_data');
  const hasFactCheck = tools.includes('fact_check');

  // Price flow should always be market_data first, then fact_check.
  if (hasMarketData || hasFactCheck) {
    return ['market_data', 'fact_check', ...withoutMarketDataAndFactCheck];
  }

  return tools;
}

function isPriceQuery(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    /\b(price|quote|current price|trading at|how much is|what is .* price)\b/.test(
      normalized
    ) || /\b[A-Z]{2,5}\b/.test(message)
  );
}

export async function handleNoToolRoute({
  conversation,
  conversationId,
  conversationStore,
  errors,
  llm,
  llmConversation,
  message,
  pendingClarification,
  previousState,
  treatAsOrderConfirmation,
  toolCalls,
  trace,
  traceContext
}: {
  conversation: AgentConversationMessage[];
  conversationId: string;
  conversationStore: AgentConversationStore;
  errors: AgentChatResponse['errors'];
  llm?: AgentLlm;
  llmConversation: AgentConversationMessage[];
  message: string;
  pendingClarification: boolean;
  previousState?: AgentWorkflowState;
  treatAsOrderConfirmation: boolean;
  toolCalls: AgentChatResponse['toolCalls'];
  trace: AgentTraceStep[];
  traceContext: AgentTraceContext;
}): Promise<AgentChatResponse> {
  let baseAnswer: string;
  if (treatAsOrderConfirmation && !pendingClarification) {
    baseAnswer =
      'There is no pending order to confirm. Please share a new order request (symbol, buy/sell, and quantity).';
  } else if (llm) {
    const answerStartedAt = Date.now();
    try {
      baseAnswer = await withOperationTimeout({
        operation: 'llm.answer_finance_question',
        task: () => llm.answerFinanceQuestion(message, llmConversation, traceContext)
      });
      trace.push({
        type: 'llm',
        durationMs: Date.now() - answerStartedAt,
        name: 'answer',
        input: { messagePreview: message.slice(0, 200) },
        output: { answerPreview: baseAnswer.slice(0, 500) }
      });
    } catch (error) {
      if (isTimeoutError(error)) {
        errors.push({
          code: 'LLM_EXECUTION_TIMEOUT',
          message: 'llm.answer_finance_question timed out after 25 seconds',
          recoverable: true
        });
        baseAnswer = timeoutMessageForOperation('llm.answer_finance_question');
      } else {
        errors.push({
          code: 'LLM_EXECUTION_FAILED',
          message:
            error instanceof Error
              ? error.message
              : 'llm.answer_finance_question failed',
          recoverable: true
        });
        baseAnswer =
          'I could not generate a direct response right now. Please retry your request.';
      }
    }
  } else {
    baseAnswer = 'I can help with portfolio, market data, or transaction categorization questions.';
    trace.push({
      type: 'llm',
      durationMs: 0,
      name: 'answer',
      input: { messagePreview: message.slice(0, 200) },
      output: { answerPreview: baseAnswer.slice(0, 500) }
    });
  }

  if (
    trace.length === 0 ||
    trace[trace.length - 1]?.type !== 'llm' ||
    trace[trace.length - 1]?.name !== 'answer'
  ) {
    trace.push({
      type: 'llm',
      durationMs: 0,
      name: 'answer',
      input: { messagePreview: message.slice(0, 200) },
      output: { answerPreview: baseAnswer.slice(0, 500) }
    });
  }

  const outputValidation = validateOutput(baseAnswer);
  const inputFlags = detectInputFlags(message);
  const constraints = applyDomainConstraints(baseAnswer, [
    ...outputValidation.errors,
    ...inputFlags
  ], {
    intent: classifyIntent(message)
  });

  const response: AgentChatResponse = {
    answer: baseAnswer,
    conversation: [
      ...conversation,
      {
        content: baseAnswer,
        role: 'assistant'
      }
    ],
    errors,
    toolCalls,
    trace,
    verification: {
      confidence: scoreConfidence({
        hasErrors: false,
        invalid: !constraints.isValid
      }),
      flags: constraints.flags,
      isValid: constraints.isValid
    }
  };

  await persistConversationArtifacts({
    conversationId,
    conversationStore,
    previousState,
    response,
    toolCalls
  });
  return response;
}

export async function finalizeDirectResponse({
  conversation,
  conversationId,
  conversationStore,
  draftCreateOrderParams,
  errors,
  hasCriticalFlags,
  llm,
  llmConversation,
  message,
  previousState,
  toolCalls,
  trace,
  traceContext,
  verificationFlags
}: {
  conversation: AgentConversationMessage[];
  conversationId: string;
  conversationStore: AgentConversationStore;
  draftCreateOrderParams?: import('./types').CreateOrderParams;
  errors: AgentChatResponse['errors'];
  hasCriticalFlags: boolean;
  llm: AgentLlm;
  llmConversation: AgentConversationMessage[];
  message: string;
  previousState?: AgentWorkflowState;
  toolCalls: AgentChatResponse['toolCalls'];
  trace: AgentTraceStep[];
  traceContext: AgentTraceContext;
  verificationFlags: string[];
}): Promise<AgentChatResponse> {
  let baseAnswer: string;
  const answerStartedAt = Date.now();

  try {
    baseAnswer = await withOperationTimeout({
      operation: 'llm.answer_finance_question',
      task: () => llm.answerFinanceQuestion(message, llmConversation, traceContext)
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      errors.push({
        code: 'LLM_EXECUTION_TIMEOUT',
        message: 'llm.answer_finance_question timed out after 25 seconds',
        recoverable: true
      });
      baseAnswer = timeoutMessageForOperation('llm.answer_finance_question');
    } else {
      errors.push({
        code: 'LLM_EXECUTION_FAILED',
        message:
          error instanceof Error ? error.message : 'llm.answer_finance_question failed',
        recoverable: true
      });
      baseAnswer = 'I could not generate a response right now. Please retry.';
    }
  }
  trace.push({
    type: 'llm',
    durationMs: Date.now() - answerStartedAt,
    name: 'answer',
    input: { messagePreview: message.slice(0, 200) },
    output: { answerPreview: baseAnswer.slice(0, 500) }
  });
  const outputValidation = validateOutput(baseAnswer);
  const inputFlags = detectInputFlags(message);
  const constraints = applyDomainConstraints(
    baseAnswer,
    [...verificationFlags, ...outputValidation.errors, ...inputFlags],
    { intent: classifyIntent(message) }
  );
  const response: AgentChatResponse = {
    answer: baseAnswer,
    conversation: [
      ...conversation,
      {
        content: baseAnswer,
        role: 'assistant'
      }
    ],
    errors,
    toolCalls,
    trace,
    verification: {
      confidence: scoreConfidence({
        hasCriticalFlags,
        hasErrors: errors.length > 0,
        invalid: !constraints.isValid
      }),
      flags: constraints.flags,
      isValid: constraints.isValid
    }
  };
  await persistConversationArtifacts({
    conversationId,
    conversationStore,
    draftCreateOrderParams,
    previousState,
    response,
    toolCalls
  });
  return response;
}

export function buildToolFailureResponse({
  answer,
  conversation,
  errors,
  toolCalls,
  trace
}: {
  answer: string;
  conversation: AgentConversationMessage[];
  errors: AgentChatResponse['errors'];
  toolCalls: AgentChatResponse['toolCalls'];
  trace: AgentTraceStep[];
}): AgentChatResponse {
  return {
    answer,
    conversation: [
      ...conversation,
      {
        content: answer,
        role: 'assistant'
      }
    ],
    errors,
    toolCalls,
    trace,
    verification: {
      confidence: scoreConfidence({ hasErrors: true, invalid: true }),
      flags: ['tool_failure'],
      isValid: false
    }
  };
}

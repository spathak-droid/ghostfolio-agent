import {
  AgentChatResponse,
  AgentConversationMessage,
  AgentLlm,
  AgentToolName,
  AgentTraceContext,
  AgentTraceStep
} from '../types';
import { scoreConfidence } from '../verification/confidence-scorer';
import { applyDomainConstraints } from '../verification/domain-constraints';
import { validateOutput } from '../verification/output-validator';
import {
  classifyIntent,
  isExplicitOrderExecutionIntent,
  messageMatchesRetrievalPatterns,
  removeOrderTools,
  selectToolsByKeyword
} from './routing';
import {
  isClearPortfolioOrTransactionRetrieval,
  routePriceQueriesWithFactCheckChain
} from './routing/tool-selectors';
import { persistConversationArtifacts } from './workflow-state';
import { type AgentConversationStore, type AgentWorkflowState } from '../stores';
import {
  inferToolRecoverableFromThrownError,
  isTimeoutError,
  timeoutMessageForOperation,
  withOperationTimeout
} from './tool-runtime';

// Re-export tool result formatters for public API
export { getPreferredSingleToolAnswerFromToolCalls } from './tool-result-formatters';

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


export async function selectTools({
  conversation,
  message,
  traceContext,
  llm
}: {
  conversation: AgentConversationMessage[];
  message: string;
  traceContext: AgentTraceContext;
  llm?: AgentLlm;
}): Promise<AgentToolName[]> {
  // Classify intent first - if general/greeting, skip all tool selection
  if (classifyIntent(message) === 'general') {
    return [];
  }

  // Use LLM-based tool selection for accuracy (cached for performance)
  if (llm?.selectTool) {
    try {
      const selection = await withOperationTimeout({
        operation: 'llm.select_tool',
        task: () => llm.selectTool!(message, conversation, traceContext)
      });

      // Convert LLM selection to tool array
      const selectedTool = selection.tool === 'none' ? [] : [selection.tool];

      // If LLM returns 'none', fall back to keyword matching
      if (selectedTool.length === 0) {
        const inferred = selectToolsByKeyword(message);
        const allowOrderTools = isExplicitOrderExecutionIntent(message);
        return allowOrderTools ? inferred : removeOrderTools(inferred);
      }

      // Apply intent-based filtering for order tools
      const allowOrderTools = isExplicitOrderExecutionIntent(message);
      return allowOrderTools ? selectedTool : removeOrderTools(selectedTool);
    } catch (error) {
      // Fallback to keyword matching if LLM selection fails
      const inferred = selectToolsByKeyword(message);
      const allowOrderTools = isExplicitOrderExecutionIntent(message);
      return allowOrderTools ? inferred : removeOrderTools(inferred);
    }
  }

  // Fallback to keyword matching if LLM not available
  const inferred = selectToolsByKeyword(message);
  const allowOrderTools = isExplicitOrderExecutionIntent(message);
  const inferredWithoutNonExplicitOrders = allowOrderTools
    ? inferred
    : removeOrderTools(inferred);
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

  // Detect clear portfolio/transaction retrieval patterns to bypass reasonAboutQuery
  const keywordTools = selectToolsByKeyword(message);
  const shouldBypassReasoning = isClearPortfolioOrTransactionRetrieval(message, keywordTools);

  // For clear transaction retrieval, filter out order creation tools
  let toolsToUse = keywordTools;
  if (shouldBypassReasoning) {
    const isClearTransaction =
      /\b(what|when|which)\b.*\b(did i|have i)?\b.*\b(buy|bought|sell|sold)\b/.test(
        message.toLowerCase()
      ) || /\b(last year|last month|last week|this year|in 20\d{2}|during 20\d{2})\b/.test(message.toLowerCase());
    if (isClearTransaction) {
      toolsToUse = keywordTools.filter(
        (tool) => tool !== 'create_order' && tool !== 'create_other_activities'
      );
    }
  }

  // If reasonAboutQuery is available and not a clear retrieval prompt, use it exclusively for routing
  if (llm?.reasonAboutQuery && !shouldBypassReasoning) {
    try {
      const decision = await withOperationTimeout({
        operation: 'llm.reason_about_query',
        task: () => llm.reasonAboutQuery!(message, conversation, traceContext)
      });

      if (decision.mode === 'direct_reply') {
        // For direct_reply, use keyword matching as fallback
        if (toolsToUse.includes('compliance_check')) {
          return { intent: decision.intent, tools: applyPriceFactCheckRouting(toolsToUse) };
        }
        if (messageMatchesRetrievalPatterns(message) && toolsToUse.length > 0) {
          return { intent: decision.intent, tools: applyPriceFactCheckRouting(toolsToUse) };
        }
        const hasOrderTool = toolsToUse.some(
          (t) => t === 'create_order' || t === 'create_other_activities'
        );
        if (hasOrderTool && isExplicitOrderExecutionIntent(message)) {
          return { intent: decision.intent, tools: applyPriceFactCheckRouting(toolsToUse) };
        }
        return {
          intent: decision.intent,
          tools: [] as AgentToolName[]
        };
      }

      // For tool_call mode, combine reasonAboutQuery result with keyword tools
      if (Array.isArray(decision.tools) && decision.tools.length > 0) {
        return {
          intent: decision.intent,
          tools: applyPriceFactCheckRouting([...new Set([...decision.tools, ...toolsToUse])])
        };
      }

      if (decision.tool && decision.tool !== 'none') {
        return {
          intent: decision.intent,
          tools: applyPriceFactCheckRouting([...new Set([decision.tool, ...toolsToUse])])
        };
      }

      // If reasonAboutQuery returns 'none', fall back to keyword tools
      return {
        intent: decision.intent,
        tools: applyPriceFactCheckRouting(toolsToUse)
      };
    } catch {
      // If reasonAboutQuery fails, use keyword matching
      return {
        intent: inferredIntent,
        tools: applyPriceFactCheckRouting(toolsToUse)
      };
    }
  }

  // For clear retrieval prompts or when reasonAboutQuery is not available, use keyword matching
  if (shouldBypassReasoning) {
    return {
      intent: inferredIntent,
      tools: applyPriceFactCheckRouting(toolsToUse)
    };
  }

  // If reasonAboutQuery is not available, use selectTool
  const inferredTools = await selectTools({
    conversation,
    message,
    traceContext,
    llm
  });

  return {
    intent: inferredIntent,
    tools: applyPriceFactCheckRouting(inferredTools)
  };
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
          recoverable: inferToolRecoverableFromThrownError(error)
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
  draftCreateOrderParams?: import('../types').CreateOrderParams;
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
        recoverable: inferToolRecoverableFromThrownError(error)
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

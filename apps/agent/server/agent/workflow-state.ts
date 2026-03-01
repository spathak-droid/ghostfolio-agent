import type {
  AgentChatResponse,
  AgentConversationMessage,
  CreateOrderParams
} from '../types';
import type {
  AgentConversationStore,
  AgentWorkflowState
} from '../stores';
import { logger } from '../utils';

export async function safeGetConversation({
  conversationId,
  conversationStore
}: {
  conversationId: string;
  conversationStore: AgentConversationStore;
}) {
  try {
    return await conversationStore.getConversation(conversationId);
  } catch (error) {
    logger.warn('[agent.chat] conversation_store_get_conversation_failed', {
      conversationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return [] as AgentConversationMessage[];
  }
}

export async function safeGetState({
  conversationId,
  conversationStore
}: {
  conversationId: string;
  conversationStore: AgentConversationStore;
}) {
  try {
    return await conversationStore.getState(conversationId);
  } catch (error) {
    logger.warn('[agent.chat] conversation_store_get_state_failed', {
      conversationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return undefined;
  }
}

export async function persistConversationArtifacts({
  conversationId,
  conversationStore,
  draftCreateOrderParams,
  previousState,
  response,
  toolCalls
}: {
  conversationId: string;
  conversationStore: AgentConversationStore;
  draftCreateOrderParams?: CreateOrderParams;
  previousState?: AgentWorkflowState;
  response: AgentChatResponse;
  toolCalls: AgentChatResponse['toolCalls'];
}) {
  try {
    await conversationStore.setConversation(conversationId, response.conversation);
    await conversationStore.setState(
      conversationId,
      deriveWorkflowState({
        response,
        toolCalls,
        draftCreateOrderParams,
        previousState
      })
    );
  } catch (error) {
    logger.warn('[agent.chat] conversation_store_persist_failed', {
      conversationId,
      error: error instanceof Error ? error.message : String(error)
    });
    // Persistence must not fail the user response path.
  }
}

function deriveWorkflowState({
  draftCreateOrderParams,
  previousState,
  response,
  toolCalls
}: {
  draftCreateOrderParams?: CreateOrderParams;
  previousState?: AgentWorkflowState;
  response: AgentChatResponse;
  toolCalls: AgentChatResponse['toolCalls'];
}): AgentWorkflowState {
  const lastToolCall = [...toolCalls].reverse().find((call) => typeof call.toolName === 'string');
  if (
    !lastToolCall &&
    previousState?.pendingAction === 'awaiting_clarification' &&
    (previousState.pendingTool === 'create_order' ||
      previousState.pendingTool === 'create_other_activities')
  ) {
    return {
      ...previousState,
      contextSummary: summarizeConversationForState(response.conversation),
      updatedAt: new Date().toISOString(),
      verificationFlags: [...response.verification.flags]
    };
  }

  const result = isObject(lastToolCall?.result) ? lastToolCall.result : undefined;
  const needsClarification = lastToolCall?.success === true && result?.needsClarification === true;
  const missingFields = Array.isArray(result?.missingFields)
    ? result?.missingFields.filter((field): field is string => typeof field === 'string')
    : undefined;

  const pinnedFacts = derivePinnedFacts({
    missingFields,
    needsClarification,
    response,
    toolCall: lastToolCall
  });

  // Check if this response was a symbol clarification (from LLM's ask_user)
  const hasSymbolClarificationFlag = response.verification.flags.includes('needs_clarification');
  const lastAssistantMessage = [...response.conversation].reverse().find(
    (msg) => msg.role === 'assistant'
  );
  const pendingSymbolClarification = extractSymbolClarificationFromMessage(
    hasSymbolClarificationFlag ? lastAssistantMessage?.content : undefined,
    lastToolCall?.toolName
  );

  // Clear pending symbol clarification if a tool succeeded (user's affirmation worked)
  // or if there's no more clarification flag (moved on to a different intent)
  const shouldClearPendingSymbol =
    lastToolCall?.success === true ||
    !hasSymbolClarificationFlag;

  return {
    contextSummary: summarizeConversationForState(response.conversation),
    draftCreateOrderParams:
      needsClarification &&
      (lastToolCall?.toolName === 'create_order' ||
        lastToolCall?.toolName === 'create_other_activities')
        ? draftCreateOrderParams
        : undefined,
    lastTool: lastToolCall?.toolName,
    missingFields,
    pendingAction: needsClarification ? 'awaiting_clarification' : 'idle',
    pendingTool: needsClarification ? lastToolCall?.toolName : undefined,
    pinnedFacts,
    pendingSymbolClarification: shouldClearPendingSymbol ? undefined : pendingSymbolClarification,
    updatedAt: new Date().toISOString(),
    verificationFlags: [...response.verification.flags]
  };
}

function summarizeConversationForState(conversation: AgentConversationMessage[]) {
  if (!Array.isArray(conversation) || conversation.length === 0) {
    return undefined;
  }

  const sampled = conversation
    .slice(-6)
    .map(({ content, role }) => `${role === 'user' ? 'User' : 'Assistant'}: ${content.trim().slice(0, 120)}`)
    .join(' | ');

  return sampled.length > 0 ? sampled : undefined;
}

function derivePinnedFacts({
  missingFields,
  needsClarification,
  response,
  toolCall
}: {
  missingFields?: string[];
  needsClarification: boolean;
  response: AgentChatResponse;
  toolCall?: AgentChatResponse['toolCalls'][number];
}) {
  const facts: string[] = [];
  if (needsClarification && toolCall) {
    const missing = missingFields?.length ? missingFields.join(', ') : 'unknown fields';
    facts.push(`Pending ${toolCall.toolName} clarification: ${missing}.`);
  }

  if (response.verification.flags.length > 0) {
    facts.push(`Verification flags: ${response.verification.flags.join(', ')}.`);
  }

  return facts.length > 0 ? facts : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Extracts symbol clarification from messages like:
 * "Did you mean the S&P 500 index?" → { suggestedSymbol: 'GSPC', suggestedDisplay: 'S&P 500' }
 * "Did you mean Apple Inc (AAPL)?" → { suggestedSymbol: 'AAPL', suggestedDisplay: 'Apple Inc' }
 */
function extractSymbolClarificationFromMessage(
  message: string | undefined,
  toolName?: string
): AgentWorkflowState['pendingSymbolClarification'] {
  if (!message || !toolName || (toolName !== 'market_data' && toolName !== 'analyze_stock_trend')) {
    return undefined;
  }

  const normalized = message.toLowerCase();

  // Pattern 1: "Did you mean X (TICKER)?" → extract TICKER and X
  const tickerMatchExec = /\(([A-Z0-9\-.-]+)\)/.exec(message);
  if (tickerMatchExec) {
    const ticker = tickerMatchExec[1];
    const beforeTicker = message.substring(0, message.indexOf(`(${ticker})`)).trim();
    const displayMatchExec = /(?:mean|is)\s+(.+?)(?:\s*$|\s*\()/i.exec(beforeTicker);
    const display = displayMatchExec ? displayMatchExec[1].trim() : ticker;
    if (ticker && ticker.length > 0) {
      return {
        suggestedSymbol: ticker,
        suggestedDisplay: display,
        pendingTool: toolName
      };
    }
  }

  // Pattern 2: "Did you mean the S&P 500 index?" → extract key term and map to symbol
  const symbolMappings: Record<string, { symbol: string; display: string }> = {
    's&p 500': { symbol: 'GSPC', display: 'S&P 500' },
    's&p500': { symbol: 'GSPC', display: 'S&P 500' },
    'sp500': { symbol: 'GSPC', display: 'S&P 500' },
    'dow jones': { symbol: '^DJI', display: 'Dow Jones' },
    'nasdaq': { symbol: '^IXIC', display: 'NASDAQ' },
    'bitcoin': { symbol: 'BTC-USD', display: 'Bitcoin' },
    'ethereum': { symbol: 'ETH-USD', display: 'Ethereum' },
    'tesla': { symbol: 'TSLA', display: 'Tesla' },
    'apple': { symbol: 'AAPL', display: 'Apple' },
    'nvidia': { symbol: 'NVDA', display: 'NVIDIA' }
  };

  for (const [key, { symbol, display }] of Object.entries(symbolMappings)) {
    if (normalized.includes(key)) {
      return {
        suggestedSymbol: symbol,
        suggestedDisplay: display,
        pendingTool: toolName
      };
    }
  }

  return undefined;
}

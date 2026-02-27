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

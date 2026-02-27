import type { AgentWorkflowState } from '../stores';
import type { AgentConversationMessage } from '../types';

const DEFAULT_MAX_RECENT_MESSAGES = 10;
const DEFAULT_SUMMARY_SAMPLE_MESSAGES = 6;

export interface AgentContextManager {
  buildContext(input: {
    conversation: AgentConversationMessage[];
    state?: AgentWorkflowState;
  }): AgentConversationMessage[];
}

export function createDefaultContextManager({
  maxRecentMessages = DEFAULT_MAX_RECENT_MESSAGES,
  summarySampleMessages = DEFAULT_SUMMARY_SAMPLE_MESSAGES
}: {
  maxRecentMessages?: number;
  summarySampleMessages?: number;
} = {}): AgentContextManager {
  const effectiveMaxRecent = normalizePositiveInteger(
    maxRecentMessages,
    DEFAULT_MAX_RECENT_MESSAGES
  );
  const effectiveSummarySample = normalizePositiveInteger(
    summarySampleMessages,
    DEFAULT_SUMMARY_SAMPLE_MESSAGES
  );

  return {
    buildContext({ conversation, state }) {
      const normalizedConversation = normalizeConversation(conversation);
      const recent =
        normalizedConversation.length <= effectiveMaxRecent
          ? normalizedConversation
          : normalizedConversation.slice(-effectiveMaxRecent);
      const historical =
        normalizedConversation.length <= effectiveMaxRecent
          ? []
          : normalizedConversation.slice(0, normalizedConversation.length - effectiveMaxRecent);

      const contextPrelude: AgentConversationMessage[] = [];
      const summaryMessage = buildSummaryMessage({
        historical,
        sampleCount: effectiveSummarySample,
        state
      });
      if (summaryMessage) {
        contextPrelude.push({
          content: summaryMessage,
          role: 'assistant'
        });
      }

      const pinnedFactsMessage = buildPinnedFactsMessage(state);
      if (pinnedFactsMessage) {
        contextPrelude.push({
          content: pinnedFactsMessage,
          role: 'assistant'
        });
      }

      return [...contextPrelude, ...recent];
    }
  };
}

function normalizeConversation(
  conversation: AgentConversationMessage[]
): AgentConversationMessage[] {
  return Array.isArray(conversation)
    ? conversation.filter(
        (entry): entry is AgentConversationMessage =>
          Boolean(entry) &&
          (entry.role === 'user' || entry.role === 'assistant') &&
          typeof entry.content === 'string'
      )
    : [];
}

function buildSummaryMessage({
  historical,
  sampleCount,
  state
}: {
  historical: AgentConversationMessage[];
  sampleCount: number;
  state?: AgentWorkflowState;
}) {
  const contextSummary = state?.contextSummary?.trim();
  if (contextSummary) {
    return `Context summary: ${contextSummary}`;
  }

  if (historical.length === 0) {
    return undefined;
  }

  const sampled = historical.slice(-sampleCount).map((message) => {
    const prefix = message.role === 'user' ? 'User' : 'Assistant';
    return `${prefix}: ${truncate(message.content, 120)}`;
  });

  return `Context summary: ${sampled.join(' | ')}`;
}

function buildPinnedFactsMessage(state?: AgentWorkflowState) {
  if (!state) {
    return undefined;
  }

  const lines: string[] = [];
  if (Array.isArray(state.pinnedFacts) && state.pinnedFacts.length > 0) {
    lines.push(...state.pinnedFacts.slice(0, 6).map((line) => truncate(line, 180)));
  }

  if (state.pendingAction === 'awaiting_clarification') {
    const missing = Array.isArray(state.missingFields) ? state.missingFields.join(', ') : 'unknown';
    const pendingTool = state.pendingTool ?? 'unknown_tool';
    lines.push(`Pending ${pendingTool} clarification. Missing fields: ${missing}.`);
  }

  if (lines.length === 0) {
    return undefined;
  }

  return `Pinned context: ${lines.join(' | ')}`;
}

function truncate(value: string, maxLength: number) {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 3)}...`;
}

function normalizePositiveInteger(value: number, fallback: number) {
  if (!Number.isFinite(value) || value < 1) {
    return fallback;
  }

  return Math.floor(value);
}

import type { AgentConversationMessage, AgentTraceContext } from '../types';

export function buildTraceMetadata({
  step,
  traceContext
}: {
  step: string;
  traceContext: AgentTraceContext;
}) {
  return {
    conversation_id: traceContext.conversationId,
    message_preview: traceContext.messagePreview,
    session_id: traceContext.sessionId,
    step,
    turn_id: traceContext.turnId
  };
}

export function buildTraceTags({
  step,
  traceContext
}: {
  step: string;
  traceContext: AgentTraceContext;
}) {
  return [
    'agent',
    `conversation:${traceContext.conversationId}`,
    `session:${traceContext.sessionId}`,
    `step:${step}`,
    `turn:${traceContext.turnId}`
  ];
}

export function createTraceContext({
  conversation,
  conversationId,
  message
}: {
  conversation: AgentConversationMessage[];
  conversationId: string;
  message: string;
}): AgentTraceContext {
  const turnId = conversation.filter(({ role }) => role === 'user').length;

  return {
    conversationId,
    messagePreview: message.slice(0, 120),
    sessionId: conversationId,
    turnId
  };
}

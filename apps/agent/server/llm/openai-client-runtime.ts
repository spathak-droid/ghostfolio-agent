import { traceable } from 'langsmith/traceable';

import {
  AgentReasoningDecision,
  AgentToolName,
  AgentTraceContext
} from '../types';

export async function runWithOptionalTrace<T>({
  fn,
  step,
  traceContext
}: {
  fn: () => Promise<T>;
  step: string;
  traceContext?: AgentTraceContext;
}) {
  const traceConfig = buildRuntimeTraceConfig({ step, traceContext });
  if (!traceConfig || !traceContext) {
    return fn();
  }

  return traceable(
    async () => fn(),
    {
      metadata: traceConfig.metadata,
      name: `${step}.turn_${traceContext.turnId}`,
      run_type: 'chain',
      tags: traceConfig.tags
    }
  )();
}

export function parseToolSelection(
  content: string | undefined,
  allowedTools: readonly AgentToolName[]
): { tool: AgentToolName | 'none' } {
  if (!content) {
    return { tool: 'none' };
  }

  try {
    const parsed = JSON.parse(content) as { tool?: AgentToolName | 'none' };

    if (parsed.tool && [...allowedTools, 'none'].includes(parsed.tool)) {
      return { tool: parsed.tool };
    }
  } catch {
    return { tool: 'none' };
  }

  return { tool: 'none' };
}

export function parseReasoningDecision(
  content: string | undefined,
  allowedTools: readonly AgentToolName[]
): AgentReasoningDecision {
  const defaultDecision: AgentReasoningDecision = {
    intent: 'general',
    mode: 'direct_reply',
    tool: 'none'
  };
  if (!content) {
    return defaultDecision;
  }

  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const intent = parsed.intent === 'finance' ? 'finance' : 'general';
    const mode = parsed.mode === 'tool_call' ? 'tool_call' : 'direct_reply';
    const tool =
      typeof parsed.tool === 'string' && [...allowedTools, 'none'].includes(parsed.tool as AgentToolName)
        ? (parsed.tool as AgentToolName | 'none')
        : 'none';

    let tools: AgentToolName[] | undefined;
    if (Array.isArray(parsed.tools) && parsed.tools.length > 0) {
      tools = (parsed.tools as string[]).filter(
        (t): t is AgentToolName =>
          typeof t === 'string' && allowedTools.includes(t as AgentToolName)
      );
      if (tools.length === 0) tools = undefined;
    }

    return {
      intent,
      mode,
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale : undefined,
      tool,
      tools,
      requires_factual_data: typeof parsed.requires_factual_data === 'boolean' ? parsed.requires_factual_data : undefined,
      needs_history: typeof parsed.needs_history === 'boolean' ? parsed.needs_history : undefined
    };
  } catch {
    return defaultDecision;
  }
}

function buildRuntimeTraceConfig({
  step,
  traceContext
}: {
  step: string;
  traceContext?: AgentTraceContext;
}) {
  if (!traceContext) {
    return undefined;
  }

  return {
    metadata: {
      conversation_id: traceContext.conversationId,
      message_preview: traceContext.messagePreview,
      session_id: traceContext.sessionId,
      step,
      turn_id: traceContext.turnId
    },
    tags: [
      'agent',
      `conversation:${traceContext.conversationId}`,
      `session:${traceContext.sessionId}`,
      `step:${step}`,
      `turn:${traceContext.turnId}`
    ]
  };
}

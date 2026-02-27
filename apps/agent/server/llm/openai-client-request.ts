import { traceable } from 'langsmith/traceable';

import { extractMessageContent } from './openai-client-helpers';
import { logger } from '../utils';
import type { AgentTraceContext } from '../types';

interface OpenAiChatResponse {
  choices?: {
    message?: {
      content?: unknown;
    };
  }[];
}

export async function callOpenAi({
  apiKey,
  candidateIndex,
  messages,
  model,
  requestUrl,
  tier,
  traceContext,
  requireJson,
  timeoutMs
}: {
  apiKey: string;
  candidateIndex: number;
  messages: { role: 'assistant' | 'system' | 'user'; content: string }[];
  model: string;
  requestUrl: string;
  tier: 'balanced' | 'fast' | 'premium';
  traceContext?: AgentTraceContext;
  requireJson: boolean;
  timeoutMs: number;
}) {
  const provider = requestUrl.includes('openrouter.ai') ? 'openrouter' : 'openai';
  const payload: Record<string, unknown> = { messages, model };

  if (requireJson) {
    payload.response_format = { type: 'json_object' };
  }

  const executeRequest = () =>
    withFetchTimeout(
      (signal) =>
        fetch(requestUrl, {
          body: JSON.stringify(payload),
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          method: 'POST',
          signal
        }),
      timeoutMs
    );

  const response =
    traceContext === undefined
      ? await executeRequest()
      : await traceable(executeRequest, {
          metadata: {
            candidate_index: candidateIndex,
            conversation_id: traceContext.conversationId,
            is_fallback: candidateIndex > 0,
            llm_model: model,
            llm_provider: provider,
            llm_tier: tier,
            message_preview: traceContext.messagePreview,
            request_url: requestUrl,
            session_id: traceContext.sessionId,
            step: 'llm.api_call',
            turn_id: traceContext.turnId
          },
          name: `llm.api_call.${provider}.${tier}`,
          run_type: 'llm',
          tags: [
            'agent',
            `conversation:${traceContext.conversationId}`,
            `session:${traceContext.sessionId}`,
            `tier:${tier}`,
            `provider:${provider}`,
            `model:${model}`,
            `turn:${traceContext.turnId}`
          ]
        })();

  logger.debug('[llm.api_call]', {
    candidateIndex,
    isFallback: candidateIndex > 0,
    model,
    provider,
    requestUrl,
    tier
  });

  if (!response.ok) {
    let apiMessage: string;
    try {
      const raw = await response.text();
      try {
        const body = JSON.parse(raw) as { error?: { message?: string }; message?: string };
        apiMessage = (body?.error?.message ?? body?.message ?? raw) || `HTTP ${response.status}`;
      } catch {
        apiMessage = raw || `HTTP ${response.status}`;
      }
    } catch {
      apiMessage = `HTTP ${response.status}`;
    }

    if (response.status === 401) {
      const err = new Error(apiMessage) as Error & { code: string };
      err.code = 'OPENAI_UNAUTHORIZED';
      if (provider === 'openrouter') {
        logger.error('[llm.openrouter.error]', {
          apiMessage,
          candidateIndex,
          code: err.code,
          model,
          provider,
          requestUrl,
          status: response.status,
          tier
        });
      }
      throw err;
    }

    if (response.status === 404) {
      const err = new Error(apiMessage) as Error & { code: string };
      err.code = 'OPENAI_MODEL_NOT_FOUND';
      if (provider === 'openrouter') {
        logger.error('[llm.openrouter.error]', {
          apiMessage,
          candidateIndex,
          code: err.code,
          model,
          provider,
          requestUrl,
          status: response.status,
          tier
        });
      }
      throw err;
    }

    if (provider === 'openrouter') {
      logger.error('[llm.openrouter.error]', {
        apiMessage,
        candidateIndex,
        code: 'OPENROUTER_HTTP_ERROR',
        model,
        provider,
        requestUrl,
        status: response.status,
        tier
      });
    }

    return undefined;
  }

  const data = (await response.json()) as OpenAiChatResponse;
  return extractMessageContent(data.choices?.[0]?.message?.content);
}

async function withFetchTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await task(controller.signal);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      const timeoutError = new Error(`LLM request timed out after ${timeoutMs}ms`) as Error & {
        code: string;
      };
      timeoutError.code = 'OPENAI_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

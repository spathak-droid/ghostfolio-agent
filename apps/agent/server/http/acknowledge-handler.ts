import type { Request, Response } from 'express';

import { resolveRequestToken } from '../auth';
import { validateTokenLength } from '../chat-request-validation';
import { GhostfolioClient, resolveGhostfolioBaseUrl } from '../clients';
import { callOpenAi } from '../llm/openai-client-request';
import type { ConversationHistoryStore } from '../stores';
import { logger } from '../utils';
import { sendValidationError } from './response-helpers';

const OPENAI_REQUEST_URL = 'https://api.openai.com/v1/chat/completions';
const OPENROUTER_REQUEST_URL = 'https://openrouter.ai/api/v1/chat/completions';

const SYSTEM_PROMPT =
  'You are a financial assistant. The user just sent a message. ' +
  'Write ONE short sentence (max 8 words) acknowledging what you are about to do. ' +
  'Always end with "...". ' +
  'Examples: "Checking your portfolio now..." / "Looking up that price..." / "Calculating your taxes..."';

export function createAcknowledgeHandler({
  allowBodyAccessToken,
  allowInsecureGhostfolioHttp,
  conversationHistoryStore,
  ghostfolioAllowedHosts,
  ghostfolioBaseUrl
}: {
  allowBodyAccessToken: boolean;
  allowInsecureGhostfolioHttp: boolean;
  conversationHistoryStore: ConversationHistoryStore;
  ghostfolioAllowedHosts: string[];
  ghostfolioBaseUrl: string;
}) {
  return async (request: Request, response: Response): Promise<void> => {
    const requestBody =
      request.body && typeof request.body === 'object' && !Array.isArray(request.body)
        ? (request.body as Record<string, unknown>)
        : {};

    const message = typeof requestBody.message === 'string' ? requestBody.message.trim() : '';
    const conversationId =
      typeof requestBody.conversationId === 'string' ? requestBody.conversationId.trim() : '';

    if (!message) {
      sendValidationError(response, 'message is required');
      return;
    }

    const tokenResolution = resolveRequestToken({
      allowBodyAccessToken,
      authorizationHeader: request.headers.authorization,
      bodyAccessToken:
        typeof requestBody.accessToken === 'string' ? requestBody.accessToken : undefined
    });
    if (!tokenResolution.ok) {
      const err = tokenResolution as { error: string; status: 400 };
      sendValidationError(response, err.error, err.status);
      return;
    }

    const tokenCheck = validateTokenLength(tokenResolution.token);
    if (!tokenCheck.ok) {
      const err = tokenCheck as { error: string; status: 400 };
      sendValidationError(response, err.error, err.status);
      return;
    }

    logger.info('[agent.acknowledge] request', {
      conversationId: conversationId || '(new)',
      messagePreview: message.slice(0, 60)
    });

    // Match createOpenAiClientFromEnv key priority: OpenRouter first, then OpenAI
    const openRouterApiKey = process.env.OPENROUTER_API_KEY ?? process.env.API_KEY_OPENROUTER;
    const openAiApiKey = process.env.OPENAI_API_KEY;
    const apiKey = openRouterApiKey ?? openAiApiKey ?? '';
    const usingOpenRouter = Boolean(openRouterApiKey);

    logger.debug('[acknowledge] API key check', {
      hasOpenRouterKey: Boolean(openRouterApiKey),
      hasOpenAiKey: Boolean(openAiApiKey),
      hasApiKey: Boolean(apiKey),
      usingOpenRouter
    });

    if (!apiKey) {
      logger.debug('[acknowledge] No API key available, returning fallback');
      response.status(200).json({ forWidget: 'On it...' });
      return;
    }

    const requestUrl = usingOpenRouter ? OPENROUTER_REQUEST_URL : OPENAI_REQUEST_URL;
    const model = process.env.OPENAI_MODEL || (usingOpenRouter ? 'openai/gpt-4o-mini' : 'gpt-4o-mini');

    try {
      const baseUrlResolution = resolveGhostfolioBaseUrl({
        allowedHosts: ghostfolioAllowedHosts,
        allowInsecureHttp: allowInsecureGhostfolioHttp,
        configuredBaseUrl: process.env.GHOSTFOLIO_BASE_URL,
        fallbackBaseUrl: ghostfolioBaseUrl
      });

      let recentMessages: { role: 'user' | 'assistant'; content: string }[] = [];

      if (baseUrlResolution.ok && conversationId) {
        try {
          const client = new GhostfolioClient(baseUrlResolution.url);
          const user = await client.getUser({ token: tokenResolution.token });
          const userId =
            user && typeof (user as { id?: string }).id === 'string'
              ? (user as { id: string }).id
              : null;

          if (userId) {
            const item = await conversationHistoryStore.getById(conversationId, userId);
            recentMessages = (item?.messages ?? []).slice(-3) as {
              role: 'user' | 'assistant';
              content: string;
            }[];
          }
        } catch {
          // History is optional - continue without it
        }
      }

      const ack = await callOpenAi({
        apiKey,
        candidateIndex: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...recentMessages,
          { role: 'user', content: message }
        ],
        model,
        requestUrl,
        tier: 'fast',
        traceContext: undefined,
        requireJson: false,
        timeoutMs: 5000
      });

      response.status(200).json({ forWidget: ack?.trim() || 'On it...' });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const errStack = err instanceof Error ? err.stack : undefined;
      logger.debug('[acknowledge] LLM call failed, using fallback', {
        message: errMsg,
        stack: errStack
      });
      response.status(200).json({ forWidget: 'On it...' });
    }
  };
}

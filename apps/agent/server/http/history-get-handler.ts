import type { Request, Response } from 'express';

import { validateTokenLength } from '../chat-request-validation';
import { resolveGhostfolioBaseUrl } from '../clients';
import { GhostfolioClient } from '../clients';
import { resolveRequestToken } from '../auth';
import type { ConversationHistoryStore } from '../stores';
import { sendAgentFailed, sendValidationError } from './response-helpers';

export function createHistoryGetHandler({
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
    const conversationId =
      typeof request.params.conversationId === 'string' ? request.params.conversationId.trim() : '';
    if (!conversationId) {
      sendValidationError(response, 'conversationId is required', 400);
      return;
    }

    const requestBody =
      request.body && typeof request.body === 'object' && !Array.isArray(request.body)
        ? (request.body as Record<string, unknown>)
        : {};
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

    const baseUrlResolution = resolveGhostfolioBaseUrl({
      allowedHosts: ghostfolioAllowedHosts,
      allowInsecureHttp: allowInsecureGhostfolioHttp,
      configuredBaseUrl: process.env.GHOSTFOLIO_BASE_URL,
      fallbackBaseUrl: ghostfolioBaseUrl
    });
    if (!baseUrlResolution.ok) {
      sendValidationError(response, 'Configuration error', 400);
      return;
    }

    try {
      const client = new GhostfolioClient(baseUrlResolution.url);
      const user = await client.getUser({
        impersonationId:
          typeof request.headers['impersonation-id'] === 'string'
            ? request.headers['impersonation-id']
            : undefined,
        token: tokenResolution.token
      });
      const userId =
        user && typeof user === 'object' && typeof (user as { id?: string }).id === 'string'
          ? (user as { id: string }).id
          : null;
      if (!userId) {
        response.status(404).json({ code: 'NOT_FOUND', error: 'Conversation not found' });
        return;
      }

      const item = await conversationHistoryStore.getById(conversationId, userId);
      if (!item) {
        response.status(404).json({ code: 'NOT_FOUND', error: 'Conversation not found' });
        return;
      }
      response.status(200).json(item);
    } catch (error) {
      sendAgentFailed(response, 'AGENT_HISTORY_FAILED');
    }
  };
}

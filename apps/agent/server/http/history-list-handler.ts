import type { Request, Response } from 'express';

import { validateTokenLength } from '../chat-request-validation';
import { resolveGhostfolioBaseUrl } from '../clients';
import { GhostfolioClient } from '../clients';
import { resolveRequestToken } from '../auth';
import type { ConversationHistoryStore } from '../stores';
import { sendAgentFailed, sendValidationError } from './response-helpers';

export function createHistoryListHandler({
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
        response.status(200).json({ conversations: [] });
        return;
      }

      const limit =
        typeof request.query.limit === 'string' && /^\d+$/.test(request.query.limit)
          ? Math.min(100, Math.max(1, parseInt(request.query.limit, 10)))
          : 50;
      const conversations = await conversationHistoryStore.listByUser(userId, limit);
      response.status(200).json({ conversations });
    } catch (error) {
      sendAgentFailed(response, 'AGENT_HISTORY_FAILED');
    }
  };
}

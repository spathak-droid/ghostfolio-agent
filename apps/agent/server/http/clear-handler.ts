import type { Request, Response } from 'express';

import {
  validateClearChatBody,
  validateTokenLength
} from '../chat-request-validation';
import { resolveGhostfolioBaseUrl } from '../clients';
import { GhostfolioClient } from '../clients';
import { logger } from '../utils';
import { resolveRequestToken } from '../auth';
import type { AgentConversationMessage } from '../types';
import type { ConversationHistoryStore } from '../stores';
import type { ConversationStoreLike } from './types';
import { sendAgentFailed, sendValidationError } from './response-helpers';

export interface ClearHandlerDeps {
  allowBodyAccessToken: boolean;
  conversationStore: ConversationStoreLike & {
    getConversation(conversationId: string): Promise<AgentConversationMessage[]>;
  };
  conversationHistoryStore: ConversationHistoryStore;
  ghostfolioBaseUrl: string;
  allowInsecureGhostfolioHttp: boolean;
  ghostfolioAllowedHosts: string[];
}

export function createClearHandler({
  allowBodyAccessToken,
  conversationStore,
  conversationHistoryStore,
  ghostfolioBaseUrl,
  allowInsecureGhostfolioHttp,
  ghostfolioAllowedHosts
}: ClearHandlerDeps) {
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

    const validation = validateClearChatBody(requestBody);
    if (!validation.ok) {
      const err = validation as { error: string; status: 400 };
      sendValidationError(response, err.error, err.status);
      return;
    }

    const conversationId = validation.params.conversationId;

    try {
      const conversation = await conversationStore.getConversation(conversationId);
      if (conversation.length > 0) {
        const baseUrlResolution = resolveGhostfolioBaseUrl({
          allowedHosts: ghostfolioAllowedHosts,
          allowInsecureHttp: allowInsecureGhostfolioHttp,
          configuredBaseUrl: process.env.GHOSTFOLIO_BASE_URL,
          fallbackBaseUrl: ghostfolioBaseUrl
        });
        if (baseUrlResolution.ok) {
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
            if (userId) {
              const firstUserContent = conversation.find((m) => m.role === 'user')?.content?.trim();
              const title = firstUserContent
                ? firstUserContent.length <= 512
                  ? firstUserContent
                  : firstUserContent.slice(0, 509) + '...'
                : null;
              await conversationHistoryStore.save({
                conversationId,
                userId,
                messages: conversation,
                title
              });
            }
          } catch (err) {
            logger.debug('[agent.chat.clear] history_save_skipped', {
              message: err instanceof Error ? err.message : String(err)
            });
          }
        }
      }

      await conversationStore.clearConversation(conversationId);
      response.status(200).json({ ok: true });
    } catch (error) {
      logger.error('[agent.chat.clear] UNHANDLED_ERROR', {
        message: error instanceof Error ? error.message : 'clearConversation failed'
      });
      sendAgentFailed(response, 'AGENT_CHAT_CLEAR_FAILED');
    }
  };
}

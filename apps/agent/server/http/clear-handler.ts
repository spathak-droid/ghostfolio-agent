import type { Request, Response } from 'express';

import {
  validateClearChatBody,
  validateTokenLength
} from '../chat-request-validation';
import { resolveGhostfolioBaseUrl } from '../clients';
import { GhostfolioClient } from '../clients';
import { createUserScopedConversationStore } from '../stores';
import { logger } from '../utils';
import { resolveRequestToken } from '../auth';
import type { ConversationHistoryStore, AgentConversationStore } from '../stores';
import { sendAgentFailed, sendValidationError } from './response-helpers';

export interface ClearHandlerDeps {
  allowBodyAccessToken: boolean;
  conversationStore: AgentConversationStore;
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
      let storeScopeId = 'anonymous';
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
          if (userId) storeScopeId = userId;
        } catch (err) {
          logger.debug('[agent.chat.clear] get_user_skipped', {
            message: err instanceof Error ? err.message : String(err)
          });
        }
      }

      const userScopedStore = createUserScopedConversationStore(conversationStore, storeScopeId);
      const conversation = await userScopedStore.getConversation(conversationId);
      if (conversation.length > 0 && baseUrlResolution?.ok && storeScopeId !== 'anonymous') {
        try {
          const firstUserContent = conversation.find((m) => m.role === 'user')?.content?.trim();
          const title = firstUserContent
            ? firstUserContent.length <= 512
              ? firstUserContent
              : firstUserContent.slice(0, 509) + '...'
            : null;
          await conversationHistoryStore.save({
            conversationId,
            userId: storeScopeId,
            messages: conversation,
            title
          });
        } catch (err) {
          logger.debug('[agent.chat.clear] history_save_skipped', {
            message: err instanceof Error ? err.message : String(err)
          });
        }
      }

      await userScopedStore.clearConversation(conversationId);
      response.status(200).json({ ok: true });
    } catch (error) {
      logger.error('[agent.chat.clear] UNHANDLED_ERROR', {
        message: error instanceof Error ? error.message : 'clearConversation failed'
      });
      sendAgentFailed(response, 'AGENT_CHAT_CLEAR_FAILED');
    }
  };
}

import type { Request, Response } from 'express';

import {
  validateClearChatBody,
  validateTokenLength
} from '../chat-request-validation';
import { logger } from '../utils';
import { resolveRequestToken } from '../auth';
import type { ConversationStoreLike } from './types';
import { sendAgentFailed, sendValidationError } from './response-helpers';

export function createClearHandler({
  allowBodyAccessToken,
  conversationStore
}: {
  allowBodyAccessToken: boolean;
  conversationStore: ConversationStoreLike;
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

    const validation = validateClearChatBody(requestBody);
    if (!validation.ok) {
      const err = validation as { error: string; status: 400 };
      sendValidationError(response, err.error, err.status);
      return;
    }

    try {
      await conversationStore.clearConversation(validation.params.conversationId);
      response.status(200).json({ ok: true });
    } catch (error) {
      logger.error('[agent.chat.clear] UNHANDLED_ERROR', {
        message: error instanceof Error ? error.message : 'clearConversation failed'
      });
      sendAgentFailed(response, 'AGENT_CHAT_CLEAR_FAILED');
    }
  };
}

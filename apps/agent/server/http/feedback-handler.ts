import type { Request, Response } from 'express';

import { GhostfolioClient, resolveGhostfolioBaseUrl } from '../clients';
import { resolveRequestToken } from '../auth';
import { parseFeedbackBody, validateTokenLength } from '../chat-request-validation';
import { logger } from '../utils';
import { sendConfigError, sendValidationError } from './response-helpers';
import type { FeedbackStoreLike } from './types';

export function createFeedbackHandler({
  allowBodyAccessToken,
  allowInsecureGhostfolioHttp,
  feedbackStore,
  ghostfolioAllowedHosts,
  ghostfolioBaseUrl
}: {
  allowBodyAccessToken: boolean;
  allowInsecureGhostfolioHttp: boolean;
  feedbackStore: FeedbackStoreLike;
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

    const validation = parseFeedbackBody(requestBody);
    if (!validation.ok) {
      const err = validation as { error: string; status: 400 };
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
      const err = baseUrlResolution as { error: string; status: 500 };
      sendConfigError(response, err.error);
      return;
    }

    let userId: string | undefined;
    const token = tokenResolution.token;
    if (token) {
      try {
        const ghostfolioClient = new GhostfolioClient(baseUrlResolution.url);
        const user = await ghostfolioClient.getUser({ token });
        userId =
          user && typeof user === 'object' && typeof (user as { id?: string }).id === 'string'
            ? (user as { id: string }).id
            : undefined;
      } catch {
        // Ignore errors getting user, proceed without userId
      }
    }

    logger.info('[agent.feedback] RECEIVED', {
      conversationId: validation.params.conversationId,
      hasCorrection: Boolean(validation.params.correction),
      hasMessage: Boolean(validation.params.message),
      hasUserId: Boolean(userId),
      rating: validation.params.rating
    });

    try {
      const result = await feedbackStore.save({
        answer: validation.params.answer,
        conversationId: validation.params.conversationId,
        correction: validation.params.correction,
        latency: validation.params.latency,
        message: validation.params.message,
        rating: validation.params.rating,
        trace: validation.params.trace,
        userId
      });
      if (!result.ok) {
        response.status(503).json({
          code: 'FEEDBACK_PERSIST_FAILED',
          error: result.error ?? 'feedback_persist_failed'
        });
        return;
      }
      response.status(200).json({
        feedbackId: result.feedbackId,
        ok: true
      });
    } catch (error) {
      logger.error('[agent.feedback] PERSIST_FAILED', {
        message: error instanceof Error ? error.message : 'feedback_persist_failed'
      });
      response.status(503).json({
        code: 'FEEDBACK_PERSIST_FAILED',
        error: 'feedback_persist_failed'
      });
    }
  };
}

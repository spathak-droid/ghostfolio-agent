import type { Request, Response } from 'express';

import { parseFeedbackBody } from '../chat-request-validation';
import { logger } from '../logger';
import type { FeedbackStoreLike } from './types';

export function createFeedbackHandler({
  feedbackStore
}: {
  feedbackStore: FeedbackStoreLike;
}) {
  return async (request: Request, response: Response): Promise<void> => {
    const requestBody =
      request.body && typeof request.body === 'object' && !Array.isArray(request.body)
        ? (request.body as Record<string, unknown>)
        : {};

    const validation = parseFeedbackBody(requestBody);
    if (!validation.ok) {
      const err = validation as { error: string; status: 400 };
      response.status(err.status).json({
        code: 'VALIDATION_ERROR',
        error: err.error
      });
      return;
    }

    logger.info('[agent.feedback] RECEIVED', {
      conversationId: validation.params.conversationId,
      hasCorrection: Boolean(validation.params.correction),
      hasMessage: Boolean(validation.params.message),
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
        trace: validation.params.trace
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

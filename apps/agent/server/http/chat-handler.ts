import type { Request, Response } from 'express';

import {
  parseCreateOrderParams,
  validateChatBody,
  validateImpersonationId,
  validateTokenLength
} from '../chat-request-validation';
import { resolveGhostfolioBaseUrl } from '../ghostfolio-base-url';
import { GhostfolioClient } from '../ghostfolio-client';
import { logger } from '../logger';
import { resolveRequestToken } from '../request-auth';
import type { AgentChatResponse, AgentTraceStep } from '../types';
import type { CreateAgentWithClient } from './types';

function summarizeTraceLatency(trace: AgentTraceStep[] | undefined): {
  llmMs: number;
  toolMs: number;
} {
  let llmMs = 0;
  let toolMs = 0;
  for (const step of trace ?? []) {
    if (typeof step.durationMs !== 'number' || !Number.isFinite(step.durationMs)) {
      continue;
    }
    if (step.type === 'llm') {
      llmMs += Math.max(0, Math.round(step.durationMs));
    } else if (step.type === 'tool') {
      toolMs += Math.max(0, Math.round(step.durationMs));
    }
  }
  return { llmMs, toolMs };
}

export function createChatHandler({
  allowBodyAccessToken,
  allowInsecureGhostfolioHttp,
  createAgentWithClient,
  ghostfolioAllowedHosts,
  ghostfolioBaseUrl
}: {
  allowBodyAccessToken: boolean;
  allowInsecureGhostfolioHttp: boolean;
  createAgentWithClient: CreateAgentWithClient;
  ghostfolioAllowedHosts: string[];
  ghostfolioBaseUrl: string;
}) {
  return async (request: Request, response: Response): Promise<void> => {
    const requestStartedAt = Date.now();
    const requestBody =
      request.body && typeof request.body === 'object' && !Array.isArray(request.body)
        ? (request.body as Record<string, unknown>)
        : {};

    const hasTokenFromHeader = Boolean(request.headers.authorization);
    const hasTokenFromBody = Boolean(
      typeof requestBody.accessToken === 'string' && requestBody.accessToken.trim()
    );

    const tokenResolution = resolveRequestToken({
      allowBodyAccessToken,
      authorizationHeader: request.headers.authorization,
      bodyAccessToken:
        typeof requestBody.accessToken === 'string' ? requestBody.accessToken : undefined
    });
    if (!tokenResolution.ok) {
      const err = tokenResolution as { error: string; status: 400 };
      response.status(err.status).json({ code: 'VALIDATION_ERROR', error: err.error });
      return;
    }

    const token = tokenResolution.token;
    const impersonationId =
      typeof request.headers['impersonation-id'] === 'string'
        ? request.headers['impersonation-id']
        : undefined;

    const impersonationValidation = validateImpersonationId(impersonationId);
    if (!impersonationValidation.ok) {
      const err = impersonationValidation as { error: string; status: 400 };
      response.status(err.status).json({ code: 'VALIDATION_ERROR', error: err.error });
      return;
    }

    const tokenCheck = validateTokenLength(token);
    if (!tokenCheck.ok) {
      const err = tokenCheck as { error: string; status: 400 };
      response.status(err.status).json({ code: 'VALIDATION_ERROR', error: err.error });
      return;
    }

    const validation = validateChatBody(requestBody);
    if (!validation.ok) {
      const err = validation as { error: string; status: 400 };
      response.status(err.status).json({ code: 'VALIDATION_ERROR', error: err.error });
      return;
    }

    const ghostfolioBaseUrlResolution = resolveGhostfolioBaseUrl({
      allowedHosts: ghostfolioAllowedHosts,
      allowInsecureHttp: allowInsecureGhostfolioHttp,
      configuredBaseUrl: process.env.GHOSTFOLIO_BASE_URL,
      fallbackBaseUrl: ghostfolioBaseUrl
    });
    if (!ghostfolioBaseUrlResolution.ok) {
      const err = ghostfolioBaseUrlResolution as { error: string; status: 500 };
      response.status(err.status).json({ code: 'CONFIGURATION_ERROR', error: err.error });
      return;
    }

    const resolvedGhostfolioBaseUrl = ghostfolioBaseUrlResolution.url;
    const requestAgent = createAgentWithClient(new GhostfolioClient(resolvedGhostfolioBaseUrl));
    logger.debug('[agent-auth] Agent received:', {
      hasTokenFromBody,
      hasTokenFromHeader,
      hasToken: Boolean(token),
      ghostfolioBaseUrl: resolvedGhostfolioBaseUrl
    });

    try {
      const createOrderParamsResult = parseCreateOrderParams(requestBody.createOrderParams);
      if (!createOrderParamsResult.ok) {
        const err = createOrderParamsResult as { error: string; status: 400 };
        response.status(err.status).json({ code: 'VALIDATION_ERROR', error: err.error });
        return;
      }

      const chatResponse = (await requestAgent.chat({
        ...validation.params,
        createOrderParams: createOrderParamsResult.params,
        impersonationId: impersonationValidation.value,
        token
      })) as AgentChatResponse;

      const totalMs = Math.max(0, Date.now() - requestStartedAt);
      const breakdown = summarizeTraceLatency(chatResponse.trace);
      chatResponse.latency = {
        llmMs: breakdown.llmMs,
        toolMs: breakdown.toolMs,
        totalMs
      };

      response.status(200).json(chatResponse);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unhandled agent.chat failure';
      logger.error('[agent.chat] UNHANDLED_ERROR', { message });
      response.status(500).json({
        answer: 'Something went wrong. Please try again.',
        error: 'AGENT_CHAT_FAILED'
      });
    }
  };
}

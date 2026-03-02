/**
 * Purpose: Build user-facing failure answers and tool-failure responses for agent chat.
 * Centralizes auth/API/generic failure message logic used when all tools fail or no usable data.
 */

import type { AgentChatResponse, AgentLlm } from '../types';
import { buildToolFailureResponse } from './llm-runtime';
import { sanitizeToolErrorMessage } from './agent-helpers';

/**
 * Derives a single failure answer string from orchestration errors (auth, API, or generic tool failure).
 * Used when all tools failed or when there is no usable tool data but errors exist.
 */
export function getFailureAnswerFromErrors(
  errors: AgentChatResponse['errors'],
  llm?: AgentLlm
): string {
  const authFailure = errors.some(({ message: errorMessage }) =>
    /Ghostfolio API request failed: (401|403)/.test(errorMessage)
  );
  const apiFailure = errors.some(
    ({ message: errorMessage }) =>
      /Ghostfolio API request failed: \d{3}/.test(errorMessage) ||
      errorMessage.includes('GHOSTFOLIO_')
  );
  const firstToolError =
    errors.find(({ code }) => code === 'TOOL_EXECUTION_FAILED')?.message ??
    'I could not complete the request because all selected tools failed. Please retry.';
  const sanitizedToolError = sanitizeToolErrorMessage(firstToolError);

  if (authFailure) {
    return 'I could not access your Ghostfolio data because authentication failed. Please sign in again and retry.';
  }
  if (apiFailure) {
    return 'I could not fetch data from the Ghostfolio API right now. Please retry.';
  }
  return llm
    ? sanitizedToolError
    : 'I could not complete the request because a tool failed. Please retry.';
}

export function buildToolFailureResponseFromErrors(
  params: {
    conversation: AgentChatResponse['conversation'];
    errors: AgentChatResponse['errors'];
    llm?: AgentLlm;
    toolCalls: AgentChatResponse['toolCalls'];
    trace: AgentChatResponse['trace'];
  }
): AgentChatResponse {
  const answer = getFailureAnswerFromErrors(params.errors, params.llm);
  return buildToolFailureResponse({
    answer,
    conversation: params.conversation,
    errors: params.errors,
    toolCalls: params.toolCalls,
    trace: params.trace
  });
}

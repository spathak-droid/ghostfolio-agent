import type { Response } from 'express';

/**
 * Send a structured validation error (HTTP 400).
 * Use for token, body, impersonation, and other client input validation failures.
 */
export function sendValidationError(
  response: Response,
  error: string,
  status: 400 = 400
): void {
  response.status(status).json({ code: 'VALIDATION_ERROR', error });
}

/**
 * Send a structured configuration error (HTTP 500).
 * Use for base URL, allowed hosts, and other server configuration failures.
 */
export function sendConfigError(response: Response, error: string): void {
  response.status(500).json({ code: 'CONFIGURATION_ERROR', error });
}

/**
 * Send a structured agent failure (HTTP 500).
 * Use for unhandled exceptions in chat, clear, history, or other agent operations.
 */
export function sendAgentFailed(
  response: Response,
  errorCode: 'AGENT_CHAT_FAILED' | 'AGENT_CHAT_CLEAR_FAILED' | 'AGENT_HISTORY_FAILED',
  options: { answer?: string } = {}
): void {
  const body: Record<string, string> = { code: errorCode, error: errorCode };
  if (options.answer !== undefined) {
    body.answer = options.answer;
  }
  response.status(500).json(body);
}

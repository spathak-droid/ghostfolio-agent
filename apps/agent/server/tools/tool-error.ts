import { GhostfolioApiError } from '../ghostfolio-api-error';

export interface ToolErrorPayload {
  error_code: string;
  message: string;
  retryable: boolean;
}

export function toToolErrorPayload(error: unknown): ToolErrorPayload {
  if (error instanceof GhostfolioApiError) {
    return {
      error_code: error.code,
      message: error.message,
      retryable: error.retryable
    };
  }
  if (error instanceof Error) {
    return {
      error_code: 'TOOL_EXECUTION_FAILED',
      message: error.message,
      retryable: true
    };
  }
  return {
    error_code: 'TOOL_EXECUTION_FAILED',
    message: String(error),
    retryable: true
  };
}

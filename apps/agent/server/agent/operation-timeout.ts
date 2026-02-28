/**
 * Operation timeout: Wraps async operations with timeout protection.
 * Prevents tools and LLM calls from hanging indefinitely.
 */

import { AppError } from '../utils';

export const AGENT_OPERATION_TIMEOUT_MS = 25_000;

export class AgentOperationTimeoutError extends AppError {
  operation: string;
  timeoutMs: number;

  constructor(operation: string, timeoutMs: number) {
    super(
      'AGENT_OPERATION_TIMEOUT',
      `${operation} timed out after ${timeoutMs}ms`,
      true
    );
    this.name = 'AgentOperationTimeoutError';
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

export function isTimeoutError(error: unknown): error is AgentOperationTimeoutError {
  const code = Boolean(error) && typeof error === 'object' ? (error as { code?: string }).code : undefined;
  const name = Boolean(error) && typeof error === 'object' ? (error as { name?: string }).name : undefined;
  return (
    error instanceof AgentOperationTimeoutError ||
    code === 'AGENT_OPERATION_TIMEOUT' ||
    code === 'OPENAI_TIMEOUT' ||
    name === 'AbortError'
  );
}

export function timeoutMessageForOperation(operation: string) {
  if (operation.startsWith('tool.')) {
    return 'I could not complete this request because a tool timed out after 25 seconds. Please retry.';
  }
  return 'I could not complete this request because the language model timed out after 25 seconds. Please retry.';
}

export async function withOperationTimeout<T>({
  operation,
  task,
  timeoutMs = AGENT_OPERATION_TIMEOUT_MS
}: {
  operation: string;
  task: () => Promise<T>;
  timeoutMs?: number;
}): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task(),
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new AgentOperationTimeoutError(operation, timeoutMs)), timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

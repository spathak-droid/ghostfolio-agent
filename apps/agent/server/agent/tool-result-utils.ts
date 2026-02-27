import type { AgentChatResponse } from '../types';

export function hasUsableToolData(toolCalls: AgentChatResponse['toolCalls']) {
  return toolCalls.some(({ result, success }) => {
    if (!success) {
      return false;
    }

    if (!isObject(result)) {
      return false;
    }

    if (hasPopulatedField(result, 'summary')) {
      return true;
    }

    if (hasPopulatedArray(result, 'prices')) {
      return true;
    }

    if (hasPopulatedArray(result, 'timeline')) {
      return true;
    }

    if (hasPopulatedArray(result, 'categories')) {
      return true;
    }

    if (hasPopulatedArray(result, 'transactions')) {
      return true;
    }

    const data = result.data;
    if (!isObject(data)) {
      return false;
    }

    return (
      hasPopulatedArray(data, 'activities') ||
      hasPopulatedObject(data, 'holdings') ||
      hasPopulatedObject(data, 'summary')
    );
  });
}

export function getReportedToolFailure(
  value: unknown
): { errorCode: string; message: string; recoverable: boolean } | undefined {
  if (!isObject(value) || value.success !== false) {
    return undefined;
  }

  const error = isObject(value.error) ? value.error : undefined;
  const errorMessage =
    typeof error?.message === 'string' && error.message.trim().length > 0
      ? error.message
      : typeof value.summary === 'string' && value.summary.trim().length > 0
        ? value.summary
        : 'tool reported failure';

  const recoverable =
    typeof error?.retryable === 'boolean' ? error.retryable : true;
  const errorCode =
    typeof error?.error_code === 'string' && error.error_code.trim().length > 0
      ? error.error_code
      : 'TOOL_EXECUTION_FAILED';

  return {
    errorCode,
    message: errorMessage,
    recoverable
  };
}

export function inferToolRecoverableFromThrownError(error: unknown): boolean {
  if (isObject(error) && typeof error.retryable === 'boolean') {
    return error.retryable;
  }
  return true;
}

export function extractTransactions(result: Record<string, unknown>): Record<string, unknown>[] {
  const directTransactions = result.transactions;
  if (Array.isArray(directTransactions)) {
    return directTransactions.filter(isObject);
  }

  const data = result.data;
  if (isObject(data) && Array.isArray(data.activities)) {
    return data.activities.filter(isObject);
  }

  return [];
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasPopulatedField(value: Record<string, unknown>, field: string) {
  const item = value[field];
  return typeof item === 'string' ? item.trim().length > 0 : Boolean(item);
}

function hasPopulatedArray(value: Record<string, unknown>, field: string) {
  const item = value[field];
  return Array.isArray(item) && item.length > 0;
}

function hasPopulatedObject(value: Record<string, unknown>, field: string) {
  const item = value[field];
  return isObject(item) && Object.keys(item).length > 0;
}

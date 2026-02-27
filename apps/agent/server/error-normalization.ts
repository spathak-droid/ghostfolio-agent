type FailureReason = 'tool_failure' | 'tool_timeout';

function redactSecrets(value: string): string {
  let sanitized = value;
  sanitized = sanitized.replace(
    /\b[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    '[REDACTED_JWT]'
  );
  sanitized = sanitized.replace(
    /\b(authorization|token|access[_-]?token|api[_-]?key|password)\b\s*[:=]\s*([^\s,;]+)/gi,
    '$1=[REDACTED]'
  );
  return sanitized;
}

/**
 * Single place for mapping tool execution outcomes to orchestration error entries.
 * Use for errors[] and for building toolCalls[].result when success is false.
 * Timeouts are always recoverable; tool-reported failures use tool's retryable; throws default recoverable true.
 */
export function toOrchestrationErrorEntry({
  isTimeout,
  message,
  recoverable
}: {
  isTimeout: boolean;
  message: string;
  recoverable: boolean;
}): { code: 'TOOL_EXECUTION_TIMEOUT' | 'TOOL_EXECUTION_FAILED'; message: string; recoverable: boolean } {
  const code = isTimeout ? 'TOOL_EXECUTION_TIMEOUT' : 'TOOL_EXECUTION_FAILED';
  const effectiveRecoverable = isTimeout ? true : recoverable;
  return {
    code,
    message,
    recoverable: effectiveRecoverable
  };
}

export function sanitizeErrorMessageForClient(
  raw: unknown,
  fallback = 'tool execution failed'
): string {
  if (typeof raw !== 'string') {
    return fallback;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length < 2) {
    return fallback;
  }

  const redacted = redactSecrets(trimmed);
  const statusMatch = /Ghostfolio API request failed:\s*(\d{3})/i.exec(redacted);
  if (statusMatch?.[1]) {
    return `Ghostfolio API request failed: ${statusMatch[1]}`;
  }

  const codeMatch = /\b(GHOSTFOLIO_[A-Z_]+)\b/.exec(redacted);
  if (codeMatch?.[1]) {
    return `Ghostfolio API error: ${codeMatch[1]}`;
  }

  return redacted.length > 240 ? `${redacted.slice(0, 240)}...` : redacted;
}

export function buildToolCallFailureResult({
  errorCode,
  message,
  reason,
  retryable
}: {
  errorCode: string;
  message: string;
  reason: FailureReason;
  retryable: boolean;
}) {
  return {
    error: {
      error_code: errorCode,
      message,
      retryable
    },
    errorMessage: message,
    reason
  };
}

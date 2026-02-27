import {
  buildToolCallFailureResult,
  sanitizeErrorMessageForClient,
  toOrchestrationErrorEntry
} from '../../server/utils';

describe('toOrchestrationErrorEntry', () => {
  it('returns TOOL_EXECUTION_TIMEOUT and recoverable true when isTimeout is true', () => {
    const entry = toOrchestrationErrorEntry({
      isTimeout: true,
      message: 'tool timed out',
      recoverable: false
    });
    expect(entry.code).toBe('TOOL_EXECUTION_TIMEOUT');
    expect(entry.message).toBe('tool timed out');
    expect(entry.recoverable).toBe(true);
  });

  it('returns TOOL_EXECUTION_FAILED and preserves recoverable when isTimeout is false', () => {
    const entry = toOrchestrationErrorEntry({
      isTimeout: false,
      message: 'API error',
      recoverable: false
    });
    expect(entry.code).toBe('TOOL_EXECUTION_FAILED');
    expect(entry.message).toBe('API error');
    expect(entry.recoverable).toBe(false);
  });

  it('preserves recoverable true for non-timeout', () => {
    const entry = toOrchestrationErrorEntry({
      isTimeout: false,
      message: 'retryable error',
      recoverable: true
    });
    expect(entry.code).toBe('TOOL_EXECUTION_FAILED');
    expect(entry.recoverable).toBe(true);
  });
});

describe('sanitizeErrorMessageForClient', () => {
  it('returns fallback for non-string or empty input', () => {
    expect(sanitizeErrorMessageForClient(null)).toBe('tool execution failed');
    expect(sanitizeErrorMessageForClient('')).toBe('tool execution failed');
    expect(sanitizeErrorMessageForClient('   ')).toBe('tool execution failed');
    expect(sanitizeErrorMessageForClient(42)).toBe('tool execution failed');
    expect(sanitizeErrorMessageForClient('x', 'custom')).toBe('custom');
  });

  it('redacts JWT-like strings', () => {
    const msg = 'Token abc.def.ghi expired';
    expect(sanitizeErrorMessageForClient(msg)).toContain('[REDACTED_JWT]');
    expect(sanitizeErrorMessageForClient(msg)).not.toContain('abc.def.ghi');
  });

  it('normalizes Ghostfolio API status to safe message', () => {
    expect(sanitizeErrorMessageForClient('Ghostfolio API request failed: 401')).toBe(
      'Ghostfolio API request failed: 401'
    );
    expect(sanitizeErrorMessageForClient('Ghostfolio API request failed: 503')).toBe(
      'Ghostfolio API request failed: 503'
    );
  });

  it('normalizes GHOSTFOLIO_ code to safe message', () => {
    expect(sanitizeErrorMessageForClient('Error: GHOSTFOLIO_UNAUTHORIZED')).toBe(
      'Ghostfolio API error: GHOSTFOLIO_UNAUTHORIZED'
    );
  });

  it('truncates long messages to 240 chars', () => {
    const long = 'x'.repeat(300);
    const result = sanitizeErrorMessageForClient(long);
    expect(result.length).toBeLessThanOrEqual(243);
    expect(result).toMatch(/\.\.\.$/);
  });
});

describe('buildToolCallFailureResult', () => {
  it('returns structured error and reason', () => {
    const result = buildToolCallFailureResult({
      errorCode: 'TOOL_EXECUTION_FAILED',
      message: 'Something went wrong',
      reason: 'tool_failure',
      retryable: true
    });
    expect(result.error).toEqual({
      error_code: 'TOOL_EXECUTION_FAILED',
      message: 'Something went wrong',
      retryable: true
    });
    expect(result.errorMessage).toBe('Something went wrong');
    expect(result.reason).toBe('tool_failure');
  });

  it('supports tool_timeout reason and retryable false', () => {
    const result = buildToolCallFailureResult({
      errorCode: 'TOOL_EXECUTION_TIMEOUT',
      message: 'Timed out',
      reason: 'tool_timeout',
      retryable: false
    });
    expect(result.error.error_code).toBe('TOOL_EXECUTION_TIMEOUT');
    expect(result.error.retryable).toBe(false);
    expect(result.reason).toBe('tool_timeout');
  });
});

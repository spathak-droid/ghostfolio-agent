import {
  CHAT_VALIDATION,
  parseCreateOrderParams,
  validateChatBody,
  validateImpersonationId,
  validateTokenLength
} from '../../server/chat-request-validation';

describe('validateChatBody', () => {
  const validBody = {
    message: 'What is my portfolio allocation?',
    conversationId: 'conv-123'
  };

  it('accepts valid minimal body', () => {
    const result = validateChatBody(validBody);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.params.message).toBe('What is my portfolio allocation?');
      expect(result.params.conversationId).toBe('conv-123');
    }
  });

  it('rejects non-object body', () => {
    const result = validateChatBody(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result as { status: 400; error: string };
      expect(err.status).toBe(400);
      expect(err.error).toContain('JSON object');
    }
  });

  it('rejects missing message', () => {
    const result = validateChatBody({ conversationId: 'c1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result as { error: string }).error).toContain('message is required');
  });

  it('rejects non-string message', () => {
    const result = validateChatBody({ message: 42, conversationId: 'c1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result as { error: string }).error).toContain('message must be a string');
  });

  it('rejects empty message after trim', () => {
    const result = validateChatBody({ message: '   ', conversationId: 'c1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result as { error: string }).error).toContain('empty');
  });

  it('rejects message over max length', () => {
    const result = validateChatBody({
      message: 'x'.repeat(CHAT_VALIDATION.MAX_MESSAGE_LENGTH + 1),
      conversationId: 'c1'
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result as { error: string }).error).toContain('at most');
  });

  it('rejects message with control characters', () => {
    const result = validateChatBody({
      conversationId: 'c1',
      message: 'hello\u0000world'
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result as { error: string }).error).toContain('control characters');
  });

  it('rejects missing conversationId', () => {
    const result = validateChatBody({ message: 'hi' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result as { error: string }).error).toContain('conversationId is required');
  });

  it('rejects empty conversationId after trim', () => {
    const result = validateChatBody({ message: 'hi', conversationId: '  ' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result as { error: string }).error).toContain('conversationId');
  });

  it('rejects conversationId with control characters', () => {
    const result = validateChatBody({ message: 'hi', conversationId: 'abc\n123' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result as { error: string }).error).toContain('control characters');
  });

  it('rejects take out of range', () => {
    const result = validateChatBody({
      ...validBody,
      take: 0
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result as { error: string }).error).toContain('take');
  });

  it('accepts take in range', () => {
    const result = validateChatBody({ ...validBody, take: 100 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.params.take).toBe(100);
  });

  it('accepts valid dateFrom/dateTo', () => {
    const result = validateChatBody({
      ...validBody,
      dateFrom: '2025-01-01',
      dateTo: '2025-12-31'
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.params.dateFrom).toBe('2025-01-01');
      expect(result.params.dateTo).toBe('2025-12-31');
    }
  });

  it('rejects invalid dateFrom format', () => {
    const result = validateChatBody({
      ...validBody,
      dateFrom: '01-01-2025'
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result as { error: string }).error).toContain('dateFrom');
  });

  it('rejects invalid calendar dates', () => {
    const result = validateChatBody({
      ...validBody,
      dateFrom: '2025-02-30'
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result as { error: string }).error).toContain('dateFrom');
  });

  it('rejects dateFrom after dateTo', () => {
    const result = validateChatBody({
      ...validBody,
      dateFrom: '2025-12-31',
      dateTo: '2025-01-01'
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result as { error: string }).error).toContain('dateFrom must be before or equal to dateTo');
  });

  it('rejects symbols arrays containing non-string items', () => {
    const result = validateChatBody({
      ...validBody,
      symbols: ['AAPL', 123]
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result as { error: string }).error).toContain('symbols must contain only strings');
  });

  it('rejects invalid range values', () => {
    const result = validateChatBody({
      ...validBody,
      range: 'all-time'
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result as { error: string }).error).toContain('range must be one of');
  });

  it('rejects invalid type values', () => {
    const result = validateChatBody({
      ...validBody,
      type: 'TRANSFER'
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result as { error: string }).error).toContain('type must be one of');
  });

  it('rejects unknown top-level request fields', () => {
    const result = validateChatBody({
      ...validBody,
      notAllowed: 'x'
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result as { error: string }).error).toContain('Unknown request field');
  });

  it('rejects unsupported metrics', () => {
    const result = validateChatBody({
      ...validBody,
      metrics: ['change_percent_1w']
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result as { error: string }).error).toContain('metrics must be one of');
  });
});

describe('validateTokenLength', () => {
  it('accepts undefined token', () => {
    expect(validateTokenLength(undefined).ok).toBe(true);
  });

  it('accepts token within limit', () => {
    expect(validateTokenLength('abc.def.ghi').ok).toBe(true);
  });

  it('rejects token over limit', () => {
    const result = validateTokenLength('x'.repeat(CHAT_VALIDATION.MAX_TOKEN_LENGTH + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result as { status: 400; error: string };
      expect(err.status).toBe(400);
      expect(err.error).toContain('Token');
    }
  });

  it('rejects malformed token shape', () => {
    const result = validateTokenLength('not-a-jwt');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result as { status: 400; error: string };
      expect(err.error).toContain('must be a JWT');
    }
  });

  it('rejects token with control characters', () => {
    const result = validateTokenLength('abc.def.ghi\n');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result as { status: 400; error: string };
      expect(err.error).toContain('contains invalid characters');
    }
  });
});

describe('validateImpersonationId', () => {
  it('accepts undefined impersonation id', () => {
    expect(validateImpersonationId(undefined).ok).toBe(true);
  });

  it('rejects invalid characters', () => {
    const result = validateImpersonationId('abc/123');
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result as { error: string }).error).toContain('invalid characters');
  });
});

describe('parseCreateOrderParams', () => {
  it('rejects invalid type enum', () => {
    const result = parseCreateOrderParams({ type: 'TRANSFER' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result as { error: string }).error).toContain('createOrderParams.type');
  });

  it('rejects non-positive quantity', () => {
    const result = parseCreateOrderParams({ quantity: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result as { error: string }).error).toContain('createOrderParams.quantity');
  });

  it('rejects quantity above hard limit', () => {
    const result = parseCreateOrderParams({ quantity: 1e12 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result as { error: string }).error).toContain('at most');
  });

  it('rejects unitPrice above hard limit', () => {
    const result = parseCreateOrderParams({ unitPrice: 1e18 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result as { error: string }).error).toContain('at most');
  });

  it('accepts valid create order params', () => {
    const result = parseCreateOrderParams({
      date: '2026-02-26T00:00:00.000Z',
      quantity: 2,
      symbol: 'AAPL',
      type: 'BUY'
    });
    expect(result.ok).toBe(true);
  });

  it('rejects unknown createOrderParams fields', () => {
    const result = parseCreateOrderParams({
      symbol: 'AAPL',
      unexpected: true
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result as { error: string }).error).toContain('unknown field');
  });
});

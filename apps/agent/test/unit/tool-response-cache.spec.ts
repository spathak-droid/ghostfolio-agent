import {
  buildToolCacheKey,
  createToolResponseCacheStoreFromEnv,
  withToolResponseCache
} from '../../server/stores';

describe('tool-response-cache', () => {
  it('returns cached value on second call', async () => {
    const cache = createToolResponseCacheStoreFromEnv({});
    const task = jest.fn().mockResolvedValue({ summary: 'ok' });

    const first = await withToolResponseCache({
      cache,
      input: { message: 'analyze my portfolio', token: 'jwt-token' },
      task,
      toolName: 'portfolio_analysis',
      ttlMs: 10_000
    });
    const second = await withToolResponseCache({
      cache,
      input: { message: 'analyze my portfolio', token: 'jwt-token' },
      task,
      toolName: 'portfolio_analysis',
      ttlMs: 10_000
    });

    expect(first).toEqual({ summary: 'ok' });
    expect(second).toEqual({ summary: 'ok' });
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('expires cached value after ttl', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-02-27T00:00:00.000Z'));
    try {
      const cache = createToolResponseCacheStoreFromEnv({});
      const task = jest
        .fn()
        .mockResolvedValueOnce({ summary: 'first' })
        .mockResolvedValueOnce({ summary: 'second' });

      const first = await withToolResponseCache({
        cache,
        input: { message: 'analyze my portfolio', token: 'jwt-token' },
        task,
        toolName: 'portfolio_analysis',
        ttlMs: 1_000
      });

      jest.setSystemTime(new Date('2026-02-27T00:00:02.000Z'));

      const second = await withToolResponseCache({
        cache,
        input: { message: 'analyze my portfolio', token: 'jwt-token' },
        task,
        toolName: 'portfolio_analysis',
        ttlMs: 1_000
      });

      expect(first).toEqual({ summary: 'first' });
      expect(second).toEqual({ summary: 'second' });
      expect(task).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('uses token hash in cache key and does not leak raw token', () => {
    const key = buildToolCacheKey({
      input: { message: 'analyze my portfolio', token: 'super-secret-token' },
      toolName: 'portfolio_analysis'
    });

    expect(key).toContain('portfolio_analysis:');
    expect(key).not.toContain('super-secret-token');
  });
});

import { GhostfolioClient } from '../../server/ghostfolio-client';
import { GhostfolioApiError } from '../../server/ghostfolio-api-error';
import { logger } from '../../server/logger';

describe('GhostfolioClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('retries once when GET (non-portfolio) returns empty body and then succeeds with JSON', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => ''
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{"id":"x"}'
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new GhostfolioClient('http://localhost:3333');
    const result = await client.getUser({ token: 'abc' });

    expect(result).toEqual({ id: 'x' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns empty portfolio fallback when GET /portfolio/details returns 200 with empty body', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => ''
    }) as unknown as typeof fetch;

    const client = new GhostfolioClient('http://localhost:3333');
    const result = await client.getPortfolioSummary({ token: 'abc' });

    expect(result).toMatchObject({
      hasError: false,
      accounts: {},
      holdings: {},
      platforms: {}
    });
    expect(typeof (result as Record<string, unknown>).createdAt).toBe('string');
  });

  it('returns empty portfolio fallback when GET /portfolio/holdings returns 200 with empty body', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => ''
    }) as unknown as typeof fetch;

    const client = new GhostfolioClient('http://localhost:3333');
    const result = await client.getPortfolioHoldings({ range: 'max', token: 'abc' });

    expect(result).toMatchObject({
      hasError: false,
      accounts: {},
      holdings: {},
      platforms: {}
    });
    expect(typeof (result as Record<string, unknown>).createdAt).toBe('string');
  });

  it('fetches portfolio performance from /api/v2/portfolio/performance endpoint', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          chart: [{ date: '2026-02-26', netWorth: 123 }],
          performance: { netPerformance: 10 }
        })
    }) as unknown as typeof fetch;

    const client = new GhostfolioClient('http://localhost:3333');
    const result = await client.getPortfolioPerformance({ range: 'max', token: 'abc' });

    expect(result).toEqual({
      chart: [{ date: '2026-02-26', netWorth: 123 }],
      performance: { netPerformance: 10 }
    });
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3333/api/v2/portfolio/performance?range=max',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer abc'
        })
      })
    );
  });

  it('logs API call metadata for successful POST requests', async () => {
    const debugSpy = jest.spyOn(logger, 'debug').mockImplementation(() => undefined);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"id":"order-1"}'
    }) as unknown as typeof fetch;

    const client = new GhostfolioClient('http://localhost:3333');
    await client.createOrder(
      {
        type: 'BUY',
        symbol: 'TSLA',
        currency: 'USD',
        date: '2026-01-01T00:00:00.000Z',
        quantity: 2,
        unitPrice: 100,
        fee: 0
      },
      { token: 'abc' }
    );

    expect(debugSpy).toHaveBeenCalledWith(
      '[ghostfolio-api]',
      expect.stringContaining('"method":"POST"')
    );
    expect(debugSpy).toHaveBeenCalledWith(
      '[ghostfolio-api]',
      expect.stringContaining('"path":"/api/v1/order"')
    );
  });

  it('fails fast when Ghostfolio API request times out', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          (error as Error & { name: string }).name = 'AbortError';
          reject(error);
        });
      });
    }) as unknown as typeof fetch;

    const client = new GhostfolioClient('http://localhost:3333');
    const pending = client.getUser({ token: 'abc' });

    jest.advanceTimersByTime(15001);
    await expect(pending).rejects.toThrow('timed out');
    jest.useRealTimers();
  });

  it('throws GhostfolioApiError with retryable=true for 500 responses', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => '{"message":"boom"}'
    }) as unknown as typeof fetch;

    const client = new GhostfolioClient('http://localhost:3333');
    await expect(client.getUser({ token: 'abc' })).rejects.toEqual(
      expect.objectContaining({
        code: 'GHOSTFOLIO_HTTP_ERROR',
        retryable: true,
        status: 500
      })
    );
    await expect(client.getUser({ token: 'abc' })).rejects.toBeInstanceOf(GhostfolioApiError);
  });

  it('does not include upstream response body in POST error message', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => '{"secret":"token-12345"}'
    }) as unknown as typeof fetch;

    const client = new GhostfolioClient('http://localhost:3333');
    await expect(
      client.createOrder(
        {
          type: 'BUY',
          symbol: 'TSLA',
          currency: 'USD',
          date: '2026-01-01T00:00:00.000Z',
          quantity: 2,
          unitPrice: 100,
          fee: 0
        },
        { token: 'abc' }
      )
    ).rejects.toEqual(
      expect.objectContaining({
        message: expect.not.stringContaining('token-12345')
      })
    );
  });
});

import { GhostfolioClient } from '../../server/ghostfolio-client';

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
});

import { GhostfolioClient } from '../../server/ghostfolio-client';

describe('GhostfolioClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('retries once when GET returns empty body and then succeeds with JSON', async () => {
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
        text: async () => '{"summary":{"totalValueInBaseCurrency":123}}'
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new GhostfolioClient('http://localhost:3333');
    const result = await client.getPortfolioSummary({ token: 'abc' });

    expect(result).toEqual({ summary: { totalValueInBaseCurrency: 123 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws descriptive error when GET keeps returning empty body', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => ''
    }) as unknown as typeof fetch;

    const client = new GhostfolioClient('http://localhost:3333');

    await expect(client.getPortfolioSummary({ token: 'abc' })).rejects.toThrow(
      'Ghostfolio API returned empty JSON body for GET /api/v1/portfolio/details'
    );
  });
});

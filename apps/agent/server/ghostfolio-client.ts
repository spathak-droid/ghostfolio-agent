import { appendFileSync } from 'fs';
import { join } from 'path';

import { normalizeAuthToken } from './auth-token';

export class GhostfolioClient {
  public constructor(private readonly baseUrl: string) {}

  public async getPortfolioSummary({
    impersonationId,
    token
  }: {
    impersonationId?: string;
    token?: string;
  }) {
    return this.get('/api/v1/portfolio/details', { impersonationId, token });
  }

  public async getMarketData({
    impersonationId,
    token
  }: {
    impersonationId?: string;
    token?: string;
  }) {
    return this.get('/api/v1/market-data/markets', { impersonationId, token });
  }

  public async getTransactions({
    impersonationId,
    token
  }: {
    impersonationId?: string;
    token?: string;
  }) {
    return this.get('/api/v1/order?range=max&take=200', { impersonationId, token });
  }

  public async getSymbolLookup({
    query,
    impersonationId,
    token
  }: {
    query: string;
    impersonationId?: string;
    token?: string;
  }) {
    const path =
      '/api/v1/symbol/lookup' +
      (query.trim() ? `?${new URLSearchParams({ query: query.trim() }).toString()}` : '');
    return this.get(path, { impersonationId, token });
  }

  public async getSymbolData({
    dataSource,
    symbol,
    includeHistoricalData = 0,
    impersonationId,
    token
  }: {
    dataSource: string;
    symbol: string;
    includeHistoricalData?: number;
    impersonationId?: string;
    token?: string;
  }) {
    const path =
      `/api/v1/symbol/${encodeURIComponent(dataSource)}/${encodeURIComponent(symbol)}` +
      (includeHistoricalData > 0
        ? `?${new URLSearchParams({ includeHistoricalData: String(includeHistoricalData) }).toString()}`
        : '');
    return this.get(path, { impersonationId, token });
  }

  private async get(
    path: string,
    {
      impersonationId,
      token
    }: {
      impersonationId?: string;
      token?: string;
    }
  ) {
    const headers: Record<string, string> = {};
    const normalizedToken = normalizeAuthToken(token);
    const hasToken = Boolean(normalizedToken);

    // #region agent log
    try {
      const logPath = join(process.cwd(), '.cursor', 'debug-af2e79.log');
      appendFileSync(
        logPath,
        JSON.stringify({
          location: 'ghostfolio-client.ts:get',
          message: 'calling Ghostfolio API',
          hasToken,
          path,
          baseUrl: this.baseUrl,
          timestamp: Date.now()
        }) + '\n'
      );
    } catch {
      // ignore
    }
    // eslint-disable-next-line no-console
    console.log('[agent-auth] GhostfolioClient.get:', { hasToken, path, baseUrl: this.baseUrl });
    // #endregion

    if (normalizedToken) {
      headers.Authorization = `Bearer ${normalizedToken}`;
    }

    if (impersonationId) {
      headers['Impersonation-Id'] = impersonationId;
    }

    const response = await fetch(`${this.baseUrl}${path}`, { headers });

    if (!response.ok) {
      throw new Error(`Ghostfolio API request failed: ${response.status}`);
    }

    return response.json();
  }
}

import { appendFileSync } from 'fs';
import { join } from 'path';

import { normalizeAuthToken } from './auth-token';

/** Request body for POST /api/v1/order (create order). */
export interface CreateOrderDtoBody {
  type: string;
  symbol: string;
  currency: string;
  date: string;
  quantity: number;
  unitPrice: number;
  fee: number;
  accountId?: string;
  dataSource?: string;
  comment?: string;
  tags?: string[];
  updateAccountBalance?: boolean;
  assetClass?: string;
  assetSubClass?: string;
  customCurrency?: string;
}

/** Request body for PUT /api/v1/order/:id (update order). */
export interface UpdateOrderDtoBody {
  id: string;
  type: string;
  symbol: string;
  dataSource: string;
  currency: string;
  date: string;
  quantity: number;
  unitPrice: number;
  fee: number;
  accountId?: string;
  comment?: string;
  tags?: string[];
  updateAccountBalance?: boolean;
}

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

  public async getUser({
    impersonationId,
    token
  }: {
    impersonationId?: string;
    token?: string;
  }) {
    return this.get('/api/v1/user', { impersonationId, token });
  }

  public async getOrderById(
    orderId: string,
    {
      impersonationId,
      token
    }: {
      impersonationId?: string;
      token?: string;
    }
  ) {
    return this.get(`/api/v1/order/${encodeURIComponent(orderId)}`, {
      impersonationId,
      token
    });
  }

  public async createOrder(
    dto: CreateOrderDtoBody,
    {
      impersonationId,
      token
    }: {
      impersonationId?: string;
      token?: string;
    }
  ) {
    const body = { ...dto, updateAccountBalance: true };
    return this.post<{ id: string }>('/api/v1/order', body, { impersonationId, token });
  }

  public async updateOrder(
    orderId: string,
    dto: UpdateOrderDtoBody,
    { token }: { token?: string }
  ) {
    const body = { ...dto, id: orderId, updateAccountBalance: true };
    return this.put(`/api/v1/order/${encodeURIComponent(orderId)}`, body, { token });
  }

  private buildHeaders({
    impersonationId,
    token
  }: {
    impersonationId?: string;
    token?: string;
  }): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const normalizedToken = normalizeAuthToken(token);
    if (normalizedToken) {
      headers.Authorization = `Bearer ${normalizedToken}`;
    }
    if (impersonationId) {
      headers['Impersonation-Id'] = impersonationId;
    }
    return headers;
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
    const headers = this.buildHeaders({ impersonationId, token });
    const hasToken = Boolean(normalizeAuthToken(token));

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

    const response = await fetch(`${this.baseUrl}${path}`, { headers });

    if (!response.ok) {
      throw new Error(`Ghostfolio API request failed: ${response.status}`);
    }

    return response.json();
  }

  private async post<T = unknown>(
    path: string,
    body: unknown,
    {
      impersonationId,
      token
    }: {
      impersonationId?: string;
      token?: string;
    }
  ): Promise<T> {
    const headers = this.buildHeaders({ impersonationId, token });
    const response = await fetch(`${this.baseUrl}${path}`, {
      body: JSON.stringify(body),
      headers,
      method: 'POST'
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ghostfolio API request failed: ${response.status} ${text}`);
    }
    return response.json() as Promise<T>;
  }

  private async put<T = unknown>(
    path: string,
    body: unknown,
    { token }: { token?: string }
  ): Promise<T> {
    const headers = this.buildHeaders({ token });
    const response = await fetch(`${this.baseUrl}${path}`, {
      body: JSON.stringify(body),
      headers,
      method: 'PUT'
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ghostfolio API request failed: ${response.status} ${text}`);
    }
    return response.json() as Promise<T>;
  }
}

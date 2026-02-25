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
    range = 'max',
    take = 200,
    impersonationId,
    token
  }: {
    range?: string;
    take?: number;
    impersonationId?: string;
    token?: string;
  }) {
    const params = new URLSearchParams({
      range: range.trim() || 'max',
      take: String(Math.max(1, Math.min(1000, Math.trunc(take))))
    });
    return this.get(`/api/v1/order?${params.toString()}`, { impersonationId, token });
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
    { impersonationId, token }: { impersonationId?: string; token?: string }
  ) {
    const body = { ...dto, id: orderId, updateAccountBalance: true };
    return this.put(`/api/v1/order/${encodeURIComponent(orderId)}`, body, {
      impersonationId,
      token
    });
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

  private logGhostfolioFailure(
    method: string,
    path: string,
    status: number,
    bodyText?: string
  ): void {
    const payload = {
      method,
      path,
      status,
      baseUrl: this.baseUrl,
      timestamp: Date.now(),
      ...(bodyText !== undefined && { responseBody: bodyText.slice(0, 500) })
    };
    // eslint-disable-next-line no-console
    console.log('[ghostfolio-api-failure]', JSON.stringify(payload));
    try {
      appendFileSync(
        join(process.cwd(), '.cursor', 'debug-af2e79.log'),
        JSON.stringify({ location: 'ghostfolio-client.ts', message: 'Ghostfolio API failure', ...payload }) + '\n'
      );
    } catch {
      // ignore
    }
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
  ): Promise<Record<string, unknown>> {
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

    const maxGetParseAttempts = 2;

    for (let attempt = 1; attempt <= maxGetParseAttempts; attempt += 1) {
      const response = await fetch(`${this.baseUrl}${path}`, { headers });

      if (!response.ok) {
        const bodyText = await response.text();
        this.logGhostfolioFailure('GET', path, response.status, bodyText);
        const hint =
          response.status === 401
            ? ' (check: you are signed in; agent GHOSTFOLIO_BASE_URL matches this app URL)'
            : '';
        throw new Error(`Ghostfolio API request failed: ${response.status}${hint}`);
      }

      try {
        return await this.parseJsonBody<Record<string, unknown>>(response, {
          method: 'GET',
          path
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const canRetry =
          attempt < maxGetParseAttempts &&
          (errorMessage.startsWith('Ghostfolio API returned empty JSON body') ||
            errorMessage.startsWith('Ghostfolio API returned invalid JSON'));

        if (!canRetry) {
          throw error;
        }
      }
    }

    throw new Error(`Ghostfolio API request failed: exhausted parse retries for GET ${path}`);
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
      this.logGhostfolioFailure('POST', path, response.status, text);
      const hint =
        response.status === 401
          ? ' (check: you are signed in; agent GHOSTFOLIO_BASE_URL matches this app URL)'
          : '';
      throw new Error(`Ghostfolio API request failed: ${response.status}${hint} ${text}`);
    }
    return this.parseJsonBody<T>(response, {
      method: 'POST',
      path
    });
  }

  private async put<T = unknown>(
    path: string,
    body: unknown,
    { impersonationId, token }: { impersonationId?: string; token?: string }
  ): Promise<T> {
    const headers = this.buildHeaders({ impersonationId, token });
    const response = await fetch(`${this.baseUrl}${path}`, {
      body: JSON.stringify(body),
      headers,
      method: 'PUT'
    });
    if (!response.ok) {
      const text = await response.text();
      this.logGhostfolioFailure('PUT', path, response.status, text);
      const hint =
        response.status === 401
          ? ' (check: you are signed in; agent GHOSTFOLIO_BASE_URL matches this app URL)'
          : '';
      throw new Error(`Ghostfolio API request failed: ${response.status}${hint} ${text}`);
    }
    return this.parseJsonBody<T>(response, {
      method: 'PUT',
      path
    });
  }

  private async parseJsonBody<T>(
    response: Response,
    {
      method,
      path
    }: {
      method: 'GET' | 'POST' | 'PUT';
      path: string;
    }
  ): Promise<T> {
    const bodyText = await response.text();

    if (!bodyText.trim()) {
      if (response.status === 204) {
        return {} as T;
      }
      const hint =
        ' Set GHOSTFOLIO_BASE_URL to your Ghostfolio app URL (where you open the dashboard), not the agent URL.';
      throw new Error(`Ghostfolio API returned empty JSON body for ${method} ${path}.${hint}`);
    }

    try {
      return JSON.parse(bodyText) as T;
    } catch {
      throw new Error(`Ghostfolio API returned invalid JSON for ${method} ${path}`);
    }
  }
}

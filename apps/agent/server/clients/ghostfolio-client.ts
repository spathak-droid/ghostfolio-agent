import { normalizeAuthToken } from '../auth';
import { GhostfolioApiError } from './ghostfolio-api-error';
import { safeImpersonationId } from '../validation/common';
import { logger } from '../utils';

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

/** One item from GET /api/v1/symbol/lookup response. */
export interface SymbolLookupItemDto {
  name?: string;
  symbol: string;
  assetClass?: string;
  assetSubClass?: string;
  currency?: string;
  dataProviderInfo?: {
    dataSource: string;
    isPremium?: boolean;
    name?: string;
    url?: string;
  };
  dataSource: string;
}

/** Response shape of GET /api/v1/symbol/lookup?query=... */
export interface SymbolLookupResponse {
  items: SymbolLookupItemDto[];
}

export class GhostfolioClient {
  private readonly baseUrl: string;
  private static readonly REQUEST_TIMEOUT_MS = 15000;

  public constructor(baseUrl: string) {
    this.baseUrl = baseUrl.trim().replace(/\/+$/, '') || 'http://localhost:3333';
  }

  /** Minimal valid shape when GET /portfolio/details returns 200 with empty body (e.g. no portfolio yet). */
  private emptyPortfolioDetailsFallback(): Record<string, unknown> {
    return {
      hasError: false,
      accounts: {},
      holdings: {},
      platforms: {},
      createdAt: new Date().toISOString()
    };
  }

  public async getPortfolioSummary({
    impersonationId,
    token
  }: {
    impersonationId?: string;
    token?: string;
  }) {
    return this.get('/api/v1/portfolio/details', { impersonationId, token });
  }

  public async getPortfolioHoldings({
    impersonationId,
    range = 'max',
    token
  }: {
    impersonationId?: string;
    range?: string;
    token?: string;
  }) {
    const params = new URLSearchParams({
      range: range.trim() || 'max'
    });
    return this.get(`/api/v1/portfolio/holdings?${params.toString()}`, { impersonationId, token });
  }

  public async getPortfolioHolding({
    dataSource,
    symbol,
    impersonationId,
    token
  }: {
    dataSource: string;
    symbol: string;
    impersonationId?: string;
    token?: string;
  }) {
    return this.get(
      `/api/v1/portfolio/holding/${encodeURIComponent(dataSource)}/${encodeURIComponent(symbol)}`,
      { impersonationId, token }
    );
  }

  public async getPortfolioPerformance({
    impersonationId,
    range = 'max',
    token
  }: {
    impersonationId?: string;
    range?: string;
    token?: string;
  }) {
    const params = new URLSearchParams({
      range: range.trim() || 'max'
    });
    return this.get(`/api/v2/portfolio/performance?${params.toString()}`, {
      impersonationId,
      token
    });
  }

  public async getPortfolioReport({
    impersonationId,
    token
  }: {
    impersonationId?: string;
    token?: string;
  }) {
    return this.get('/api/v1/portfolio/report', { impersonationId, token });
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
  }): Promise<SymbolLookupResponse> {
    const path =
      '/api/v1/symbol/lookup' +
      (query.trim() ? `?${new URLSearchParams({ query: query.trim() }).toString()}` : '');
    logger.debug('[symbol_lookup] GET', { query: query.trim(), path });
    const result = await this.get(path, { impersonationId, token });
    const raw = result as unknown as SymbolLookupResponse;
    const items = Array.isArray(raw?.items) ? raw.items : [];
    logger.debug('[symbol_lookup] response', { query: query.trim(), itemsCount: items.length });
    return { items };
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
    const sanitized = safeImpersonationId(impersonationId);
    if (sanitized) {
      headers['Impersonation-Id'] = sanitized;
    } else if (impersonationId) {
      logger.warn('[ghostfolio-client] impersonationId rejected by safeImpersonationId');
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
      ...(bodyText !== undefined && { responseBodyLength: bodyText.length })
    };
    logger.debug('[ghostfolio-api-failure]', JSON.stringify(payload));
  }

  private logGhostfolioApiCall({
    attempt,
    durationMs,
    hasToken,
    method,
    path,
    status,
    success
  }: {
    attempt?: number;
    durationMs: number;
    hasToken: boolean;
    method: 'GET' | 'POST' | 'PUT';
    path: string;
    status: number;
    success: boolean;
  }): void {
    const payload = {
      attempt,
      baseUrl: this.baseUrl,
      durationMs,
      hasToken,
      method,
      path,
      status,
      success,
      timestamp: Date.now()
    };
    logger.debug('[ghostfolio-api]', JSON.stringify(payload));
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
    logger.debug('[agent-auth] GhostfolioClient.get:', { hasToken, path, baseUrl: this.baseUrl });

    const maxGetParseAttempts = 2;

    for (let attempt = 1; attempt <= maxGetParseAttempts; attempt += 1) {
      const startedAt = Date.now();
      const response = await this.fetchWithTimeout(`${this.baseUrl}${path}`, { headers }, { method: 'GET', path });
      this.logGhostfolioApiCall({
        attempt,
        durationMs: Date.now() - startedAt,
        hasToken,
        method: 'GET',
        path,
        status: response.status,
        success: response.ok
      });

      if (!response.ok) {
        const bodyText = await response.text();
        this.logGhostfolioFailure('GET', path, response.status, bodyText);
        const hint =
          response.status === 401
            ? ' (check: you are signed in; agent GHOSTFOLIO_BASE_URL matches this app URL)'
            : '';
        throw new GhostfolioApiError({
          code: 'GHOSTFOLIO_HTTP_ERROR',
          message: `Ghostfolio API request failed: ${response.status}${hint}`,
          method: 'GET',
          path,
          retryable: response.status >= 500 || response.status === 429,
          status: response.status
        });
      }

      try {
        return await this.parseJsonBody<Record<string, unknown>>(response, {
          method: 'GET',
          path
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (
          (path === '/api/v1/portfolio/details' ||
            path.startsWith('/api/v1/portfolio/holdings')) &&
          errorMessage.startsWith('Ghostfolio API returned empty JSON body')
        ) {
          return this.emptyPortfolioDetailsFallback();
        }
        const canRetry =
          attempt < maxGetParseAttempts &&
          (errorMessage.startsWith('Ghostfolio API returned empty JSON body') ||
            errorMessage.startsWith('Ghostfolio API returned invalid JSON'));

        if (!canRetry) {
          throw error;
        }
      }
    }

    throw new GhostfolioApiError({
      code: 'GHOSTFOLIO_INVALID_JSON',
      message: `Ghostfolio API request failed: exhausted parse retries for GET ${path}`,
      method: 'GET',
      path,
      retryable: true
    });
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
    const hasToken = Boolean(normalizeAuthToken(token));
    const startedAt = Date.now();
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}${path}`,
      {
      body: JSON.stringify(body),
      headers,
      method: 'POST'
      },
      { method: 'POST', path }
    );
    this.logGhostfolioApiCall({
      durationMs: Date.now() - startedAt,
      hasToken,
      method: 'POST',
      path,
      status: response.status,
      success: response.ok
    });
    if (!response.ok) {
      const text = await response.text();
      this.logGhostfolioFailure('POST', path, response.status, text);
      const hint =
        response.status === 401
          ? ' (check: you are signed in; agent GHOSTFOLIO_BASE_URL matches this app URL)'
          : '';
      throw new GhostfolioApiError({
        code: 'GHOSTFOLIO_HTTP_ERROR',
        message: `Ghostfolio API request failed: ${response.status}${hint}`,
        method: 'POST',
        path,
        retryable: response.status >= 500 || response.status === 429,
        status: response.status
      });
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
    const hasToken = Boolean(normalizeAuthToken(token));
    const startedAt = Date.now();
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}${path}`,
      {
      body: JSON.stringify(body),
      headers,
      method: 'PUT'
      },
      { method: 'PUT', path }
    );
    this.logGhostfolioApiCall({
      durationMs: Date.now() - startedAt,
      hasToken,
      method: 'PUT',
      path,
      status: response.status,
      success: response.ok
    });
    if (!response.ok) {
      const text = await response.text();
      this.logGhostfolioFailure('PUT', path, response.status, text);
      const hint =
        response.status === 401
          ? ' (check: you are signed in; agent GHOSTFOLIO_BASE_URL matches this app URL)'
          : '';
      throw new GhostfolioApiError({
        code: 'GHOSTFOLIO_HTTP_ERROR',
        message: `Ghostfolio API request failed: ${response.status}${hint}`,
        method: 'PUT',
        path,
        retryable: response.status >= 500 || response.status === 429,
        status: response.status
      });
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
      throw new GhostfolioApiError({
        code: 'GHOSTFOLIO_EMPTY_BODY',
        message: `Ghostfolio API returned empty JSON body for ${method} ${path}.${hint}`,
        method,
        path,
        retryable: method === 'GET'
      });
    }

    try {
      return JSON.parse(bodyText) as T;
    } catch {
      throw new GhostfolioApiError({
        code: 'GHOSTFOLIO_INVALID_JSON',
        message: `Ghostfolio API returned invalid JSON for ${method} ${path}`,
        method,
        path,
        retryable: method === 'GET'
      });
    }
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    context: { method: 'GET' | 'POST' | 'PUT'; path: string }
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GhostfolioClient.REQUEST_TIMEOUT_MS);

    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        const payload = {
          method: context.method,
          path: context.path,
          timeoutMs: GhostfolioClient.REQUEST_TIMEOUT_MS,
          baseUrl: this.baseUrl,
          timestamp: Date.now()
        };
        logger.debug('[ghostfolio-api-failure]', JSON.stringify({ ...payload, reason: 'timeout' }));
        throw new GhostfolioApiError({
          code: 'GHOSTFOLIO_TIMEOUT',
          message: `Ghostfolio API request timed out after ${GhostfolioClient.REQUEST_TIMEOUT_MS}ms`,
          method: context.method,
          path: context.path,
          retryable: true
        });
      }
      throw new GhostfolioApiError({
        code: 'GHOSTFOLIO_NETWORK_ERROR',
        message: `Ghostfolio API network error for ${context.method} ${context.path}`,
        method: context.method,
        path: context.path,
        retryable: true
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Yahoo Finance client for fact_check second-source price verification.
 *
 * Purpose: Fetch current prices from Yahoo Finance for cross-checking
 *          against Ghostfolio market_data. Supports both stocks (AAPL, TSLA) and crypto (BTC-USD, ETH-USD).
 *          Used only by the fact_check tool.
 * Inputs: Symbols (e.g. AAPL, BTC-USD, ETH-USD), returns { [symbol]: { regularMarketPrice, currency } } or error payload.
 * Failure modes: timeout, network error, invalid response → return structured result; no throw.
 */

const YAHOO_FINANCE_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_BASE_URL = 'https://query1.finance.yahoo.com';

export interface YahooFinanceQuote {
  symbol: string;
  regularMarketPrice?: number;
  currency?: string;
  [key: string]: unknown;
}

export interface YahooFinanceQuoteResponse {
  quoteResponse: {
    result?: YahooFinanceQuote[];
    error?: { code: string; description: string };
  };
}

export interface YahooFinanceClientResult {
  ok: true;
  data: Record<string, { regularMarketPrice: number; currency: string }>;
  data_as_of: string;
}

export interface YahooFinanceClientError {
  ok: false;
  error_code: string;
  message: string;
  retryable: boolean;
}

export type YahooFinanceClientResponse = YahooFinanceClientResult | YahooFinanceClientError;

export interface YahooFinanceClientConfig {
  baseUrl?: string;
  timeoutMs?: number;
}

/**
 * Fetch quote data for given symbols from Yahoo Finance.
 * Returns structured result; on failure returns { ok: false, error_code, message, retryable }.
 */
export async function getYahooQuote(
  symbols: string[],
  config: YahooFinanceClientConfig = {}
): Promise<YahooFinanceClientResponse> {
  const baseUrl = (config.baseUrl ?? process.env.YAHOO_FINANCE_API_URL ?? DEFAULT_BASE_URL)
    .trim()
    .replace(/\/+$/, '');
  const timeoutMs = config.timeoutMs ?? YAHOO_FINANCE_REQUEST_TIMEOUT_MS;

  if (symbols.length === 0) {
    return {
      ok: true,
      data: {},
      data_as_of: new Date().toISOString()
    };
  }

  const uniqueSymbols = [...new Set(symbols)];
  const params = new URLSearchParams({
    symbols: uniqueSymbols.join(',')
  });
  const url = `${baseUrl}/v8/finance/quote?${params.toString()}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const retryable = response.status >= 500 || response.status === 429;
      return {
        ok: false,
        error_code: 'YAHOO_FINANCE_HTTP_ERROR',
        message: `Yahoo Finance API returned ${response.status}`,
        retryable
      };
    }

    const body = (await response.json()) as YahooFinanceQuoteResponse | null;
    const results = body?.quoteResponse?.result || [];

    if (!Array.isArray(results)) {
      return {
        ok: false,
        error_code: 'YAHOO_FINANCE_INVALID_RESPONSE',
        message: 'Invalid response structure from Yahoo Finance',
        retryable: true
      };
    }

    const data: Record<string, { regularMarketPrice: number; currency: string }> = {};
    for (const quote of results) {
      if (
        quote.symbol &&
        typeof quote.regularMarketPrice === 'number' &&
        Number.isFinite(quote.regularMarketPrice)
      ) {
        data[quote.symbol] = {
          regularMarketPrice: quote.regularMarketPrice,
          currency: quote.currency || 'USD'
        };
      }
    }

    return {
      ok: true,
      data,
      data_as_of: new Date().toISOString()
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const isAbort = error instanceof Error && error.name === 'AbortError';
    return {
      ok: false,
      error_code: isAbort ? 'YAHOO_FINANCE_TIMEOUT' : 'YAHOO_FINANCE_NETWORK_ERROR',
      message: isAbort
        ? 'Yahoo Finance request timed out'
        : error instanceof Error
          ? error.message
          : 'Network error',
      retryable: true
    };
  }
}

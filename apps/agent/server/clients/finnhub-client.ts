/**
 * Finnhub client for fact_check second-source price verification.
 *
 * Purpose: Fetch current prices from Finnhub for cross-checking against Ghostfolio market_data.
 *          Supports stocks (AAPL, TSLA) and crypto (BTC, ETH). Primary secondary source.
 * Inputs: Symbols (e.g. AAPL, BTC, ETH), returns { [symbol]: { price, currency } } or error payload.
 * Failure modes: timeout, network error, rate limit → return structured result; no throw.
 */

const FINNHUB_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_BASE_URL = 'https://finnhub.io/api/v1';

export interface FinnhubQuoteResponse {
  c?: number; // current price
  h?: number; // high
  l?: number; // low
  o?: number; // open
  pc?: number; // previous close
  t?: number; // timestamp
}

export interface FinnhubCryptoResponse {
  quote?: {
    c?: number; // current price
  };
}

export interface FinnhubClientResult {
  ok: true;
  data: Record<string, { price: number; currency: string }>;
  data_as_of: string;
}

export interface FinnhubClientError {
  ok: false;
  error_code: string;
  message: string;
  retryable: boolean;
}

export type FinnhubClientResponse = FinnhubClientResult | FinnhubClientError;

export interface FinnhubClientConfig {
  baseUrl?: string;
  timeoutMs?: number;
  apiKey?: string;
}

/**
 * Fetch quote data for given symbols from Finnhub.
 * Supports both stocks (AAPL) and crypto (BTC, ETH).
 * Returns structured result; on failure returns { ok: false, error_code, message, retryable }.
 */
export async function getFinnhubQuote(
  symbols: string[],
  config: FinnhubClientConfig = {}
): Promise<FinnhubClientResponse> {
  const apiKey = config.apiKey ?? process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error_code: 'FINNHUB_NO_API_KEY',
      message: 'Finnhub API key not configured',
      retryable: false
    };
  }

  const baseUrl = (config.baseUrl ?? process.env.FINNHUB_API_URL ?? DEFAULT_BASE_URL)
    .trim()
    .replace(/\/+$/, '');
  const timeoutMs = config.timeoutMs ?? FINNHUB_REQUEST_TIMEOUT_MS;

  if (symbols.length === 0) {
    return {
      ok: true,
      data: {},
      data_as_of: new Date().toISOString()
    };
  }

  const data: Record<string, { price: number; currency: string }> = {};
  const errors: string[] = [];

  // Fetch each symbol individually (Finnhub doesn't support batch quotes)
  for (const symbol of symbols) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      // Detect if this is a crypto symbol (common crypto tickers)
      const isCrypto = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOT', 'LINK'].includes(
        symbol.toUpperCase()
      );
      const endpoint = isCrypto ? '/crypto/quote' : '/quote';
      const params = new URLSearchParams({ symbol });
      const url = `${baseUrl}${endpoint}?${params.toString()}`;

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`
        }
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const retryable = response.status >= 500 || response.status === 429;
        if (retryable) {
          errors.push(`${symbol}: ${response.status}`);
        }
        continue;
      }

      const body = (await response.json()) as FinnhubQuoteResponse | FinnhubCryptoResponse | null;
      const price = isCrypto
        ? (body as FinnhubCryptoResponse)?.quote?.c
        : (body as FinnhubQuoteResponse)?.c;

      if (typeof price === 'number' && Number.isFinite(price) && price > 0) {
        data[symbol] = { price, currency: 'USD' };
      }
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      if (isAbort) {
        errors.push(`${symbol}: timeout`);
      }
    }
  }

  // If we got some data, return success even if some symbols failed
  if (Object.keys(data).length > 0) {
    return {
      ok: true,
      data,
      data_as_of: new Date().toISOString()
    };
  }

  // All symbols failed
  return {
    ok: false,
    error_code: 'FINNHUB_NO_QUOTES',
    message: errors.length > 0 ? `Failed to fetch quotes: ${errors.join('; ')}` : 'No quote data received',
    retryable: errors.some(e => e.includes('50') || e.includes('429'))
  };
}

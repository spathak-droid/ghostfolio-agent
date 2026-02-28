/**
 * CoinGecko client for fact_check second-source price verification.
 *
 * Purpose: Fetch current crypto prices from CoinGecko public API for cross-checking
 *          against Ghostfolio market_data. Used as fallback when Yahoo Finance is unavailable.
 * Inputs: CoinGecko ids (e.g. bitcoin, ethereum), vs_currency (e.g. usd).
 * Outputs: { [id]: { usd: number } } or error payload.
 * Failure modes: timeout, network error, rate limit → return structured result; no throw.
 */

const COINGECKO_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_BASE_URL = 'https://api.coingecko.com/api/v3';

/** Map common symbols/names to CoinGecko API id (lowercase). */
export const COINGECKO_SYMBOL_IDS: Readonly<Record<string, string>> = {
  bitcoin: 'bitcoin',
  btc: 'bitcoin',
  'BTC-USD': 'bitcoin',
  BTCUSD: 'bitcoin',
  ethereum: 'ethereum',
  eth: 'ethereum',
  'ETH-USD': 'ethereum',
  ETHUSD: 'ethereum',
  solana: 'solana',
  sol: 'solana',
  'SOL-USD': 'solana',
  SOLUSD: 'solana'
};

export interface CoinGeckoSimplePriceResult {
  [id: string]: { usd?: number; [key: string]: unknown } | undefined;
}

export interface CoinGeckoClientResult {
  ok: true;
  data: CoinGeckoSimplePriceResult;
  data_as_of: string;
}

export interface CoinGeckoClientError {
  ok: false;
  error_code: string;
  message: string;
  retryable: boolean;
}

export type CoinGeckoClientResponse = CoinGeckoClientResult | CoinGeckoClientError;

export interface CoinGeckoClientConfig {
  baseUrl?: string;
  timeoutMs?: number;
}

/**
 * Resolve a symbol (e.g. BTC, bitcoin) to CoinGecko id if supported.
 */
export function symbolToCoinGeckoId(symbol: string): string | undefined {
  const normalized = symbol.trim();
  if (!normalized) return undefined;
  const byKey = COINGECKO_SYMBOL_IDS[normalized];
  if (byKey) return byKey;
  const lower = normalized.toLowerCase();
  return COINGECKO_SYMBOL_IDS[lower] ?? (lower in COINGECKO_SYMBOL_IDS ? lower : undefined);
}

/**
 * Fetch simple price for given CoinGecko ids and vs_currency.
 * Returns structured result; on failure returns { ok: false, error_code, message, retryable }.
 */
export async function getSimplePrice(
  ids: string[],
  vsCurrency: string,
  config: CoinGeckoClientConfig = {}
): Promise<CoinGeckoClientResponse> {
  const baseUrl = (config.baseUrl ?? process.env.COINGECKO_API_URL ?? DEFAULT_BASE_URL)
    .trim()
    .replace(/\/+$/, '');
  const timeoutMs = config.timeoutMs ?? COINGECKO_REQUEST_TIMEOUT_MS;

  if (ids.length === 0) {
    return {
      ok: true,
      data: {},
      data_as_of: new Date().toISOString()
    };
  }

  const uniqueIds = [...new Set(ids)];
  const params = new URLSearchParams({
    ids: uniqueIds.join(','),
    vs_currencies: vsCurrency.toLowerCase()
  });
  const url = `${baseUrl}/simple/price?${params.toString()}`;

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
        error_code: 'COINGECKO_HTTP_ERROR',
        message: `CoinGecko API returned ${response.status}`,
        retryable
      };
    }

    const body = (await response.json()) as CoinGeckoSimplePriceResult | null;
    const data = body && typeof body === 'object' ? body : {};
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
      error_code: isAbort ? 'COINGECKO_TIMEOUT' : 'COINGECKO_NETWORK_ERROR',
      message: isAbort
        ? 'CoinGecko request timed out'
        : error instanceof Error
          ? error.message
          : 'Network error',
      retryable: true
    };
  }
}

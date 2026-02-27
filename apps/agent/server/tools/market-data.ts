import { GhostfolioClient } from '../ghostfolio-client';
import { resolveSymbol } from './symbol-resolver';
import { toToolErrorPayload, type ToolErrorPayload } from './tool-error';

const MAX_SYMBOLS = 10;
const SUPPORTED_METRICS = new Set(['price']);

/** Fallback data sources when primary returns 404 or fails (e.g. YAHOO often fails for crypto). */
const FALLBACK_DATA_SOURCES = ['COINGECKO', 'YAHOO'];

/** CoinGecko uses lowercase ids for crypto; map common symbols to CoinGecko id for fallback. */
const COINGECKO_SYMBOL_IDS: Readonly<Record<string, string>> = {
  'BTC-USD': 'bitcoin',
  BTCUSD: 'bitcoin',
  'ETH-USD': 'ethereum',
  ETHUSD: 'ethereum',
  'SOL-USD': 'solana',
  SOLUSD: 'solana'
};

/** Stopwords to skip when extracting asset name candidates from a message. */
const STOPWORDS = new Set([
  'what',
  'is',
  'the',
  'of',
  'a',
  'an',
  'to',
  'for',
  'and',
  'or',
  'in',
  'on',
  'at',
  'quote',
  'price',
  'value',
  'current',
  'how',
  'much',
  'difference',
  'from',
  'today',
  'last',
  'month',
  'year',
  'stock',
  'stocks',
  'share',
  'shares',
  'coin',
  'coins'
]);

export interface MarketDataSymbolResult {
  symbol: string;
  dataSource: string;
  name?: string;
  currentPrice: number;
  currency: string;
  change1w?: number;
  changePercent1w?: number;
  change1m?: number;
  changePercent1m?: number;
  change1y?: number;
  changePercent1y?: number;
  historicalComparisons?: {
    change: number;
    changePercent: number;
    date: string;
    label: string;
    price: number;
  }[];
  error?: ToolErrorPayload;
}

export interface MarketDataToolInput {
  client: GhostfolioClient;
  impersonationId?: string;
  message: string;
  token?: string;
  symbols?: string[];
  metrics?: string[];
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function extractAssetNameCandidates(message: string): string[] {
  const candidates: string[] = [];
  const priceOfMatch = message.match(/\b(?:price|value)\s+(?:of|for)\s+([A-Za-z0-9.-]+)/gi);

  if (priceOfMatch) {
    for (const match of priceOfMatch) {
      const candidate = match.replace(/\b(?:price|value)\s+(?:of|for)\s+/i, '').trim();
      if (candidate.length >= 2 && candidate.length <= 20) {
        candidates.push(candidate);
      }
    }
  }

  const tickerMatch = message.match(/\b([A-Z]{2,5}(?:-[A-Z]+)?)\b/g);
  if (tickerMatch) {
    candidates.push(...tickerMatch);
  }

  const words = message.split(/[\s,().]+/).filter(Boolean);
  for (const word of words) {
    const normalizedWord = word.toLowerCase();
    const alreadyPresent = candidates.some((candidate) => candidate.toLowerCase() === normalizedWord);
    if (
      word.length >= 2 &&
      word.length <= 15 &&
      !STOPWORDS.has(normalizedWord) &&
      !/^\d+$/.test(word) &&
      !alreadyPresent
    ) {
      candidates.push(word);
    }
  }

  return [...new Set(candidates)];
}

function parseSymbolsFromMessage(message: string): string[] {
  const normalized = message.toLowerCase();
  const symbols: string[] = [];
  const aliasKeys = ['bitcoin', 'btc', 'ethereum', 'eth', 'tesla', 'tsla', 'apple', 'aapl', 'nvidia', 'nvda', 'solana', 'sol'];

  for (const key of aliasKeys) {
    if (normalized.includes(key)) {
      symbols.push(key);
    }
  }

  const tickerMatch = message.match(/\b([A-Z]{2,5})\b/g);
  if (tickerMatch) {
    for (const ticker of tickerMatch) {
      if (!symbols.includes(ticker.toLowerCase())) {
        symbols.push(ticker);
      }
    }
  }

  if (symbols.length === 0) {
    symbols.push(...extractAssetNameCandidates(message));
  }

  return [...new Set(symbols)];
}

function normalizeMetrics(inputMetrics?: string[]) {
  const requestedMetrics = Array.isArray(inputMetrics) ? inputMetrics.filter(Boolean) : ['price'];
  const unsupportedMetrics = requestedMetrics.filter((metric) => !SUPPORTED_METRICS.has(metric));
  return {
    requestedMetrics,
    unsupportedMetrics
  };
}

function inferHistoricalIntent(message: string): boolean {
  const normalized = message.toLowerCase();
  return /\b(last week|last month|last year|yesterday|compared|difference|change|historical|past)\b/.test(
    normalized
  );
}

function buildNoSymbolsResponse() {
  return {
    answer:
      'No symbols specified. Specify symbols (e.g. bitcoin, AAPL) or ask "what is the price of X?"',
    data_as_of: new Date().toISOString(),
    sources: ['agent_internal'],
    summary: 'Market data: no symbols provided',
    symbols: []
  };
}

async function getSymbolDataWithFallback(
  client: GhostfolioClient,
  primary: { dataSource: string; symbol: string },
  opts: {
    includeHistoricalData?: number;
    impersonationId?: string;
    token?: string;
  }
): Promise<
  | {
      ok: true;
      data: {
        historicalData: { date: string; value: number }[];
        marketPrice: number;
        currency: string;
        symbol: string;
        dataSource: string;
      };
    }
  | {
      ok: false;
      error: ToolErrorPayload;
    }
> {
  const trySource = async (dataSource: string, symbol: string) => {
    try {
      const data = await client.getSymbolData({
        dataSource,
        symbol,
        includeHistoricalData: opts.includeHistoricalData ?? 0,
        impersonationId: opts.impersonationId,
        token: opts.token
      });
      const item = data as {
        marketPrice?: number;
        historicalData?: { date?: string; value?: number }[];
        currency?: string;
        symbol?: string;
        dataSource?: string;
      };
      const marketPrice =
        typeof item.marketPrice === 'number' && Number.isFinite(item.marketPrice)
          ? item.marketPrice
          : undefined;

      if (marketPrice === undefined) {
        return {
          ok: false as const,
          error: {
            error_code: 'MARKET_PRICE_MISSING',
            message: `Missing market price for ${dataSource} ${symbol}`,
            retryable: false
          }
        };
      }

      const historicalData = Array.isArray(item.historicalData)
        ? item.historicalData
            .map((point) => {
              const date = typeof point?.date === 'string' ? point.date : undefined;
              const value =
                typeof point?.value === 'number' && Number.isFinite(point.value)
                  ? point.value
                  : undefined;
              return date && value !== undefined ? { date, value } : undefined;
            })
            .filter((point): point is { date: string; value: number } => Boolean(point))
        : [];

      return {
        ok: true as const,
        data: {
          historicalData,
          marketPrice,
          currency: typeof item.currency === 'string' ? item.currency : 'USD',
          symbol: item.symbol ?? symbol,
          dataSource: item.dataSource ?? dataSource
        }
      };
    } catch (error) {
      return {
        ok: false as const,
        error: toToolErrorPayload(error)
      };
    }
  };

  let lastError: ToolErrorPayload | undefined;
  const primaryResult = await trySource(primary.dataSource, primary.symbol);
  if (primaryResult.ok) {
    return primaryResult;
  }
  lastError = primaryResult.error;

  for (const fallbackSource of FALLBACK_DATA_SOURCES) {
    if (fallbackSource === primary.dataSource) {
      continue;
    }

    const symbolToTry =
      fallbackSource === 'COINGECKO' && COINGECKO_SYMBOL_IDS[primary.symbol]
        ? COINGECKO_SYMBOL_IDS[primary.symbol]
        : primary.symbol;

    const fallbackResult = await trySource(fallbackSource, symbolToTry);
    if (fallbackResult.ok) {
      return fallbackResult;
    }
    lastError = fallbackResult.error;
  }

  return {
    ok: false,
    error:
      lastError ?? {
        error_code: 'MARKET_DATA_FETCH_FAILED',
        message: 'Failed to fetch symbol data',
        retryable: true
      }
  };
}

function createLookup(
  client: GhostfolioClient,
  impersonationId?: string,
  token?: string
) {
  return async (query: string): Promise<{ dataSource: string; symbol: string }[]> => {
    try {
      const response = await client.getSymbolLookup({ query, impersonationId, token });
      return (response as { items?: { dataSource: string; symbol: string }[] })?.items ?? [];
    } catch {
      return [];
    }
  };
}

interface FetchCurrentResultsArgs {
  client: GhostfolioClient;
  includeHistoricalData?: number;
  lookup: (query: string) => Promise<{ dataSource: string; symbol: string }[]>;
  symbols: string[];
  windows: number[];
  impersonationId?: string;
  token?: string;
}

async function fetchCurrentResults(args: FetchCurrentResultsArgs): Promise<MarketDataSymbolResult[]> {
  const { client, includeHistoricalData, lookup, symbols, windows, impersonationId, token } = args;
  const results: MarketDataSymbolResult[] = [];

  for (const nameOrTicker of symbols.slice(0, MAX_SYMBOLS)) {
    const resolved = await resolveSymbol(nameOrTicker, lookup);
    if (!resolved) {
      results.push({
        symbol: nameOrTicker,
        dataSource: '',
        currentPrice: 0,
        currency: '',
        error: {
          error_code: 'SYMBOL_RESOLUTION_FAILED',
          message: `Could not resolve symbol: ${nameOrTicker}`,
          retryable: false
        }
      });
      continue;
    }

    const item = await getSymbolDataWithFallback(
      client,
      { dataSource: resolved.dataSource, symbol: resolved.symbol },
      { impersonationId, token, includeHistoricalData }
    );
    if (item.ok === true) {
      const comparisons = computeHistoricalComparisons({
        currentPrice: item.data.marketPrice,
        historicalData: item.data.historicalData,
        windows
      });
      results.push({
        symbol: item.data.symbol,
        dataSource: item.data.dataSource,
        currentPrice: roundTwo(item.data.marketPrice),
        currency: item.data.currency,
        change1w: comparisons.change1w,
        changePercent1w: comparisons.changePercent1w,
        change1m: comparisons.change1m,
        changePercent1m: comparisons.changePercent1m,
        change1y: comparisons.change1y,
        changePercent1y: comparisons.changePercent1y,
        historicalComparisons: comparisons.historicalComparisons
      });
    } else {
      const failedResult = item as { ok: false; error: ToolErrorPayload };
      results.push({
        symbol: resolved.symbol,
        dataSource: resolved.dataSource,
        currentPrice: 0,
        currency: '',
        error: failedResult.error
      });
    }
  }

  return results;
}

function buildAnswer(results: MarketDataSymbolResult[]) {
  return results
    .map((result) => {
      if (result.error) {
        return `${result.symbol}: ${result.error.message}`;
      }
      const base = `${result.symbol}: ${result.currency} ${result.currentPrice}`;
      const comparisons = result.historicalComparisons ?? [];
      if (comparisons.length === 0) {
        return base;
      }
      const comparisonText = comparisons
        .map(
          (comparison) =>
            `${comparison.label} ago (${comparison.date}): ${result.currency} ${comparison.price}, vs ${comparison.label}: ${formatSignedPercent(comparison.changePercent)}`
        )
        .join('; ');
      return `${base}; ${comparisonText}`;
    })
    .join('; ');
}

function buildSummary({
  message,
  results,
  unsupportedMetrics
}: {
  message: string;
  results: MarketDataSymbolResult[];
  unsupportedMetrics: string[];
}) {
  let summary =
    results.length === 0 ? 'No market data retrieved' : `Current data for ${results.length} symbol(s).`;

  if (unsupportedMetrics.length > 0) {
    summary += ` Unsupported metrics ignored in current-only mode: ${unsupportedMetrics.join(', ')}.`;
  }
  if (inferHistoricalIntent(message)) {
    summary += ' Historical comparisons included when data is available.';
  }

  return summary;
}

function parseRequestedWindows(message: string): number[] {
  const normalized = message.toLowerCase();
  const requested = new Set<number>();
  if (/\b(last|past)\s+5\s+days?\b/.test(normalized) || /\b5\s*day\b/.test(normalized)) {
    requested.add(5);
  }
  if (/\b(last|past)\s+week\b/.test(normalized) || /\bweekly\b/.test(normalized)) {
    requested.add(7);
  }
  if (/\b(last|past)\s+month\b/.test(normalized)) {
    requested.add(30);
  }
  if (/\b(last|past)\s+year\b/.test(normalized) || /\b(year ago|a year ago|1 year)\b/.test(normalized)) {
    requested.add(365);
  }
  if (/\byesterday\b/.test(normalized)) {
    requested.add(1);
  }
  if (/\bhistorical\b/.test(normalized) && requested.size === 0) {
    requested.add(5);
    requested.add(7);
    requested.add(30);
  }
  if (requested.size === 0 && /\b(change|difference|grew|growth|trend|compare)\b/.test(normalized)) {
    requested.add(7);
  }
  return [...requested].sort((a, b) => a - b);
}

function getHistoricalDaysToFetch(windows: number[]): number {
  if (windows.length === 0) {
    return 0;
  }
  const maxWindow = windows[windows.length - 1];
  return maxWindow + (maxWindow >= 365 ? 15 : 3);
}

function computeHistoricalComparisons({
  currentPrice,
  historicalData,
  windows
}: {
  currentPrice: number;
  historicalData: { date: string; value: number }[];
  windows: number[];
}) {
  const normalized = historicalData
    .map((point) => ({ date: point.date.slice(0, 10), dateMs: Date.parse(point.date), value: point.value }))
    .filter((point) => Number.isFinite(point.dateMs) && Number.isFinite(point.value) && point.value > 0);

  const response: {
    change1m?: number;
    change1w?: number;
    change1y?: number;
    changePercent1m?: number;
    changePercent1w?: number;
    changePercent1y?: number;
    historicalComparisons: {
      change: number;
      changePercent: number;
      date: string;
      label: string;
      price: number;
    }[];
  } = { historicalComparisons: [] };

  if (normalized.length === 0 || windows.length === 0) {
    return response;
  }

  const now = Date.now();
  for (const windowDays of windows) {
    const target = now - windowDays * 24 * 60 * 60 * 1000;
    const anchor = normalized.reduce<{ date: string; dateMs: number; value: number } | undefined>(
      (best, point) => {
        if (!best) return point;
        return Math.abs(point.dateMs - target) < Math.abs(best.dateMs - target) ? point : best;
      },
      undefined
    );
    if (!anchor || anchor.value <= 0) {
      continue;
    }
    const change = currentPrice - anchor.value;
    const changePercent = (change / anchor.value) * 100;
    const label = windowDays === 1 ? '1d' : windowDays === 5 ? '5d' : windowDays === 7 ? '1w' : windowDays === 30 ? '1m' : windowDays === 365 ? '1y' : `${windowDays}d`;
    response.historicalComparisons.push({
      label,
      date: anchor.date,
      price: roundTwo(anchor.value),
      change: roundTwo(change),
      changePercent: roundTwo(changePercent)
    });

    if (windowDays === 7) {
      response.change1w = roundTwo(change);
      response.changePercent1w = roundTwo(changePercent);
    }
    if (windowDays === 30) {
      response.change1m = roundTwo(change);
      response.changePercent1m = roundTwo(changePercent);
    }
    if (windowDays === 365) {
      response.change1y = roundTwo(change);
      response.changePercent1y = roundTwo(changePercent);
    }
  }

  return response;
}

function formatSignedPercent(value: number): string {
  const rounded = roundTwo(value);
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

export async function marketDataTool({
  client,
  impersonationId,
  message,
  token,
  symbols: inputSymbols,
  metrics: inputMetrics
}: MarketDataToolInput): Promise<Record<string, unknown>> {
  try {
    const symbols =
      Array.isArray(inputSymbols) && inputSymbols.length > 0
        ? inputSymbols.filter(Boolean)
        : parseSymbolsFromMessage(message ?? '');
    const { unsupportedMetrics } = normalizeMetrics(inputMetrics);

    if (symbols.length === 0) {
      return buildNoSymbolsResponse();
    }
    const requestedWindows = parseRequestedWindows(message ?? '');
    const includeHistoricalData = getHistoricalDaysToFetch(requestedWindows);

    const lookup = createLookup(client, impersonationId, token);
    const results = await fetchCurrentResults({
      client,
      includeHistoricalData,
      lookup,
      symbols,
      windows: requestedWindows,
      impersonationId,
      token
    });
    const answer = buildAnswer(results);
    const summary = buildSummary({
      message,
      results,
      unsupportedMetrics
    });

    const payload: Record<string, unknown> = {
      answer,
      data_as_of: new Date().toISOString(),
      sources: ['ghostfolio_api'],
      summary,
      symbols: results
    };

    if (unsupportedMetrics.length > 0) {
      payload.unsupported_metrics = unsupportedMetrics;
    }

    return payload;
  } catch (error) {
    const toolError = toToolErrorPayload(error);
    return {
      success: false,
      answer: `Could not fetch market data: ${toolError.message}`,
      summary: `Market data failed: ${toolError.message}`,
      error: toolError,
      data_as_of: new Date().toISOString(),
      sources: ['ghostfolio_api']
    };
  }
}

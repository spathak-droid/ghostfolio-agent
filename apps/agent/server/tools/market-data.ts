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
  return /\b(last week|last month|last year|yesterday|compared|difference|change)\b/.test(
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
    impersonationId?: string;
    token?: string;
  }
): Promise<
  | {
      ok: true;
      data: {
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
        includeHistoricalData: 0,
        impersonationId: opts.impersonationId,
        token: opts.token
      });
      const item = data as {
        marketPrice?: number;
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

      return {
        ok: true as const,
        data: {
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
  lookup: (query: string) => Promise<{ dataSource: string; symbol: string }[]>;
  symbols: string[];
  impersonationId?: string;
  token?: string;
}

async function fetchCurrentResults(args: FetchCurrentResultsArgs): Promise<MarketDataSymbolResult[]> {
  const { client, lookup, symbols, impersonationId, token } = args;
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
      { impersonationId, token }
    );
    if (item.ok === true) {
      results.push({
        symbol: item.data.symbol,
        dataSource: item.data.dataSource,
        currentPrice: roundTwo(item.data.marketPrice),
        currency: item.data.currency
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
      return `${result.symbol}: ${result.currency} ${result.currentPrice}`;
    })
    .join('; ');
}

function buildSummary({
  message,
  requestedMetrics,
  results,
  unsupportedMetrics
}: {
  message: string;
  requestedMetrics: string[];
  results: MarketDataSymbolResult[];
  unsupportedMetrics: string[];
}) {
  let summary =
    results.length === 0 ? 'No market data retrieved' : `Current data for ${results.length} symbol(s).`;

  if (unsupportedMetrics.length > 0) {
    summary += ` Unsupported metrics ignored in current-only mode: ${unsupportedMetrics.join(', ')}.`;
  }

  if (inferHistoricalIntent(message) && requestedMetrics.length > 0) {
    summary += ' Historical comparisons are not available in current-only mode.';
  }

  return summary;
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
    const { requestedMetrics, unsupportedMetrics } = normalizeMetrics(inputMetrics);

    if (symbols.length === 0) {
      return buildNoSymbolsResponse();
    }

    const lookup = createLookup(client, impersonationId, token);
    const results = await fetchCurrentResults({
      client,
      lookup,
      symbols,
      impersonationId,
      token
    });
    const answer = buildAnswer(results);
    const summary = buildSummary({
      message,
      requestedMetrics,
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

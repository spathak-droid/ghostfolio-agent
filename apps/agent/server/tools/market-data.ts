import { GhostfolioClient } from '../ghostfolio-client';
import { resolveSymbol } from './symbol-resolver';

const HISTORY_DAYS = 31;
const METRICS_NEEDING_HISTORY = new Set(['change_1m', 'change_percent_1m']);

/** Stopwords to skip when extracting asset name candidates from a message. */
const STOPWORDS = new Set([
  'what', 'is', 'the', 'of', 'a', 'an', 'to', 'for', 'and', 'or', 'in', 'on', 'at',
  'price', 'value', 'current', 'how', 'much', 'difference', 'from', 'today', 'last', 'month', 'year'
]);

export interface MarketDataSymbolResult {
  symbol: string;
  dataSource: string;
  name?: string;
  currentPrice: number;
  currency: string;
  change1m?: number;
  changePercent1m?: number;
  error?: string;
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

/**
 * Best-effort parse of a requested date/period from the user message for domain verification.
 * Returns { year, month? } if a 20xx year (and optional month) is mentioned.
 */
function parseRequestedDateFromMessage(message: string): { year: number; month?: number } | null {
  const yearMatch = /\b(20\d{2})\b/.exec(message);
  if (!yearMatch) return null;
  const year = parseInt(yearMatch[1], 10);
  const lower = message.toLowerCase();
  const monthNames: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
    jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
  };
  let month: number | undefined;
  for (const [name, m] of Object.entries(monthNames)) {
    if (lower.includes(name)) {
      month = m;
      break;
    }
  }
  return { year, month };
}

/** If requested period is outside the data range, return a short warning and nearest date. */
function checkDateRangeMatch(
  requested: { year: number; month?: number },
  dataDates: string[]
): { date_mismatch_warning: boolean; nearestDate?: string } {
  if (dataDates.length === 0) return { date_mismatch_warning: false };
  const sorted = [...dataDates].sort();
  const minDate = sorted[0];
  const maxDate = sorted[sorted.length - 1];
  const [minY, minM] = minDate.split('-').map(Number);
  const [maxY, maxM] = maxDate.split('-').map(Number);
  const reqYear = requested.year;
  const reqMonth = requested.month;
  const inRange = reqMonth
    ? (reqYear > minY || (reqYear === minY && reqMonth >= minM)) &&
      (reqYear < maxY || (reqYear === maxY && reqMonth <= maxM))
    : (reqYear >= minY && reqYear <= maxY);
  if (inRange) return { date_mismatch_warning: false };
  const nearestDate = reqYear < minY ? minDate : maxDate;
  return { date_mismatch_warning: true, nearestDate };
}

/**
 * Extracts likely asset name or ticker candidates from a message so we can
 * resolve them via the lookup API (name → symbol). Used when no structured
 * symbols[] are provided.
 */
function extractAssetNameCandidates(message: string): string[] {
  const candidates: string[] = [];

  // "price of X", "value of X", "price for X"
  const priceOfMatch = message.match(/\b(?:price|value)\s+(?:of|for)\s+([A-Za-z0-9.-]+)/gi);
  if (priceOfMatch) {
    for (const m of priceOfMatch) {
      const part = m.replace(/\b(?:price|value)\s+(?:of|for)\s+/i, '').trim();
      if (part.length >= 2 && part.length <= 20) candidates.push(part);
    }
  }

  // Uppercase tickers (e.g. SOL, AAPL, BTC-USD)
  const tickerMatch = message.match(/\b([A-Z]{2,5}(?:-[A-Z]+)?)\b/g);
  if (tickerMatch) {
    for (const t of tickerMatch) {
      if (!candidates.includes(t)) candidates.push(t);
    }
  }

  // Words that look like asset names: 2–15 chars, not stopwords, not numbers
  const words = message.split(/[\s,().]+/).filter(Boolean);
  for (const w of words) {
    const lower = w.toLowerCase();
    if (
      w.length >= 2 &&
      w.length <= 15 &&
      !STOPWORDS.has(lower) &&
      !/^\d+$/.test(w) &&
      !candidates.some((c) => c.toLowerCase() === lower)
    ) {
      candidates.push(w);
    }
  }

  return [...new Set(candidates)];
}

function parseSymbolsAndMetricsFromMessage(message: string): {
  symbols: string[];
  metrics: string[];
  includeHistorical: boolean;
} {
  const normalized = message.toLowerCase();
  const symbols: string[] = [];
  const aliasKeys = [
    'bitcoin',
    'btc',
    'ethereum',
    'eth',
    'tesla',
    'tsla',
    'apple',
    'aapl',
    'nvidia',
    'nvda',
    'solana',
    'sol'
  ];
  for (const key of aliasKeys) {
    if (normalized.includes(key)) {
      symbols.push(key);
    }
  }
  const tickerMatch = message.match(/\b([A-Z]{2,5})\b/g);
  if (tickerMatch) {
    for (const t of tickerMatch) {
      if (!symbols.includes(t.toLowerCase())) {
        symbols.push(t);
      }
    }
  }
  // If still no symbols, use name-to-symbol candidates so lookup API is used
  if (symbols.length === 0) {
    symbols.push(...extractAssetNameCandidates(message));
  }
  const includeHistorical =
    normalized.includes('last month') ||
    normalized.includes('difference') ||
    normalized.includes('change') ||
    normalized.includes('vs last');
  const metrics = includeHistorical
    ? ['price', 'change_1m', 'change_percent_1m']
    : ['price'];
  return { symbols: [...new Set(symbols)], metrics, includeHistorical };
}

export async function marketDataTool({
  client,
  impersonationId,
  message,
  token,
  symbols: inputSymbols,
  metrics: inputMetrics
}: MarketDataToolInput): Promise<Record<string, unknown>> {
  let symbols = Array.isArray(inputSymbols) ? inputSymbols.filter(Boolean) : [];
  let metrics = Array.isArray(inputMetrics) ? inputMetrics.filter(Boolean) : ['price'];
  let includeHistorical = metrics.some((m) => METRICS_NEEDING_HISTORY.has(m));

  if (symbols.length === 0 && message?.trim()) {
    const parsed = parseSymbolsAndMetricsFromMessage(message);
    if (parsed.symbols.length > 0) {
      symbols = parsed.symbols;
      metrics = parsed.metrics;
      includeHistorical = parsed.includeHistorical;
    }
  }

  if (symbols.length === 0) {
    return {
      answer: 'No symbols specified. Specify symbols (e.g. bitcoin, AAPL) or ask "what is the price of X?"',
      data_as_of: new Date().toISOString(),
      sources: ['agent_internal'],
      summary: 'Market data: no symbols provided',
      symbols: []
    };
  }

  const lookup = async (query: string): Promise<{ dataSource: string; symbol: string }[]> => {
    try {
      const res = await client.getSymbolLookup({ query, impersonationId, token });
      const items = (res as { items?: { dataSource: string; symbol: string }[] })?.items ?? [];
      return items;
    } catch {
      return [];
    }
  };

  const results: MarketDataSymbolResult[] = [];
  const allHistoricalDates: string[] = [];

  for (const nameOrTicker of symbols.slice(0, 10)) {
    const resolved = await resolveSymbol(nameOrTicker, lookup);
    if (!resolved) {
      results.push({
        symbol: nameOrTicker,
        dataSource: '',
        currentPrice: 0,
        currency: '',
        error: `Could not resolve symbol: ${nameOrTicker}`
      });
      continue;
    }

    try {
      const data = await client.getSymbolData({
        dataSource: resolved.dataSource,
        symbol: resolved.symbol,
        includeHistoricalData: includeHistorical ? HISTORY_DAYS : 0,
        impersonationId,
        token
      });

      const item = data as {
        marketPrice?: number;
        currency?: string;
        symbol?: string;
        dataSource?: string;
        historicalData?: { date: string; value: number }[];
      };

      const marketPrice =
        typeof item.marketPrice === 'number' && Number.isFinite(item.marketPrice)
          ? item.marketPrice
          : 0;
      const currency = typeof item.currency === 'string' ? item.currency : 'USD';
      const historicalData = Array.isArray(item.historicalData) ? item.historicalData : [];
      for (const point of historicalData) {
        const d = typeof (point as { date?: string }).date === 'string' ? (point as { date: string }).date : null;
        if (d) allHistoricalDates.push(d);
      }

      const result: MarketDataSymbolResult = {
        symbol: item.symbol ?? resolved.symbol,
        dataSource: item.dataSource ?? resolved.dataSource,
        currentPrice: roundTwo(marketPrice),
        currency
      };

      if (
        includeHistorical &&
        historicalData.length > 0 &&
        (metrics.includes('change_1m') || metrics.includes('change_percent_1m'))
      ) {
        const oldest = historicalData[0] as { value?: number } | undefined;
        const oldVal = typeof oldest?.value === 'number' && Number.isFinite(oldest.value) ? oldest.value : undefined;
        if (oldVal !== undefined && oldVal !== 0) {
          result.change1m = roundTwo(marketPrice - oldVal);
          result.changePercent1m = roundTwo(((marketPrice - oldVal) / oldVal) * 100);
        }
      }

      results.push(result);
    } catch (err) {
      results.push({
        symbol: resolved.symbol,
        dataSource: resolved.dataSource,
        currentPrice: 0,
        currency: '',
        error: err instanceof Error ? err.message : 'Failed to fetch symbol data'
      });
    }
  }

  const answerParts = results.map((r) => {
    if (r.error) return `${r.symbol}: ${r.error}`;
    let line = `${r.symbol}: ${r.currency} ${r.currentPrice}`;
    if (r.changePercent1m !== undefined) {
      line += ` (${r.changePercent1m >= 0 ? '+' : ''}${r.changePercent1m}% vs ~1 month ago)`;
    }
    return line;
  });
  let summary =
    results.length === 0
      ? 'No market data retrieved'
      : `Current data for ${results.length} symbol(s)${includeHistorical ? ' with 1-month change' : ''}.`;

  const requestedDate = parseRequestedDateFromMessage(message ?? '');
  let date_mismatch_warning = false;
  if (requestedDate && allHistoricalDates.length > 0) {
    const check = checkDateRangeMatch(requestedDate, allHistoricalDates);
    date_mismatch_warning = check.date_mismatch_warning;
    if (check.date_mismatch_warning && check.nearestDate) {
      summary += ` Data for the requested period may not fully match; nearest available date is ${check.nearestDate}.`;
    }
  }

  const payload: Record<string, unknown> = {
    answer: answerParts.join('; '),
    data_as_of: new Date().toISOString(),
    sources: ['ghostfolio_api'],
    summary,
    symbols: results
  };
  if (date_mismatch_warning) payload.date_mismatch_warning = true;
  return payload;
}

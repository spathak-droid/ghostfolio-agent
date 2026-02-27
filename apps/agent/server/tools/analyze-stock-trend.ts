import type { GhostfolioClient } from '../clients';
import { resolveSymbolWithCandidates } from './symbol-resolver';
import { toToolErrorPayload } from './tool-error';

type TimelineRange = '7d' | '30d' | '90d' | '1y' | 'max' | `${number}d`;

interface HoldingHistoryPoint {
  date: string;
  marketPrice: number;
  quantity?: number;
}

interface TrendInput {
  client: GhostfolioClient;
  impersonationId?: string;
  message: string;
  range?: string;
  symbol?: string;
  token?: string;
}

/**
 * Purpose: Analyze a single holding trend for a requested timeline.
 * Inputs: asset symbol/name, timeline window, and portfolio holding API payload.
 * Outputs: trend metrics and natural-language answer from structured fields.
 * Failure modes: unresolved symbol/missing holding/history return structured non-throwing failures.
 */
export async function analyzeStockTrendTool({
  client,
  impersonationId,
  message,
  range,
  symbol,
  token
}: TrendInput): Promise<Record<string, unknown>> {
  const requestedRange = parseTimelineRange(range, message);
  const resolvedHolding = await resolveHoldingForAnalysis({
    client,
    impersonationId,
    message,
    symbol,
    token
  });
  if (resolvedHolding.failure) {
    return buildFailureResponse(resolvedHolding.failure);
  }

  const historicalData = normalizeHistoricalData(resolvedHolding.holdingPayload.historicalData);
  if (historicalData.length < 2) {
    return buildFailureResponse(
      `I found ${resolvedHolding.primarySymbol} but there is not enough historical data to analyze trend.`
    );
  }

  return buildTrendSuccessResponse({
    historicalData,
    holdingPayload: resolvedHolding.holdingPayload,
    primarySymbol: resolvedHolding.primarySymbol,
    range: requestedRange
  });
}

async function resolveHoldingForAnalysis({
  client,
  impersonationId,
  message,
  symbol,
  token
}: Pick<TrendInput, 'client' | 'impersonationId' | 'message' | 'symbol' | 'token'>): Promise<{
  failure?: string;
  holdingPayload: Record<string, unknown>;
  primarySymbol: string;
}> {
  const holdingState = await getPortfolioHoldingState({
    client,
    impersonationId,
    token
  });
  if (holdingState === 'empty') {
    return {
      failure:
        'I could not analyze a holding trend because your portfolio has no holdings yet. Add an asset first, then ask again.',
      holdingPayload: {},
      primarySymbol: ''
    };
  }

  const symbolQuery = (symbol ?? '').trim() || extractPrimarySymbolCandidate(message);
  if (!symbolQuery) {
    return missingSymbolResolution();
  }

  const resolved = await resolveHoldingSymbol({
    client,
    impersonationId,
    symbolQuery,
    token
  });
  if (resolved.failure) {
    return {
      failure: resolved.failure,
      holdingPayload: {},
      primarySymbol: ''
    };
  }

  return loadHoldingPayload({
    client,
    dataSource: resolved.dataSource,
    impersonationId,
    primarySymbol: resolved.symbol,
    token
  });
}

async function getPortfolioHoldingState({
  client,
  impersonationId,
  token
}: {
  client: GhostfolioClient;
  impersonationId?: string;
  token?: string;
}): Promise<'empty' | 'has_holdings' | 'unknown'> {
  const maybeClient = client as unknown as {
    getPortfolioSummary?: (args: {
      impersonationId?: string;
      token?: string;
    }) => Promise<unknown>;
  };
  if (typeof maybeClient.getPortfolioSummary !== 'function') {
    return 'unknown';
  }

  try {
    const summary = await maybeClient.getPortfolioSummary({ impersonationId, token });
    if (!isObject(summary)) {
      return 'unknown';
    }
    const holdings = isObject(summary.holdings) ? summary.holdings : undefined;
    if (!holdings) {
      return 'unknown';
    }

    const nonCashHoldingSymbols = Object.keys(holdings).filter(
      (symbol) => symbol.trim().toUpperCase() !== 'USD'
    );
    return nonCashHoldingSymbols.length > 0 ? 'has_holdings' : 'empty';
  } catch {
    return 'unknown';
  }
}

function missingSymbolResolution() {
  return {
    failure:
      'I could not resolve which asset to analyze. Please provide symbol/name and timeline (e.g. "BTCUSD, last 30 days").',
    holdingPayload: {},
    primarySymbol: ''
  };
}

async function resolveHoldingSymbol({
  client,
  impersonationId,
  symbolQuery,
  token
}: {
  client: GhostfolioClient;
  impersonationId?: string;
  symbolQuery: string;
  token?: string;
}): Promise<{ dataSource?: string; failure?: string; symbol: string }> {
  const lookup = createLookup(client, impersonationId, token);
  const resolution = await resolveSymbolWithCandidates(symbolQuery, lookup);
  if (!resolution.resolved) {
    const candidateHint = Array.isArray(resolution.candidates) && resolution.candidates.length > 0
      ? ` Candidates: ${resolution.candidates.map((c) => `${c.symbol} (${c.dataSource})`).join(', ')}.`
      : '';
    return {
      failure: `I could not resolve which asset to analyze for "${symbolQuery}".${candidateHint}`,
      symbol: ''
    };
  }
  return {
    dataSource: resolution.resolved.dataSource,
    symbol: resolution.resolved.symbol
  };
}

async function loadHoldingPayload({
  client,
  dataSource,
  impersonationId,
  primarySymbol,
  token
}: {
  client: GhostfolioClient;
  dataSource: string;
  impersonationId?: string;
  primarySymbol: string;
  token?: string;
}): Promise<{ failure?: string; holdingPayload: Record<string, unknown>; primarySymbol: string }> {
  for (const candidateSymbol of buildHoldingSymbolCandidates(primarySymbol)) {
    const payload = await fetchHolding({ candidateSymbol, client, dataSource, impersonationId, token });
    if (payload) return { holdingPayload: payload, primarySymbol };
  }
  return {
    failure: `I could not load holding data for ${primarySymbol}. Confirm this asset exists in your portfolio and try again.`,
    holdingPayload: {},
    primarySymbol
  };
}

function buildTrendSuccessResponse({
  historicalData,
  holdingPayload,
  primarySymbol,
  range
}: {
  historicalData: HoldingHistoryPoint[];
  holdingPayload: Record<string, unknown>;
  primarySymbol: string;
  range: TimelineRange;
}): Record<string, unknown> {
  const analyzed = analyzeTrend({ historicalData, range });
  const currentPrice = numberOrUndefined(holdingPayload.marketPrice) ?? analyzed.latest.marketPrice;
  const averagePrice = numberOrUndefined(holdingPayload.averagePrice) ?? 0;
  const sinceEntry = computeSinceEntry({ averagePrice, currentPrice });
  const symbolName = getSymbolName({ holdingPayload, primarySymbol });
  const answer = buildTrendAnswer({
    averagePrice,
    currentPrice,
    label: symbolName.label,
    normalizedSymbol: symbolName.normalizedSymbol,
    range,
    sinceEntry,
    trend: analyzed
  });

  return {
    answer,
    data: holdingPayload,
    data_as_of: `${analyzed.latest.date}T00:00:00.000Z`,
    range,
    source: 'ghostfolio_api',
    sources: ['ghostfolio_api'],
    summary: `Stock trend analysis for ${symbolName.normalizedSymbol}`,
    chart: {
      points: analyzed.windowData.map((point) => ({
        date: point.date,
        price: roundToTwo(point.marketPrice)
      })),
      range
    },
    performance: {
      currentPrice: roundToTwo(currentPrice),
      periodChange: roundToTwo(analyzed.periodChange),
      periodChangePercent: roundToTwo(analyzed.periodChangePercent),
      sinceEntryChange: sinceEntry ? roundToTwo(sinceEntry.absolute) : undefined,
      sinceEntryChangePercent: sinceEntry ? roundToTwo(sinceEntry.percent) : undefined
    },
    trend: {
      currentPrice: roundToTwo(currentPrice),
      periodChange: roundToTwo(analyzed.periodChange),
      periodChangePercent: roundToTwo(analyzed.periodChangePercent),
      sinceEntryChange: sinceEntry ? roundToTwo(sinceEntry.absolute) : undefined,
      sinceEntryChangePercent: sinceEntry ? roundToTwo(sinceEntry.percent) : undefined,
      windowHigh: roundToTwo(analyzed.windowHigh),
      windowLow: roundToTwo(analyzed.windowLow)
    }
  };
}

function computeSinceEntry({
  averagePrice,
  currentPrice
}: {
  averagePrice: number;
  currentPrice: number;
}) {
  if (!averagePrice || averagePrice <= 0) return undefined;
  return {
    absolute: currentPrice - averagePrice,
    percent: ((currentPrice - averagePrice) / averagePrice) * 100
  };
}

function getSymbolName({
  holdingPayload,
  primarySymbol
}: {
  holdingPayload: Record<string, unknown>;
  primarySymbol: string;
}) {
  const normalizedSymbol =
    stringOrUndefined((holdingPayload.SymbolProfile as Record<string, unknown> | undefined)?.symbol) ??
    primarySymbol;
  const label =
    stringOrUndefined((holdingPayload.SymbolProfile as Record<string, unknown> | undefined)?.name) ??
    normalizedSymbol;
  return { label, normalizedSymbol };
}

function buildTrendAnswer({
  averagePrice,
  currentPrice,
  label,
  normalizedSymbol,
  range,
  sinceEntry,
  trend
}: {
  averagePrice: number;
  currentPrice: number;
  label: string;
  normalizedSymbol: string;
  range: TimelineRange;
  sinceEntry?: { absolute: number; percent: number };
  trend: ReturnType<typeof analyzeTrend>;
}) {
  return [
    `${label} (${normalizedSymbol}) trend analysis.`,
    `Timeline: ${range}.`,
    `Current price: ${roundToTwo(currentPrice)}.`,
    `Period change: ${signed(roundToTwo(trend.periodChange))} (${signed(roundToTwo(trend.periodChangePercent))}%).`,
    `Window high/low: ${roundToTwo(trend.windowHigh)} / ${roundToTwo(trend.windowLow)}.`,
    sinceEntry
      ? `Since entry (avg ${roundToTwo(averagePrice)}): ${signed(roundToTwo(sinceEntry.absolute))} (${signed(roundToTwo(sinceEntry.percent))}%).`
      : 'Since entry: unavailable (missing average entry price).'
  ].join(' ');
}

function parseTimelineRange(inputRange: string | undefined, message: string): TimelineRange {
  const fromInput = (inputRange ?? '').trim().toLowerCase();
  if (/^\d+d$/.test(fromInput)) return fromInput as TimelineRange;
  if (fromInput === '7d' || fromInput === '1w') return '7d';
  if (fromInput === '30d' || fromInput === '1m') return '30d';
  if (fromInput === '90d' || fromInput === '3m') return '90d';
  if (fromInput === '1y' || fromInput === '365d') return '1y';
  if (fromInput === 'max' || fromInput === 'all') return 'max';

  const normalized = message.toLowerCase();
  if (/\b(last|past)\s+week\b/.test(normalized)) return '7d';
  if (/\b(last|past)\s+month\b/.test(normalized)) return '30d';
  if (/\b(last|past)\s+3\s+months?\b/.test(normalized)) return '90d';
  if (/\b(last|past)\s+year\b/.test(normalized)) return '1y';
  const daysRegex = /\b(last|past)\s+(\d{1,3})\s+days?\b/;
  const daysMatch = daysRegex.exec(normalized);
  if (daysMatch) {
    const parsedDays = Number(daysMatch[2]);
    if (Number.isFinite(parsedDays) && parsedDays > 0) {
      return `${Math.min(365, Math.floor(parsedDays))}d`;
    }
  }
  if (/\b(max|all time)\b/.test(normalized)) return 'max';
  return '30d';
}

function extractPrimarySymbolCandidate(message: string): string {
  const query = message.trim();
  if (!query) return '';
  const words = query
    .split(/[\s,().]+/)
    .map((word) => word.trim())
    .filter(Boolean);
  const lowercaseWords = words.map((word) => word.toLowerCase());
  const prioritizedAssetWords = [
    'bitcoin',
    'btc',
    'ethereum',
    'eth',
    'solana',
    'sol',
    'apple',
    'aapl',
    'tesla',
    'tsla',
    'nvidia',
    'nvda'
  ];
  const namedAsset = prioritizedAssetWords.find((word) => lowercaseWords.includes(word));
  if (namedAsset) {
    return namedAsset;
  }

  const tickerLike = words.find((word) => /^[A-Z0-9-]{2,15}$/.test(word));
  if (tickerLike) {
    return tickerLike;
  }

  // Don't fall back to arbitrary words - filter for symbol-like candidates
  const commonWords = new Set([
    'how', 'what', 'when', 'where', 'why', 'is', 'are', 'am', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'can',
    'my', 'your', 'their', 'our', 'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at',
    'for', 'to', 'of', 'by', 'with', 'from', 'as', 'about', 'into', 'through', 'during',
    'please', 'thanks', 'show', 'tell', 'analyze', 'get', 'trend', 'price', 'stock',
    'crypto', 'coin', 'asset', 'today', 'lately', 'recently', 'last', 'past',
    'holding', 'holdings'
  ]);

  const symbolLikeCandidates = words.filter(
    (word) => !commonWords.has(word.toLowerCase()) && word.length >= 2
  );

  return symbolLikeCandidates[0] ?? '';
}

function buildHoldingSymbolCandidates(symbol: string): string[] {
  const trimmed = symbol.trim();
  const noDash = trimmed.replace(/-/g, '');
  const withDash =
    /^[A-Z]{3,5}USD$/i.test(noDash) && !trimmed.includes('-')
      ? `${noDash.slice(0, noDash.length - 3)}-USD`
      : trimmed;
  return [...new Set([trimmed, noDash, withDash])].filter(Boolean);
}

async function fetchHolding({
  candidateSymbol,
  client,
  dataSource,
  impersonationId,
  token
}: {
  candidateSymbol: string;
  client: GhostfolioClient;
  dataSource: string;
  impersonationId?: string;
  token?: string;
}): Promise<Record<string, unknown> | null> {
  try {
    const data = await client.getPortfolioHolding({
      dataSource,
      symbol: candidateSymbol,
      impersonationId,
      token
    });
    return isObject(data) ? data : null;
  } catch {
    return null;
  }
}

function normalizeHistoricalData(input: unknown): HoldingHistoryPoint[] {
  if (!Array.isArray(input)) return [];
  const normalized: HoldingHistoryPoint[] = [];
  for (const item of input) {
    if (!isObject(item)) continue;
    const date = stringOrUndefined(item.date);
    const marketPrice = numberOrUndefined(item.marketPrice);
    const quantity = numberOrUndefined(item.quantity);
    if (!date || marketPrice === undefined || !Number.isFinite(marketPrice)) {
      continue;
    }
    normalized.push(quantity === undefined ? { date, marketPrice } : { date, marketPrice, quantity });
  }
  return normalized.sort((a, b) => (a.date < b.date ? -1 : 1));
}

function analyzeTrend({
  historicalData,
  range
}: {
  historicalData: HoldingHistoryPoint[];
  range: TimelineRange;
}) {
  const latest = historicalData[historicalData.length - 1];
  const startIndex = resolveWindowStartIndex(historicalData.length, range);
  const windowData = historicalData.slice(startIndex);
  const start = windowData[0];
  const periodChange = latest.marketPrice - start.marketPrice;
  const periodChangePercent =
    start.marketPrice > 0 ? (periodChange / start.marketPrice) * 100 : 0;
  const prices = windowData.map((item) => item.marketPrice);
  const windowHigh = Math.max(...prices);
  const windowLow = Math.min(...prices);
  return {
    latest,
    periodChange,
    periodChangePercent,
    windowData,
    windowHigh,
    windowLow
  };
}

function resolveWindowStartIndex(length: number, range: TimelineRange): number {
  if (range === 'max') return 0;
  const days =
    range === '7d'
      ? 7
      : range === '30d'
        ? 30
        : range === '90d'
          ? 90
          : range === '1y'
            ? 365
            : Math.max(1, Math.min(365, Number(range.replace('d', '')) || 30));
  return Math.max(0, length - days);
}

function createLookup(
  client: GhostfolioClient,
  impersonationId?: string,
  token?: string
) {
  return async (query: string): Promise<{ dataSource: string; symbol: string; name?: string }[]> => {
    try {
      const response = await client.getSymbolLookup({ query, impersonationId, token });
      return (response as { items?: { dataSource: string; symbol: string; name?: string }[] })?.items ?? [];
    } catch {
      return [];
    }
  };
}

function buildFailureResponse(message: string): Record<string, unknown> {
  const error = toToolErrorPayload(new Error(message));
  return {
    success: false,
    answer: message,
    summary: `Stock trend analysis failed: ${message}`,
    error,
    data_as_of: new Date().toISOString(),
    sources: ['ghostfolio_api']
  };
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}`;
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

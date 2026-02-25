import {
  NormalizedTransaction,
  buildTransactionIndexes,
  normalizeTransactions
} from './transaction-data';

export async function transactionCategorizeTool({
  dateFrom,
  dateTo,
  message,
  symbol,
  transactions,
  type
}: {
  dateFrom?: string;
  dateTo?: string;
  impersonationId?: string;
  message: string;
  symbol?: string;
  token?: string;
  transactions?: Record<string, unknown>[];
  type?: string;
}) {
  const normalized = normalizeTransactions(transactions ?? []);
  const indexes = buildTransactionIndexes(normalized);
  const parsedFilters = parseCategorizeFilters(message, indexes, {
    dateFrom,
    dateTo,
    symbol,
    type
  });
  const scopedTransactions = filterTransactions(normalized, parsedFilters);
  const scopedIndexes = buildTransactionIndexes(scopedTransactions);
  const categories = summarizeByType(scopedIndexes);
  const patternAnalysis = analyzePatterns(scopedTransactions, scopedIndexes);
  const missingData = [...patternAnalysis.missingData];
  if (scopedTransactions.length === 0) {
    missingData.unshift('No transactions matched the applied filters');
  }
  const filters = {
    ...parsedFilters,
    matchedCount: scopedTransactions.length
  };

  return {
    answer: buildAnswer({
      categories,
      filters,
      patterns: patternAnalysis.patterns,
      totalTransactions: scopedTransactions.length
    }),
    categories: categories.length > 0 ? categories : [{ category: 'UNKNOWN', count: 0 }],
    capabilities: {
      hasCorporateActions: false,
      hasFxRates: false,
      hasMarketPrices: false
    },
    computed: [
      ...categories.map(({ category, count, totalValue }) => ({
        formula: `sum(value) for type=${category}`,
        metric: 'total_value_by_category',
        result: totalValue,
        supporting_count: count
      })),
      ...patternAnalysis.computed
    ],
    data_as_of: new Date().toISOString(),
    input: message,
    assumptions: [
      'Transaction dates use the activity date field.',
      'Category totals are based on value when present, else unitPrice*quantity.',
      'Average trade size uses abs(netValue) across all normalized transactions.',
      'Activity trend compares transaction counts in last 30 days vs previous 30 days.',
      'Message filters (symbol/type/date range) are applied before category and pattern calculations.'
    ],
    filters,
    missing_data: missingData,
    patterns: {
      ...patternAnalysis.patterns,
      latestTransactionType: scopedIndexes.recent[0]?.type ?? 'UNKNOWN',
      totalTransactions: scopedTransactions.length
    },
    sources: ['agent_internal'],
    summary: `Transaction categorization completed for ${scopedTransactions.length} transactions`
  };
}

function buildAnswer({
  categories,
  filters,
  patterns,
  totalTransactions
}: {
  categories: { category: string; count: number; totalValue: number }[];
  filters: CategorizeFilters;
  patterns: PatternMetrics;
  totalTransactions: number;
}) {
  if (categories.length === 0) {
    return hasActiveFilters(filters)
      ? 'No transactions matched your requested filters.'
      : 'No transactions were available to categorize.';
  }

  const top = categories
    .slice(0, 3)
    .map(({ category, count }) => `${category} (${count})`)
    .join(', ');
  const ratioPart =
    patterns.buySellRatio === null
      ? 'buy/sell ratio unavailable (no sells)'
      : `buy/sell ratio ${patterns.buySellRatio}`;
  const trendPart =
    patterns.activityTrend30dVsPrev30dPercent === null
      ? '30d activity trend unavailable (no prior 30d baseline)'
      : `30d activity trend ${patterns.activityTrend30dVsPrev30dPercent}%`;
  const concentrationPart = patterns.topSymbolByCount?.symbol
    ? `top symbol ${patterns.topSymbolByCount.symbol} (${patterns.topSymbolByCount.sharePercent}%)`
    : 'top symbol unavailable';
  const filterPart = hasActiveFilters(filters)
    ? ` Filters: ${describeFilters(filters)}.`
    : '';

  return `Categorized ${totalTransactions} transactions.${filterPart} Top categories: ${top}. ${ratioPart}; ${trendPart}; ${concentrationPart}.`;
}

function summarizeByType(indexes: ReturnType<typeof buildTransactionIndexes>) {
  return [...indexes.byType.entries()]
    .map(([category, entries]) => ({
      category,
      count: entries.length,
      totalValue: roundToTwo(
        entries.reduce((sum, entry) => sum + (entry.value ?? entry.unitPrice * entry.quantity), 0)
      )
    }))
    .sort((a, b) => b.count - a.count);
}

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100;
}

interface PatternMetrics {
  activityLast30d: number;
  activityPrevious30d: number;
  activityTrend30dVsPrev30dPercent: number | null;
  averageTradeSize: number;
  buyCount: number;
  buySellRatio: number | null;
  feeDragPercent: number | null;
  sellCount: number;
  topSymbolByCount: { count: number; sharePercent: number; symbol: string } | null;
}

type TransactionType = 'BUY' | 'SELL' | 'DIVIDEND' | 'FEE' | 'INTEREST' | 'LIABILITY';

interface CategorizeFilters {
  dateFrom?: string;
  dateTo?: string;
  matchedCount: number;
  symbol?: string;
  type?: TransactionType;
}

function analyzePatterns(
  normalized: NormalizedTransaction[],
  indexes: ReturnType<typeof buildTransactionIndexes>
): {
  computed: {
    formula: string;
    metric: string;
    result: number | null;
    supporting_count: number;
  }[];
  missingData: string[];
  patterns: PatternMetrics;
} {
  const buyCount = indexes.byType.get('BUY')?.length ?? 0;
  const sellCount = indexes.byType.get('SELL')?.length ?? 0;
  const buySellRatio = sellCount > 0 ? roundToTwo(buyCount / sellCount) : null;

  const averageTradeSize = computeAverageTradeSize(normalized);
  const totalFees = normalized.reduce((sum, item) => sum + item.fee, 0);
  const grossAbs = normalized.reduce((sum, item) => sum + Math.abs(item.grossValue), 0);
  const feeDragPercent = grossAbs > 0 ? roundToTwo((totalFees / grossAbs) * 100) : null;

  const { activityLast30d, activityPrevious30d } = computeRecentActivityWindows(normalized);
  const activityTrend30dVsPrev30dPercent =
    activityPrevious30d > 0
      ? roundToTwo(((activityLast30d - activityPrevious30d) / activityPrevious30d) * 100)
      : null;

  const topSymbolByCount = resolveTopSymbolByCount(indexes, normalized.length);
  const missingData: string[] = [];
  if (buySellRatio === null) {
    missingData.push('buy/sell ratio unavailable because there are no SELL transactions');
  }
  if (activityTrend30dVsPrev30dPercent === null) {
    missingData.push('30d activity trend unavailable because there is no previous 30d baseline');
  }
  if (feeDragPercent === null) {
    missingData.push('fee drag unavailable because gross transaction value is zero');
  }
  if (!topSymbolByCount) {
    missingData.push('top symbol concentration unavailable because there are no transactions');
  }

  return {
    computed: buildPatternComputed({
      activityLast30d,
      activityPrevious30d,
      activityTrend30dVsPrev30dPercent,
      averageTradeSize,
      buyCount,
      buySellRatio,
      feeDragPercent,
      normalized,
      sellCount
    }),
    missingData,
    patterns: {
      activityLast30d,
      activityPrevious30d,
      activityTrend30dVsPrev30dPercent,
      averageTradeSize,
      buyCount,
      buySellRatio,
      feeDragPercent,
      sellCount,
      topSymbolByCount
    }
  };
}

function computeAverageTradeSize(normalized: NormalizedTransaction[]) {
  const netValues = normalized.map((item) => Math.abs(item.netValue));
  return netValues.length > 0
    ? roundToTwo(netValues.reduce((sum, value) => sum + value, 0) / netValues.length)
    : 0;
}

function computeRecentActivityWindows(normalized: NormalizedTransaction[]) {
  const today = new Date();
  const nowTs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const dayMs = 24 * 60 * 60 * 1000;
  const last30StartTs = nowTs - 29 * dayMs;
  const previous30StartTs = nowTs - 59 * dayMs;
  let activityLast30d = 0;
  let activityPrevious30d = 0;
  for (const item of normalized) {
    const dateTs = Date.parse(`${item.date}T00:00:00.000Z`);
    if (!Number.isFinite(dateTs)) continue;
    if (dateTs >= last30StartTs && dateTs <= nowTs) {
      activityLast30d += 1;
    } else if (dateTs >= previous30StartTs && dateTs < last30StartTs) {
      activityPrevious30d += 1;
    }
  }
  return { activityLast30d, activityPrevious30d };
}

function buildPatternComputed({
  activityLast30d,
  activityPrevious30d,
  activityTrend30dVsPrev30dPercent,
  averageTradeSize,
  buyCount,
  buySellRatio,
  feeDragPercent,
  normalized,
  sellCount
}: {
  activityLast30d: number;
  activityPrevious30d: number;
  activityTrend30dVsPrev30dPercent: number | null;
  averageTradeSize: number;
  buyCount: number;
  buySellRatio: number | null;
  feeDragPercent: number | null;
  normalized: NormalizedTransaction[];
  sellCount: number;
}) {
  return [
    {
      formula: 'BUY_count / SELL_count',
      metric: 'buy_sell_ratio',
      result: buySellRatio,
      supporting_count: buyCount + sellCount
    },
    {
      formula: 'sum(abs(netValue)) / transaction_count',
      metric: 'average_trade_size',
      result: averageTradeSize,
      supporting_count: normalized.length
    },
    {
      formula: '((last_30d_count - previous_30d_count) / previous_30d_count) * 100',
      metric: 'activity_trend_30d_vs_previous_30d_percent',
      result: activityTrend30dVsPrev30dPercent,
      supporting_count: activityLast30d + activityPrevious30d
    },
    {
      formula: 'sum(fee) / sum(abs(grossValue)) * 100',
      metric: 'fee_drag_percent',
      result: feeDragPercent,
      supporting_count: normalized.length
    }
  ];
}

function resolveTopSymbolByCount(
  indexes: ReturnType<typeof buildTransactionIndexes>,
  totalTransactions: number
) {
  let best: { count: number; symbol: string } | undefined;
  for (const [symbol, rows] of indexes.bySymbol.entries()) {
    const count = rows.length;
    if (!best || count > best.count) {
      best = { count, symbol };
    }
  }
  if (!best || totalTransactions === 0) {
    return null;
  }

  return {
    count: best.count,
    sharePercent: roundToTwo((best.count / totalTransactions) * 100),
    symbol: best.symbol
  };
}

function parseCategorizeFilters(
  message: string,
  indexes: ReturnType<typeof buildTransactionIndexes>,
  explicit: { dateFrom?: string; dateTo?: string; symbol?: string; type?: string }
): Omit<CategorizeFilters, 'matchedCount'> {
  const type = parseTypeFilter(message, explicit.type);
  const symbol = parseSymbolFilter(message, indexes, explicit.symbol);
  const { dateFrom, dateTo } = parseDateRangeFilter(message, {
    dateFrom: explicit.dateFrom,
    dateTo: explicit.dateTo
  });
  return {
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
    ...(symbol ? { symbol } : {}),
    ...(type ? { type } : {})
  };
}

function parseTypeFilter(message: string, explicitType?: string): TransactionType | undefined {
  const normalizedExplicit = explicitType?.trim().toUpperCase();
  if (normalizedExplicit && TRANSACTION_TYPES.has(normalizedExplicit)) {
    return normalizedExplicit as TransactionType;
  }
  const normalized = message.toLowerCase();
  const typePatterns: { pattern: RegExp; type: TransactionType }[] = [
    { pattern: /\b(buy|bought)\b/, type: 'BUY' },
    { pattern: /\b(sell|sold)\b/, type: 'SELL' },
    { pattern: /\bdividend(s)?\b/, type: 'DIVIDEND' },
    { pattern: /\bfee(s)?\b/, type: 'FEE' },
    { pattern: /\binterest\b/, type: 'INTEREST' },
    { pattern: /\bliability|debt\b/, type: 'LIABILITY' }
  ];
  return typePatterns.find(({ pattern }) => pattern.test(normalized))?.type;
}

function parseSymbolFilter(
  message: string,
  indexes: ReturnType<typeof buildTransactionIndexes>,
  explicitSymbol?: string
): string | undefined {
  const explicit = explicitSymbol?.trim().toUpperCase();
  if (explicit) {
    if (indexes.bySymbol.has(explicit)) {
      return explicit;
    }
    for (const [symbol, entries] of indexes.bySymbol.entries()) {
      if (
        entries.some((entry) =>
          entry.symbolName?.toUpperCase().includes(explicit)
        )
      ) {
        return symbol;
      }
    }
  }

  const tokens = message.match(/\b[A-Za-z0-9]{2,20}\b/g) ?? [];
  const candidate = tokens
    .map((item) => normalizeSymbolToken(item))
    .find((item) => !SYMBOL_STOP_WORDS.has(item) && !/^\d+$/.test(item) && !TRANSACTION_TYPES.has(item));

  if (!candidate) {
    return undefined;
  }

  if (indexes.bySymbol.has(candidate)) {
    return candidate;
  }

  for (const [symbol, entries] of indexes.bySymbol.entries()) {
    if (
      entries.some((entry) =>
        entry.symbolName?.toUpperCase().includes(candidate)
      )
    ) {
      return symbol;
    }
  }

  return undefined;
}

function parseDateRangeFilter(
  message: string,
  explicit?: { dateFrom?: string; dateTo?: string }
): { dateFrom?: string; dateTo?: string } {
  const hasExplicitDateFrom = typeof explicit?.dateFrom === 'string' && Boolean(explicit.dateFrom.trim());
  const hasExplicitDateTo = typeof explicit?.dateTo === 'string' && Boolean(explicit.dateTo.trim());
  if (hasExplicitDateFrom || hasExplicitDateTo) {
    return {
      ...(hasExplicitDateFrom ? { dateFrom: explicit?.dateFrom?.trim() } : {}),
      ...(hasExplicitDateTo ? { dateTo: explicit?.dateTo?.trim() } : {})
    };
  }

  const normalized = message.toLowerCase();
  const today = getTodayUtcDate();

  const explicitRangeRegex =
    /\bfrom\s+(\d{4}-\d{2}-\d{2})\s+(?:to|until|through|-)\s+(\d{4}-\d{2}-\d{2})\b/;
  const explicitRange = explicitRangeRegex.exec(normalized);
  if (explicitRange) {
    return { dateFrom: explicitRange[1], dateTo: explicitRange[2] };
  }

  if (normalized.includes('last year')) {
    const year = today.getUTCFullYear() - 1;
    return {
      dateFrom: `${year}-01-01`,
      dateTo: `${year}-12-31`
    };
  }

  if (normalized.includes('this year')) {
    const year = today.getUTCFullYear();
    return {
      dateFrom: `${year}-01-01`,
      dateTo: formatUtcDate(today)
    };
  }

  if (normalized.includes('last month')) {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
    return {
      dateFrom: formatUtcDate(start),
      dateTo: formatUtcDate(end)
    };
  }

  if (normalized.includes('this month')) {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    return {
      dateFrom: formatUtcDate(start),
      dateTo: formatUtcDate(today)
    };
  }

  const rollingDaysRegex = /\b(last|past)\s+(\d{1,3})\s+days\b/;
  const rollingDays = rollingDaysRegex.exec(normalized);
  if (rollingDays) {
    const days = Number(rollingDays[2]);
    if (Number.isFinite(days) && days > 0) {
      const start = new Date(today.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
      return {
        dateFrom: formatUtcDate(start),
        dateTo: formatUtcDate(today)
      };
    }
  }

  const yearMatchRegex = /\b(20\d{2})\b/;
  const yearMatch = yearMatchRegex.exec(normalized);
  if (yearMatch) {
    const year = yearMatch[1];
    return {
      dateFrom: `${year}-01-01`,
      dateTo: `${year}-12-31`
    };
  }

  return {};
}

function filterTransactions(
  normalized: NormalizedTransaction[],
  filters: Omit<CategorizeFilters, 'matchedCount'>
) {
  return normalized.filter((entry) => {
    if (filters.symbol && entry.symbol !== filters.symbol) {
      return false;
    }
    if (filters.type && entry.type !== filters.type) {
      return false;
    }
    if (filters.dateFrom && entry.date < filters.dateFrom) {
      return false;
    }
    if (filters.dateTo && entry.date > filters.dateTo) {
      return false;
    }
    return true;
  });
}

function normalizeSymbolToken(token: string) {
  const normalized = token.toUpperCase();
  return SYMBOL_ALIASES[normalized] ?? normalized;
}

function hasActiveFilters(filters: CategorizeFilters) {
  return Boolean(filters.symbol || filters.type || filters.dateFrom || filters.dateTo);
}

function describeFilters(filters: CategorizeFilters) {
  const parts: string[] = [];
  if (filters.symbol) parts.push(`symbol=${filters.symbol}`);
  if (filters.type) parts.push(`type=${filters.type}`);
  if (filters.dateFrom || filters.dateTo) {
    parts.push(`date=${filters.dateFrom ?? 'start'}..${filters.dateTo ?? 'end'}`);
  }
  return parts.join(', ');
}

function getTodayUtcDate() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function formatUtcDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

const TRANSACTION_TYPES = new Set<string>([
  'BUY',
  'SELL',
  'DIVIDEND',
  'FEE',
  'INTEREST',
  'LIABILITY'
]);

const SYMBOL_STOP_WORDS = new Set([
  'A',
  'ALL',
  'AND',
  'AT',
  'BUY',
  'BOUGHT',
  'CATEGORIZE',
  'DID',
  'FROM',
  'I',
  'IN',
  'LAST',
  'ME',
  'MONTH',
  'MY',
  'OF',
  'PAST',
  'SELL',
  'SOLD',
  'THE',
  'THIS',
  'TO',
  'TRANSACTION',
  'TRANSACTIONS',
  'TYPE',
  'YEAR'
]);

const SYMBOL_ALIASES: Record<string, string> = {
  BITCOIN: 'BTCUSD',
  BTC: 'BTCUSD',
  TESLA: 'TSLA',
  APPLE: 'AAPL',
  NVIDIA: 'NVDA'
};

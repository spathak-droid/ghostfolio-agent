import {
  buildTransactionIndexes,
  normalizeTransactions
} from './transaction-data';

interface TimelineFilters {
  dateFrom?: string;
  dateTo?: string;
  symbol?: string;
  type?: 'BUY' | 'SELL';
  wantsLatest: boolean;
}

export async function transactionTimelineTool({
  dateFrom,
  dateTo,
  message,
  symbol,
  transactions,
  type,
  wantsLatest
}: {
  dateFrom?: string;
  dateTo?: string;
  impersonationId?: string;
  message: string;
  symbol?: string;
  token?: string;
  transactions?: Record<string, unknown>[];
  type?: string;
  wantsLatest?: boolean;
}) {
  const normalized = normalizeTransactions(transactions ?? []);
  const indexes = buildTransactionIndexes(normalized);
  const filters = parseFilters(message, indexes, {
    dateFrom,
    dateTo,
    symbol,
    type,
    wantsLatest
  });
  const filtered = filterTransactions({ filters, indexes }).slice(0, 50);
  const timeline = filtered.map(({ date, quantity, symbol: resolvedSymbol, type: resolvedType, unitPrice }) => ({
    date,
    quantity,
    symbol: resolvedSymbol,
    type: resolvedType,
    unitPrice
  }));

  return {
    answer: buildAnswer({ filters, timeline }),
    assumptions: ['Trade timing is derived from transaction date, not record createdAt.'],
    capabilities: {
      hasCorporateActions: false,
      hasFxRates: false,
      hasMarketPrices: false
    },
    computed: timeline.map(({ date, symbol: resolvedSymbol, type: resolvedType, unitPrice }) => ({
      formula: `match(symbol=${resolvedSymbol}, type=${resolvedType}) -> unitPrice on ${date}`,
      metric: 'matched_trade_price',
      result: unitPrice
    })),
    data_as_of: new Date().toISOString(),
    filters,
    missing_data: timeline.length === 0 ? ['No matching transactions for requested filters'] : [],
    sources: ['agent_internal'],
    summary: `Found ${timeline.length} matching transaction${timeline.length === 1 ? '' : 's'}`,
    timeline
  };
}

function parseFilters(
  message: string,
  indexes: ReturnType<typeof buildTransactionIndexes>,
  explicit?: {
    dateFrom?: string;
    dateTo?: string;
    symbol?: string;
    type?: string;
    wantsLatest?: boolean;
  }
): TimelineFilters {
  const normalized = message.toLowerCase();
  const type = parseTypeFilter(normalized, explicit?.type);
  const wantsLatest =
    explicit?.wantsLatest === true ||
    normalized.includes('last transaction') ||
    normalized.includes('latest transaction') ||
    normalized.includes('most recent transaction');
  const symbol = parseSymbolFilter(message, indexes, explicit?.symbol);
  const { dateFrom, dateTo } = parseDateRangeFilter(message, {
    dateFrom: explicit?.dateFrom,
    dateTo: explicit?.dateTo
  });

  return { dateFrom, dateTo, symbol, type, wantsLatest };
}

function parseTypeFilter(
  normalizedMessage: string,
  explicitType?: string
): TimelineFilters['type'] {
  const normalizedExplicit = explicitType?.trim().toUpperCase();
  if (normalizedExplicit === 'BUY' || normalizedExplicit === 'SELL') {
    return normalizedExplicit;
  }
  if (normalizedMessage.includes('buy') || normalizedMessage.includes('bought')) {
    return 'BUY';
  }
  if (normalizedMessage.includes('sell') || normalizedMessage.includes('sold')) {
    return 'SELL';
  }
  return undefined;
}

function parseSymbolFilter(
  message: string,
  indexes: ReturnType<typeof buildTransactionIndexes>,
  explicitSymbol?: string
) {
  const explicitCandidate = explicitSymbol?.trim();
  if (explicitCandidate) {
    return resolveSymbolCandidate(normalizeSymbolToken(explicitCandidate), indexes);
  }

  const symbolMatch = message.match(/\b[A-Za-z0-9]{2,20}\b/g) ?? [];
  const symbolCandidate = symbolMatch
    .map((item) => normalizeSymbolToken(item))
    .find((item) => !STOP_WORDS.has(item));

  return resolveSymbolCandidate(symbolCandidate, indexes);
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
  if (normalized.includes('last year')) {
    const year = today.getUTCFullYear() - 1;
    return { dateFrom: `${year}-01-01`, dateTo: `${year}-12-31` };
  }
  if (normalized.includes('this year')) {
    const year = today.getUTCFullYear();
    return { dateFrom: `${year}-01-01`, dateTo: formatUtcDate(today) };
  }

  const yearMatchRegex = /\b(20\d{2})\b/;
  const yearMatch = yearMatchRegex.exec(normalized);
  if (yearMatch) {
    const year = yearMatch[1];
    return { dateFrom: `${year}-01-01`, dateTo: `${year}-12-31` };
  }

  return {};
}

function filterTransactions({
  filters,
  indexes
}: {
  filters: TimelineFilters;
  indexes: ReturnType<typeof buildTransactionIndexes>;
}) {
  if (filters.wantsLatest) {
    const latest = indexes.recent[0];
    return latest ? [latest] : [];
  }

  const base =
    filters.symbol && indexes.bySymbol.has(filters.symbol)
      ? [...(indexes.bySymbol.get(filters.symbol) ?? [])]
      : [...indexes.recent];

  return base
    .filter((entry) => !filters.type || entry.type === filters.type)
    .filter((entry) => !filters.dateFrom || entry.date >= filters.dateFrom)
    .filter((entry) => !filters.dateTo || entry.date <= filters.dateTo)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function normalizeSymbolToken(token: string) {
  const normalized = token.toUpperCase();
  return SYMBOL_ALIASES[normalized] ?? normalized;
}

function resolveSymbolCandidate(
  candidate: string | undefined,
  indexes: ReturnType<typeof buildTransactionIndexes>
) {
  if (!candidate) {
    return undefined;
  }

  if (indexes.bySymbol.has(candidate)) {
    return candidate;
  }

  for (const [symbol, entries] of indexes.bySymbol.entries()) {
    if (entries.some((entry) => entry.symbolName?.toUpperCase().includes(candidate))) {
      return symbol;
    }
  }

  return undefined;
}

const STOP_WORDS = new Set([
  'A',
  'ALL',
  'AND',
  'AT',
  'BOUGHT',
  'BUY',
  'DID',
  'I',
  'MY',
  'OF',
  'PRICE',
  'SELL',
  'SOLD',
  'THE',
  'WHAT',
  'WHEN'
]);

const SYMBOL_ALIASES: Record<string, string> = {
  APPLE: 'AAPL',
  BITCOIN: 'BTCUSD',
  BTC: 'BTCUSD',
  NVIDIA: 'NVDA',
  TESLA: 'TSLA'
};

function getTodayUtcDate() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function formatUtcDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function buildAnswer({
  filters,
  timeline
}: {
  filters: TimelineFilters;
  timeline: {
    date: string;
    quantity: number;
    symbol: string;
    type: string;
    unitPrice: number;
  }[];
}) {
  if (timeline.length === 0) {
    if (filters.symbol) {
      return `No matching ${filters.type ?? ''} transactions were found for ${filters.symbol}.`.replace(
        /\s+/g,
        ' '
      );
    }

    return 'No matching transactions were found for your query.';
  }

  const first = timeline[0];
  return `${first.symbol} ${first.type} on ${first.date} at ${first.unitPrice}.`;
}


import {
  buildTransactionIndexes,
  normalizeTransactions
} from './transaction-data';

export async function transactionTimelineTool({
  message,
  transactions
}: {
  impersonationId?: string;
  message: string;
  token?: string;
  transactions?: Record<string, unknown>[];
}) {
  const normalized = normalizeTransactions(transactions ?? []);
  const indexes = buildTransactionIndexes(normalized);
  const filters = parseFilters(message, indexes);
  const filtered = filterTransactions({ filters, indexes }).slice(0, 50);
  const timeline = filtered.map(({ date, quantity, symbol, type, unitPrice }) => ({
    date,
    quantity,
    symbol,
    type,
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
    computed: timeline.map(({ date, symbol, type, unitPrice }) => ({
      formula: `match(symbol=${symbol}, type=${type}) -> unitPrice on ${date}`,
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
  indexes: ReturnType<typeof buildTransactionIndexes>
) {
  const normalized = message.toLowerCase();
  let type: 'BUY' | 'SELL' | undefined;
  const wantsLatest =
    normalized.includes('last transaction') ||
    normalized.includes('latest transaction') ||
    normalized.includes('most recent transaction');

  if (normalized.includes('buy') || normalized.includes('bought')) {
    type = 'BUY';
  } else if (normalized.includes('sell') || normalized.includes('sold')) {
    type = 'SELL';
  }

  const symbolMatch = message.match(/\b[A-Za-z0-9]{2,20}\b/g) ?? [];
  const symbolCandidate = symbolMatch
    .map((item) => normalizeSymbolToken(item))
    .find((item) => !STOP_WORDS.has(item));

  const symbol = resolveSymbolCandidate(symbolCandidate, indexes);

  return { symbol, type, wantsLatest };
}

function filterTransactions({
  filters,
  indexes
}: {
  filters: ReturnType<typeof parseFilters>;
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
  BITCOIN: 'BTCUSD',
  BTC: 'BTCUSD',
  TESLA: 'TSLA'
};

function buildAnswer({
  filters,
  timeline
}: {
  filters: { symbol?: string; type?: 'BUY' | 'SELL'; wantsLatest: boolean };
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

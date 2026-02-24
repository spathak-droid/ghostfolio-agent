import {
  buildTransactionIndexes,
  normalizeTransactions
} from './transaction-data';

export async function transactionCategorizeTool({
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
  const categories = summarizeByType(indexes);
  const latestTransactionType = indexes.recent[0]?.type;

  return {
    answer: buildAnswer({
      categories,
      totalTransactions: normalized.length
    }),
    categories: categories.length > 0 ? categories : [{ category: 'UNKNOWN', count: 0 }],
    capabilities: {
      hasCorporateActions: false,
      hasFxRates: false,
      hasMarketPrices: false
    },
    computed: categories.map(({ category, count, totalValue }) => ({
      formula: `sum(value) for type=${category}`,
      metric: 'total_value_by_category',
      result: totalValue,
      supporting_count: count
    })),
    data_as_of: new Date().toISOString(),
    input: message,
    assumptions: [
      'Transaction dates use the activity date field.',
      'Category totals are based on value when present, else unitPrice*quantity.'
    ],
    missing_data: [],
    patterns: {
      latestTransactionType: latestTransactionType ?? 'UNKNOWN',
      totalTransactions: normalized.length
    },
    sources: ['agent_internal'],
    summary: `Transaction categorization completed for ${normalized.length} transactions`
  };
}

function buildAnswer({
  categories,
  totalTransactions
}: {
  categories: { category: string; count: number; totalValue: number }[];
  totalTransactions: number;
}) {
  if (categories.length === 0) {
    return 'No transactions were available to categorize.';
  }

  const top = categories
    .slice(0, 3)
    .map(({ category, count }) => `${category} (${count})`)
    .join(', ');

  return `Categorized ${totalTransactions} transactions. Top categories: ${top}.`;
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

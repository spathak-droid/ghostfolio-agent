export interface NormalizedTransaction {
  accountId: string | undefined;
  accountName: string | undefined;
  activityId: string | undefined;
  assetClass: string | undefined;
  assetSubClass: string | undefined;
  baseCurrency: string | undefined;
  countries: unknown[] | undefined;
  createdAt: string | undefined;
  currency: string | undefined;
  dataSource: string | undefined;
  date: string;
  fee: number;
  feesIncludedInValue: false;
  figi: string | undefined;
  grossValue: number;
  isin: string | undefined;
  netValue: number;
  positionAfter: number;
  priceAsOf: string | undefined;
  priceCurrency: string | undefined;
  priceType: 'execution';
  quantity: number;
  sectors: unknown[] | undefined;
  symbol: string;
  symbolName: string | undefined;
  totalCost: number;
  type: string;
  unitPrice: number;
  updatedAt: string | undefined;
  userId: string | undefined;
  value: number | undefined;
  valueInBaseCurrency: number | undefined;
}

export interface TransactionIndexes {
  bySymbol: Map<string, NormalizedTransaction[]>;
  byType: Map<string, NormalizedTransaction[]>;
  recent: NormalizedTransaction[];
}

export function normalizeTransactions(transactions: Record<string, unknown>[]) {
  const normalized = transactions
    .map((transaction) => {
      const symbolProfile = asObject(transaction.SymbolProfile);
      const account = asObject(transaction.account);
      const symbol = asString(symbolProfile?.symbol)?.toUpperCase();
      const symbolName = asString(symbolProfile?.name);
      const type = asString(transaction.type)?.toUpperCase();
      const date = asString(transaction.date);
      const unitPrice = asNumber(transaction.unitPrice);
      const quantity = asNumber(transaction.quantity);
      const value = asNumber(transaction.value);
      const fee = asNumber(transaction.fee) ?? 0;
      const grossValue =
        value ?? (unitPrice === undefined || quantity === undefined ? 0 : unitPrice * quantity);
      const netValue = grossValue - fee;
      const totalCost = type === 'BUY' ? grossValue + fee : grossValue;

      if (!symbol || !type || !date || unitPrice === undefined || quantity === undefined) {
        return undefined;
      }

      return {
        accountId: asString(transaction.accountId),
        accountName: asString(account?.name),
        activityId: asString(transaction.id),
        assetClass: asString(symbolProfile?.assetClass),
        assetSubClass: asString(symbolProfile?.assetSubClass),
        baseCurrency: asString(transaction.baseCurrency),
        countries: asArray(symbolProfile?.countries),
        createdAt: asString(transaction.createdAt),
        currency: asString(transaction.currency),
        dataSource: asString(symbolProfile?.dataSource),
        date: date.slice(0, 10),
        fee,
        feesIncludedInValue: false,
        figi: asString(symbolProfile?.figi),
        grossValue: roundToTwo(grossValue),
        isin: asString(symbolProfile?.isin),
        netValue: roundToTwo(netValue),
        positionAfter: 0,
        priceAsOf: asString(transaction.priceAsOf),
        priceCurrency: asString(transaction.priceCurrency),
        priceType: 'execution' as const,
        quantity,
        sectors: asArray(symbolProfile?.sectors),
        symbol,
        symbolName,
        totalCost: roundToTwo(totalCost),
        type,
        unitPrice,
        updatedAt: asString(transaction.updatedAt),
        userId: asString(transaction.userId),
        value,
        valueInBaseCurrency: asNumber(transaction.valueInBaseCurrency)
      } satisfies NormalizedTransaction;
    })
    .filter((item): item is NormalizedTransaction => item !== undefined)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const positionBySymbol = new Map<string, number>();
  for (const item of normalized) {
    const previous = positionBySymbol.get(item.symbol) ?? 0;
    const delta = signedQuantity(item.type, item.quantity);
    item.positionAfter = roundToTwo(previous + delta);
    positionBySymbol.set(item.symbol, item.positionAfter);
  }

  return normalized;
}

export function buildTransactionIndexes(
  normalizedTransactions: NormalizedTransaction[]
): TransactionIndexes {
  const bySymbol = new Map<string, NormalizedTransaction[]>();
  const byType = new Map<string, NormalizedTransaction[]>();

  for (const transaction of normalizedTransactions) {
    addToIndex(bySymbol, transaction.symbol, transaction);
    addToIndex(byType, transaction.type, transaction);
  }

  return {
    bySymbol,
    byType,
    recent: [...normalizedTransactions].sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : 0
    )
  };
}

function addToIndex(
  index: Map<string, NormalizedTransaction[]>,
  key: string,
  transaction: NormalizedTransaction
) {
  const items = index.get(key) ?? [];
  items.push(transaction);
  index.set(key, items);
}

function asObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : undefined;
}

function signedQuantity(type: string, quantity: number) {
  if (type === 'BUY') {
    return quantity;
  }

  if (type === 'SELL') {
    return -quantity;
  }

  return 0;
}

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100;
}

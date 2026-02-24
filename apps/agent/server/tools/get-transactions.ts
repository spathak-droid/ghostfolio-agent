import { appendFileSync } from 'fs';
import { join } from 'path';

import { GhostfolioClient } from '../ghostfolio-client';

export async function getTransactionsTool({
  client,
  impersonationId,
  message,
  token
}: {
  client: GhostfolioClient;
  impersonationId?: string;
  message: string;
  token?: string;
}) {
  const data = await client.getTransactions({ impersonationId, token });
  const transactions =
    isObject(data) && Array.isArray(data.activities)
      ? (data.activities as Record<string, unknown>[])
      : [];
  logTransactionsFetch({
    data,
    message,
    transactions
  });

  return {
    data,
    data_as_of: new Date().toISOString(),
    message,
    source: 'ghostfolio_api',
    sources: ['ghostfolio_api'],
    summary: `Fetched ${transactions.length} transactions from Ghostfolio`,
    transactions
  };
}

function logTransactionsFetch({
  data,
  message,
  transactions
}: {
  data: unknown;
  message: string;
  transactions: Record<string, unknown>[];
}) {
  const preview = transactions.slice(0, 5).map((transaction) => {
    const symbolProfile = isObject(transaction.SymbolProfile) ? transaction.SymbolProfile : undefined;
    return {
      date: asString(transaction.date),
      quantity: asNumber(transaction.quantity),
      symbol: isObject(symbolProfile) ? asString(symbolProfile.symbol) : undefined,
      type: asString(transaction.type),
      unitPrice: asNumber(transaction.unitPrice),
      value: asNumber(transaction.value)
    };
  });

  const payload = {
    location: 'get-transactions.ts:getTransactionsTool',
    message: 'fetched transactions data',
    query: message,
    count: transactions.length,
    hasDataWrapper: isObject(data),
    preview,
    timestamp: Date.now()
  };

  try {
    appendFileSync(join(process.cwd(), '.cursor', 'debug-af2e79.log'), `${JSON.stringify(payload)}\n`);
  } catch {
    // ignore logging failures
  }

  // eslint-disable-next-line no-console
  console.log('[agent-transactions] fetched:', payload);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

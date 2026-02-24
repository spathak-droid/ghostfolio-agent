import { appendFileSync } from 'fs';
import { join } from 'path';

import { GhostfolioClient } from '../ghostfolio-client';

export async function portfolioAnalysisTool({
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
  const data = await client.getPortfolioSummary({ impersonationId, token });
  logPortfolioFetch(data);
  const generatedAt = new Date().toISOString();

  const allocationResult = normalizeAllocation(data?.holdings);
  const allocation = allocationResult.allocation;
  const performance = normalizePerformance(data?.summary);
  const dataAsOf = resolveDataAsOf({
    createdAt: data?.createdAt,
    generatedAt
  });

  return {
    allocation,
    data_as_of: dataAsOf,
    performance,
    message,
    source: 'ghostfolio_api',
    sources: ['ghostfolio_api'],
    summary: 'Portfolio analysis from Ghostfolio data',
    usd_removed_from_holdings: allocationResult.usdRemovedFromHoldings,
    data
  };
}

function logPortfolioFetch(data: unknown) {
  if (!isObject(data)) {
    return;
  }

  const holdings = isObject(data.holdings) ? data.holdings : {};
  const summary = isObject(data.summary) ? data.summary : {};
  const symbols = Object.keys(holdings).slice(0, 5);

  const payload = {
    location: 'portfolio-analysis.ts:portfolioAnalysisTool',
    message: 'fetched portfolio data',
    hasError: asBoolean(data.hasError),
    holdingsCount: Object.keys(holdings).length,
    symbols,
    summary: {
      netPerformance: asNumber(summary.netPerformance),
      netPerformancePercentage: asNumber(summary.netPerformancePercentage),
      totalValueInBaseCurrency: asNumber(summary.totalValueInBaseCurrency)
    },
    timestamp: Date.now()
  };

  try {
    appendFileSync(join(process.cwd(), '.cursor', 'debug-af2e79.log'), `${JSON.stringify(payload)}\n`);
  } catch {
    // ignore logging failures
  }

  // eslint-disable-next-line no-console
  console.log('[agent-portfolio] fetched:', payload);
}

/**
 * USD is CASH, not a holding. Holdings/allocation must exclude USD;
 * cash is shown separately from portfolio allocation.
 */
const CASH_SYMBOLS = new Set(['USD']);

function isCashSymbol(symbol: string): boolean {
  return CASH_SYMBOLS.has(symbol.toUpperCase());
}

function normalizeAllocation(holdings: unknown): {
  allocation: { percentage: number; symbol: string }[];
  usdRemovedFromHoldings: boolean;
} {
  if (!isObject(holdings)) {
    return { allocation: [], usdRemovedFromHoldings: false };
  }

  const rows = Object.values(holdings)
    .filter(isObject)
    .map((holding) => {
      const symbol = asString(holding.symbol) ?? 'unknown';
      const share = asNumber(holding.allocationInPercentage) ?? 0;
      return {
        percentage: roundToTwo(share * 100),
        symbol
      };
    });

  const usdRemovedFromHoldings = rows.some((r) => isCashSymbol(r.symbol));
  const allocation = rows
    .filter((r) => !isCashSymbol(r.symbol))
    .sort((a, b) => b.percentage - a.percentage)
    .slice(0, 10);

  return { allocation, usdRemovedFromHoldings };
}

function normalizePerformance(summary: unknown) {
  if (!isObject(summary)) {
    return undefined;
  }

  return {
    netPerformance: asNumber(summary.netPerformance) ?? 0,
    netPerformancePercentage: asNumber(summary.netPerformancePercentage) ?? 0,
    totalValueInBaseCurrency: asNumber(summary.totalValueInBaseCurrency) ?? 0
  };
}

function resolveDataAsOf({
  createdAt,
  generatedAt
}: {
  createdAt: unknown;
  generatedAt: string;
}) {
  return asString(createdAt) ?? generatedAt;
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

function asBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : undefined;
}

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100;
}

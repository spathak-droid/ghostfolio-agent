import { GhostfolioClient } from '../ghostfolio-client';
import { logger } from '../logger';
import { toToolErrorPayload } from './tool-error';

export async function holdingsAnalysisTool({
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
  try {
    const rawData = await client.getPortfolioHoldings({ impersonationId, range: 'max', token });
    const data = normalizePortfolioData(rawData);
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
      summary: 'Holdings analysis from Ghostfolio data',
      usd_removed_from_holdings: allocationResult.usdRemovedFromHoldings,
      data
    };
  } catch (error) {
    const toolError = toToolErrorPayload(error);
    return {
      success: false,
      answer: `Could not fetch portfolio details: ${toolError.message}`,
      summary: `Holdings analysis failed: ${toolError.message}`,
      error: toolError,
      data_as_of: new Date().toISOString(),
      sources: ['ghostfolio_api']
    };
  }
}

function normalizePortfolioData(input: unknown): Record<string, unknown> {
  if (!isObject(input)) {
    return {};
  }

  const normalized = { ...input };
  const holdingsArray = Array.isArray(input.holdings)
    ? input.holdings.filter(isObject)
    : undefined;
  if (!holdingsArray) {
    return normalized;
  }

  const holdingsBySymbol: Record<string, unknown> = {};
  let cash = 0;
  let investment = 0;
  let netPerformance = 0;
  let totalValue = 0;

  for (const holding of holdingsArray) {
    const symbol = asString(holding.symbol);
    if (!symbol) {
      continue;
    }
    holdingsBySymbol[symbol] = holding;
    const valueInBaseCurrency = asNumber(holding.valueInBaseCurrency) ?? 0;
    const itemInvestment = asNumber(holding.investment) ?? 0;
    totalValue += valueInBaseCurrency;
    investment += itemInvestment;
    netPerformance += asNumber(holding.netPerformance) ?? 0;
    if (isCashSymbol(symbol) || asString(holding.assetSubClass)?.toUpperCase() === 'CASH') {
      cash += valueInBaseCurrency;
    }
  }

  normalized.holdings = holdingsBySymbol;

  const existingSummary = isObject(input.summary) ? input.summary : {};
  const computedNetPerformancePercent = investment > 0 ? netPerformance / investment : 0;
  normalized.summary = {
    ...existingSummary,
    cash: asNumber(existingSummary.cash) ?? cash,
    netPerformance: asNumber(existingSummary.netPerformance) ?? netPerformance,
    netPerformancePercentage:
      asNumber(existingSummary.netPerformancePercentage) ?? roundToFour(computedNetPerformancePercent),
    totalValueInBaseCurrency: asNumber(existingSummary.totalValueInBaseCurrency) ?? totalValue
  };

  return normalized;
}

function logPortfolioFetch(data: unknown) {
  if (!isObject(data)) {
    return;
  }

  const holdings = isObject(data.holdings) ? data.holdings : {};
  const summary = isObject(data.summary) ? data.summary : {};
  const symbols = Object.keys(holdings).slice(0, 5);

  const payload = {
    location: 'holdings-analysis.ts:holdingsAnalysisTool',
    message: 'fetched holdings data',
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
  logger.debug('[agent-holdings] fetched:', payload);
}

/** USD is CASH, not a holding. Holdings/allocation must exclude USD. */
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

function roundToFour(value: number) {
  return Math.round(value * 10000) / 10000;
}

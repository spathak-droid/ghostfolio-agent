import { GhostfolioClient } from '../clients';
import { logger } from '../utils';
import { toToolErrorPayload } from './tool-error';

export async function portfolioSummaryTool({
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
    const data = await client.getPortfolioSummary({ impersonationId, token });
    logPortfolioSummaryFetch(data);
    const generatedAt = new Date().toISOString();
    const normalized = normalizeDetailsPayload(data);
    const dataAsOf = resolveDataAsOf({
      createdAt: data?.createdAt,
      generatedAt
    });

    return {
      allocation: [],
      data_as_of: dataAsOf,
      message,
      source: 'ghostfolio_api',
      sources: ['ghostfolio_api'],
      summary: 'Portfolio summary from Ghostfolio',
      answer: 'Portfolio summary retrieved successfully',
      summary_data: normalized,
      data,
      accounts: data?.accounts,
      platforms: data?.platforms
    };
  } catch (error) {
    const toolError = toToolErrorPayload(error);
    return {
      success: false,
      answer: `Could not fetch portfolio summary: ${toolError.message}`,
      summary: `Portfolio summary failed: ${toolError.message}`,
      error: toolError,
      data_as_of: new Date().toISOString(),
      sources: ['ghostfolio_api']
    };
  }
}

function logPortfolioSummaryFetch(data: unknown) {
  if (!isObject(data)) {
    return;
  }

  const summary = isObject(data.summary) ? data.summary : {};
  const payload = {
    location: 'portfolio-summary.ts:portfolioSummaryTool',
    message: 'fetched portfolio summary data',
    hasError: asBoolean(data.hasError),
    summary: {
      currentNetWorth: asNumber(summary.currentNetWorth),
      netPerformance: asNumber(summary.netPerformance),
      netPerformancePercentage: asNumber(summary.netPerformancePercentage),
      annualizedPerformancePercent: asNumber(summary.annualizedPerformancePercent),
      cash: asNumber(summary.cash)
    },
    timestamp: Date.now()
  };
  logger.debug('[agent-portfolio-summary] fetched:', payload);
}

function normalizeDetailsPayload(data: Record<string, unknown>) {
  const summary = isObject(data.summary) ? data.summary : {};
  return {
    /** Current net worth (balance) */
    balance: asNumber(summary.currentNetWorth) ?? 0,
    /** Net performance in dollars */
    netPerformance: asNumber(summary.netPerformance) ?? 0,
    /** Net performance as percentage */
    netPerformancePercentage: asNumber(summary.netPerformancePercentage) ?? 0,
    /** Annualized performance as percentage */
    annualizedPerformancePercent: asNumber(summary.annualizedPerformancePercent) ?? 0,
    /** Current portfolio value in base currency */
    portfolio: asNumber(summary.currentValueInBaseCurrency) ?? 0,
    /** Total amount invested (cost basis) */
    totalInvestment: asNumber(summary.totalInvestment) ?? 0,
    /** Available cash */
    cash: asNumber(summary.cash) ?? 0,
    /** Dividend income */
    dividend: asNumber(summary.dividendInBaseCurrency) ?? 0,
    /** Fees paid */
    fees: asNumber(summary.fees) ?? 0
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

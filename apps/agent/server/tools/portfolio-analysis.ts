import { GhostfolioClient } from '../clients';
import { logger } from '../utils';
import { toToolErrorPayload } from './tool-error';

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
  try {
    const data = await client.getPortfolioPerformance({ impersonationId, range: 'max', token });
    logPortfolioPerformanceFetch(data);
    const generatedAt = new Date().toISOString();
    const normalized = normalizePerformancePayload(data);
    const dataAsOf = resolveDataAsOf({
      chart: data.chart,
      generatedAt
    });

    return {
      allocation: [],
      data_as_of: dataAsOf,
      performance: normalized,
      message,
      source: 'ghostfolio_api',
      sources: ['ghostfolio_api'],
      summary: 'Portfolio analysis from Ghostfolio performance data',
      data
    };
  } catch (error) {
    const toolError = toToolErrorPayload(error);
    return {
      success: false,
      answer: `Could not fetch portfolio details: ${toolError.message}`,
      summary: `Portfolio analysis failed: ${toolError.message}`,
      error: toolError,
      data_as_of: new Date().toISOString(),
      sources: ['ghostfolio_api']
    };
  }
}

function logPortfolioPerformanceFetch(data: Record<string, unknown>) {
  const performance = isObject(data.performance) ? data.performance : {};
  const payload = {
    location: 'portfolio-analysis.ts:portfolioAnalysisTool',
    message: 'fetched portfolio performance data',
    hasErrors: asBoolean(data.hasErrors),
    hasErrorsArray: Array.isArray(data.errors) ? data.errors.length : undefined,
    performance: {
      currentNetWorth: asNumber(performance.currentNetWorth),
      netPerformance: asNumber(performance.netPerformance),
      netPerformancePercentage: asNumber(performance.netPerformancePercentage)
    },
    timestamp: Date.now()
  };
  logger.debug('[agent-portfolio] fetched:', payload);
}

function normalizePerformancePayload(data: Record<string, unknown>) {
  const performance = isObject(data.performance) ? data.performance : {};
  return {
    currentNetWorth: asNumber(performance.currentNetWorth) ?? 0,
    netPerformance: asNumber(performance.netPerformance) ?? 0,
    netPerformancePercentage: asNumber(performance.netPerformancePercentage) ?? 0,
    totalValueInBaseCurrency: asNumber(performance.currentValueInBaseCurrency) ?? 0
  };
}

function resolveDataAsOf({
  chart,
  generatedAt
}: {
  chart: unknown;
  generatedAt: string;
}) {
  if (!Array.isArray(chart) || chart.length === 0) {
    return generatedAt;
  }

  const last = chart[chart.length - 1];
  if (!isObject(last)) {
    return generatedAt;
  }

  const date = asString(last.date);
  return date ? `${date}T00:00:00.000Z` : generatedAt;
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

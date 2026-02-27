import type { AgentFeedbackMemory, AgentToolName } from '../types';

export interface SynthesizerToolCall {
  toolName: AgentToolName;
}

/**
 * Purpose: Utility helpers for deterministic synthesis of tool results.
 * Inputs: allowlisted tool payload fields and user/tool context.
 * Outputs: formatted findings, summaries, and safe parsed values.
 * Failure modes: malformed payloads are ignored and yield conservative defaults.
 */

export function filterFindingsForUserIntent({
  findings,
  toolCalls,
  userMessage
}: {
  findings: string[];
  toolCalls: SynthesizerToolCall[];
  userMessage?: string;
}): string[] {
  if (!toolCalls.some((call) => isPortfolioLikeTool(call.toolName))) {
    return findings;
  }

  const normalized = (userMessage ?? '').toLowerCase();
  const asksForBalances =
    /\b(balance|balances|account|accounts|platform|cash|liquid)\b/.test(normalized);

  if (asksForBalances) {
    return findings;
  }

  return findings.filter(
    (line) => !line.startsWith('Account balances:') && !line.startsWith('Platform balances:')
  );
}

export function enrichNextStepsWithFeedback({
  feedbackMemory,
  fallbackSteps,
  nextSteps,
  toolCalls
}: {
  feedbackMemory?: AgentFeedbackMemory;
  fallbackSteps: string[];
  nextSteps: string[];
  toolCalls: SynthesizerToolCall[];
}): string[] {
  const steps = nextSteps.length > 0 ? [...new Set(nextSteps)] : fallbackSteps;
  if (!feedbackMemory) {
    return steps;
  }

  const memoryIntent = [...feedbackMemory.do, ...feedbackMemory.synthesisIssues]
    .join(' ')
    .toLowerCase();
  const requestsDetailedPlan = /\b(next step|next steps|actionable|plan)\b/.test(memoryIntent);
  if (!requestsDetailedPlan) {
    return steps;
  }

  if (toolCalls.some((call) => isPortfolioLikeTool(call.toolName))) {
    return addUniqueSteps(steps, [
      'Set explicit target allocation bands for each major position and cash.',
      'Define your rebalance trigger (time-based or threshold-based) and tax constraints.'
    ]);
  }

  if (toolCalls.some((call) => isMarketTool(call.toolName))) {
    return addUniqueSteps(steps, [
      'Write down entry/exit levels and the invalidation threshold before trading.',
      'Verify one independent data point (volume, catalyst, or macro event) before execution.'
    ]);
  }

  if (steps.length < 2) {
    steps.push('Translate this result into a clear do/not-do decision rule before acting.');
  }
  return [...new Set(steps)];
}

function addUniqueSteps(current: string[], additions: string[]): string[] {
  const next = [...current];
  if (next.length < 3) {
    next.push(...additions);
  }
  return [...new Set(next)];
}

function isMarketTool(toolName: AgentToolName): boolean {
  return toolName === 'market_data' || toolName === 'market_data_lookup';
}

export function buildDeterministicToolSummary({
  payload,
  rawPayload,
  toolName
}: {
  payload: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
  toolName: AgentToolName;
}) {
  if (isPortfolioLikeTool(toolName)) {
    const allocation = Array.isArray(payload.allocation) ? payload.allocation : [];
    const holdings = isObject(payload.holdings) ? payload.holdings : undefined;
    const count =
      allocation.length > 0
        ? allocation.length
        : holdings
          ? Object.keys(holdings).filter((symbol) => symbol !== 'USD').length
          : undefined;
    return count === undefined
      ? 'Portfolio analysis completed from structured portfolio payload.'
      : `Portfolio analysis completed for ${count} holding(s).`;
  }

  if (toolName === 'market_data') {
    const symbols = Array.isArray(payload.symbols) ? payload.symbols : [];
    return `Market data returned for ${symbols.length} symbol(s).`;
  }

  if (toolName === 'market_overview') {
    return 'Market overview returned sentiment snapshots for available asset classes.';
  }

  if (toolName === 'market_data_lookup') {
    const prices = Array.isArray(payload.prices) ? payload.prices : [];
    return `Market price lookup returned ${prices.length} price point(s).`;
  }

  if (toolName === 'transaction_categorize') {
    const patterns = isObject(payload.patterns) ? payload.patterns : undefined;
    const patternCount = numberOrUndefined(patterns?.totalTransactions);
    const categoryCount = sumCategoryCount(payload.categories);
    const total = patternCount ?? categoryCount;
    return total === undefined
      ? 'Transaction categorization completed from structured transaction payload.'
      : `Categorized ${total} transactions.`;
  }

  if (toolName === 'transaction_timeline') {
    const timeline = Array.isArray(payload.timeline) ? payload.timeline : [];
    return `Transaction timeline returned ${timeline.length} event(s).`;
  }

  if (toolName === 'compliance_check') {
    return 'Compliance check completed.';
  }

  if (toolName === 'fact_check') {
    const match = payload.match === true;
    return match
      ? 'Fact check completed; prices match between sources.'
      : 'Fact check completed; discrepancy reported between sources.';
  }

  if (toolName === 'fact_compliance_check') {
    return 'Fact + compliance check completed.';
  }

  return stringOrUndefined(rawPayload.summary) ?? stringOrUndefined(payload.summary);
}

export function extractComplianceFindings(payload: Record<string, unknown>): {
  violations: string[];
  warnings: string[];
} {
  const violations = normalizeComplianceItems(payload.violations, 'Violation');
  const warnings = normalizeComplianceItems(payload.warnings, 'Warning');

  return { violations, warnings };
}

function normalizeComplianceItems(items: unknown, label: 'Violation' | 'Warning'): string[] {
  if (!Array.isArray(items)) {
    return [];
  }

  const normalized: string[] = [];
  for (const item of items) {
    if (isObject(item)) {
      const ruleId = stringOrUndefined(item.rule_id) ?? 'unknown_rule';
      const message = stringOrUndefined(item.message) ?? 'No details provided.';
      normalized.push(`${label} (${ruleId}): ${message}`);
      continue;
    }
    if (typeof item === 'string' && item.trim().length > 0) {
      normalized.push(...normalizeComplianceTextItem(item, label));
    }
  }

  return normalized;
}

function normalizeComplianceTextItem(item: string, label: 'Violation' | 'Warning'): string[] {
  const parts = item
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  return parts.map((part) => {
    const match = /^([A-Z0-9-]{3,}):\s*(.+)$/.exec(part);
    if (match) {
      return `${label} (${match[1]}): ${match[2]}`;
    }
    return `${label} (unknown_rule): ${part}`;
  });
}

function sumCategoryCount(categories: unknown): number | undefined {
  if (!Array.isArray(categories)) {
    return undefined;
  }

  let total = 0;
  let hasValue = false;
  for (const item of categories) {
    if (!isObject(item)) continue;
    const count = numberOrUndefined(item.count);
    if (count === undefined) continue;
    total += count;
    hasValue = true;
  }

  return hasValue ? total : undefined;
}

export function enforceTransactionConsistency({
  categories,
  flags,
  keyFindings,
  patterns,
  risks
}: {
  categories: unknown;
  flags: string[];
  keyFindings: string[];
  patterns: unknown;
  risks: string[];
}) {
  const sellCount = resolveCategoryCount(categories, 'SELL');
  const patternObject = isObject(patterns) ? patterns : undefined;
  const ratio = numberOrUndefined(patternObject?.buySellRatio);

  if (sellCount > 0 && ratio === undefined) {
    flags.push('transaction_ratio_inconsistent');
    risks.push('Structured transaction payload has SELL transactions but no buy/sell ratio.');
  }

  if (sellCount > 0) {
    for (let i = 0; i < keyFindings.length; i++) {
      keyFindings[i] = keyFindings[i].replace(/buy\/sell ratio unavailable[^,.]*/gi, '').trim();
    }
  }
}

function resolveCategoryCount(categories: unknown, type: string): number {
  if (!Array.isArray(categories)) {
    return 0;
  }

  for (const item of categories) {
    if (!isObject(item)) continue;
    const category = stringOrUndefined(item.category);
    if (category !== type) continue;
    const count = numberOrUndefined(item.count);
    return count ?? 0;
  }

  return 0;
}

export function hasProvenance(payload: Record<string, unknown>) {
  const sources = payload.sources;
  const source = payload.source;
  const dataAsOf = payload.data_as_of;

  const hasSources =
    (Array.isArray(sources) && sources.length > 0) || typeof source === 'string';

  return hasSources && typeof dataAsOf === 'string';
}

export function unwrapToolPayload(payload: Record<string, unknown>) {
  const nestedData = payload.data;
  if (!isObject(nestedData)) {
    return payload;
  }

  const topLevelPerformance = payload.performance;
  const unwrapped = {
    ...payload,
    ...nestedData
  };
  // Prefer top-level normalized performance (e.g. portfolio_analysis returns performance.portfolio, .balance)
  // over data.performance (raw API: currentNetWorth, currentValueInBaseCurrency) so synthesis uses the right numbers.
  if (isObject(topLevelPerformance)) {
    unwrapped.performance = topLevelPerformance;
  }
  return unwrapped;
}

export function extractBalanceAndCashFindings(payload: Record<string, unknown>): string[] {
  const summaryFindings = extractSummaryBalanceFindings(payload.summary);
  const performanceFindings = extractSummaryBalanceFindings(payload.performance);
  const mergedBalanceFindings = [...new Set([...summaryFindings, ...performanceFindings])];
  return [
    ...mergedBalanceFindings,
    ...extractAccountBalances(payload.accounts),
    ...extractPlatformBalances(payload.platforms)
  ];
}

function extractSummaryBalanceFindings(summary: unknown): string[] {
  if (!isObject(summary)) {
    return [];
  }

  const findings: string[] = [];
  const cash = numberOrUndefined(summary.cash);
  const portfolioValue =
    numberOrUndefined(summary.portfolio) ?? numberOrUndefined(summary.totalValueInBaseCurrency);
  const balanceValue =
    numberOrUndefined(summary.balance) ?? numberOrUndefined(summary.currentNetWorth);
  if (cash !== undefined && Number.isFinite(cash)) {
    findings.push(`Cash (USD): ${roundToTwo(cash)}.`);
  }
  if (portfolioValue !== undefined && Number.isFinite(portfolioValue)) {
    findings.push(`Portfolio balance: ${roundToTwo(portfolioValue)}.`);
    const holdingsOnly =
      cash !== undefined && Number.isFinite(cash) ? portfolioValue - cash : portfolioValue;
    findings.push(
      `Holdings value (investments only, excluding cash): ${roundToTwo(holdingsOnly)}.`
    );
    findings.push(`Total value (holdings + cash): ${roundToTwo(portfolioValue)}.`);
  }
  // When we have portfolio value, do not add Balance—use Portfolio balance only so the answer uses the portfolio number.
  // Only add Balance when there is no portfolio value (e.g. holdings summary with different shape).
  if (
    balanceValue !== undefined &&
    Number.isFinite(balanceValue) &&
    portfolioValue === undefined
  ) {
    findings.push(`Balance (net worth): ${roundToTwo(balanceValue)}.`);
  }
  return findings;
}

function extractAccountBalances(accounts: unknown): string[] {
  if (!isObject(accounts)) {
    return [];
  }

  const entries = Object.entries(accounts)
    .map(([, acc]) => {
      if (!isObject(acc)) return undefined;
      const name = stringOrUndefined(acc.name) ?? 'Account';
      const balance = numberOrUndefined(acc.balance);
      const currency = stringOrUndefined(acc.currency) ?? '';
      const valueInBase = numberOrUndefined(acc.valueInBaseCurrency);
      if (balance === undefined || !Number.isFinite(balance)) {
        return undefined;
      }
      const baseSegment =
        valueInBase !== undefined && Number.isFinite(valueInBase)
          ? ` (${roundToTwo(valueInBase)} base)`
          : '';
      return `${name}: balance ${roundToTwo(balance)} ${currency}${baseSegment}`;
    })
    .filter((s): s is string => Boolean(s));

  return entries.length > 0 ? [`Account balances: ${entries.join('; ')}.`] : [];
}

function extractPlatformBalances(platforms: unknown): string[] {
  if (!isObject(platforms)) {
    return [];
  }

  const entries = Object.entries(platforms)
    .map(([, p]) => {
      if (!isObject(p)) return undefined;
      const name = stringOrUndefined(p.name) ?? 'Platform';
      const balance = numberOrUndefined(p.balance);
      const currency = stringOrUndefined(p.currency) ?? '';
      if (balance === undefined || !Number.isFinite(balance)) {
        return undefined;
      }
      return `${name}: ${roundToTwo(balance)} ${currency}`;
    })
    .filter((s): s is string => Boolean(s));

  return entries.length > 0 ? [`Platform balances: ${entries.join('; ')}.`] : [];
}

export function extractTopAllocation(payload: Record<string, unknown>) {
  const normalized = extractAllocationFromArray(payload.allocation);
  if (normalized.length > 0) {
    return normalized;
  }

  return extractAllocationFromHoldings(payload.holdings);
}

function extractAllocationFromArray(allocation: unknown) {
  if (!Array.isArray(allocation)) {
    return [];
  }

  return allocation
    .slice(0, 3)
    .map((item) => {
      if (!isObject(item)) {
        return undefined;
      }

      const symbol = stringOrUndefined(item.symbol) ?? 'unknown';
      if (isCashSymbol(symbol)) {
        return undefined;
      }
      const percentage = numberOrUndefined(item.percentage);
      return percentage === undefined ? symbol : `${symbol} ${percentage}%`;
    })
    .filter((item): item is string => Boolean(item));
}

function extractAllocationFromHoldings(holdings: unknown) {
  if (!isObject(holdings)) {
    return [];
  }

  return Object.values(holdings)
    .filter(isObject)
    .map((holding) => {
      const symbol = stringOrUndefined(holding.symbol) ?? 'unknown';
      if (isCashSymbol(symbol)) {
        return undefined;
      }
      const allocationShare = numberOrUndefined(holding.allocationInPercentage);
      const percentage =
        allocationShare === undefined ? undefined : roundToTwo(allocationShare * 100);
      return percentage === undefined ? undefined : { percentage, symbol };
    })
    .filter((item): item is { percentage: number; symbol: string } => Boolean(item))
    .sort((a, b) => b.percentage - a.percentage)
    .slice(0, 3)
    .map(({ percentage, symbol }) => `${symbol} ${percentage}%`);
}

export function extractPerformanceFindings(payload: Record<string, unknown>) {
  const findings: string[] = [];
  const performanceSource = resolvePerformanceSource(payload);

  if (!performanceSource) {
    return findings;
  }

  const netPerformance = numberOrUndefined(performanceSource.netPerformance);
  if (netPerformance !== undefined) {
    findings.push(`Net performance: ${roundToTwo(netPerformance)}.`);
    findings.push(
      'Net performance is your gain/loss versus invested cost basis (positive = profit, negative = loss).'
    );
    if (netPerformance > 0) {
      findings.push('Portfolio status: in profit.');
    } else if (netPerformance < 0) {
      findings.push('Portfolio status: in loss.');
    } else {
      findings.push('Portfolio status: break-even.');
    }
  }

  const netPerformancePercentage = numberOrUndefined(
    performanceSource.netPerformancePercentage
  );
  if (netPerformancePercentage !== undefined) {
    findings.push(`Net performance %: ${roundToTwo(netPerformancePercentage * 100)}%.`);
  }

  return findings;
}

function resolvePerformanceSource(payload: Record<string, unknown>) {
  const performance = payload.performance;
  if (isObject(performance)) {
    return performance;
  }

  const summary = payload.summary;
  if (isObject(summary)) {
    return summary;
  }

  return undefined;
}

export function extractPortfolioEvolutionFindings(payload: Record<string, unknown>) {
  const rows = normalizeChartRows(payload.chart);
  if (rows.length < 2) {
    return [];
  }

  const drawdown = computeMaxDrawdown(rows);
  const latest = rows[rows.length - 1];
  const findings = [
    `Portfolio evolution: peak net worth ${roundToTwo(drawdown.peak.netWorth)} on ${drawdown.peak.date}.`
  ];

  if (drawdown.maxDrawdown < 0) {
    findings.push(
      `Max drawdown: ${roundToTwo(drawdown.maxDrawdown * 100)}% (from ${drawdown.peak.date} to ${drawdown.trough.date}).`
    );
    if (latest.netWorth > drawdown.trough.netWorth && drawdown.trough.netWorth > 0) {
      const recovery = (latest.netWorth / drawdown.trough.netWorth - 1) * 100;
      findings.push(`Recovery from drawdown low: +${roundToTwo(recovery)}%.`);
    }
  }

  return findings;
}

function normalizeChartRows(chart: unknown): { date: string; netWorth: number }[] {
  if (!Array.isArray(chart)) {
    return [];
  }

  return chart
    .map((item) => {
      if (!isObject(item)) return undefined;
      const date = stringOrUndefined(item.date);
      const netWorth =
        numberOrUndefined(item.netWorth) ??
        numberOrUndefined(item.valueWithCurrencyEffect) ??
        numberOrUndefined(item.value);
      if (!date || netWorth === undefined || !Number.isFinite(netWorth)) {
        return undefined;
      }
      return { date, netWorth };
    })
    .filter((item): item is { date: string; netWorth: number } => Boolean(item));
}

function computeMaxDrawdown(rows: { date: string; netWorth: number }[]) {
  let peak = rows[0];
  let trough = rows[0];
  let maxDrawdown = 0;

  for (const row of rows) {
    if (row.netWorth > peak.netWorth) {
      peak = row;
      trough = row;
      continue;
    }
    if (row.netWorth >= trough.netWorth) {
      continue;
    }
    trough = row;
    const drawdown = peak.netWorth > 0 ? row.netWorth / peak.netWorth - 1 : 0;
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return { maxDrawdown, peak, trough };
}

export function extractHoldingPerformerFindings(payload: Record<string, unknown>) {
  const holdings = payload.holdings;
  if (!isObject(holdings)) {
    return [];
  }

  const ranked = Object.values(holdings)
    .filter(isObject)
    .map((holding) => {
      const symbol = stringOrUndefined(holding.symbol) ?? 'unknown';
      if (isCashSymbol(symbol)) {
        return undefined;
      }
      const pct =
        numberOrUndefined(holding.netPerformancePercent) ??
        numberOrUndefined(holding.netPerformancePercentWithCurrencyEffect);
      if (pct === undefined || !Number.isFinite(pct)) {
        return undefined;
      }
      return { pct, symbol };
    })
    .filter((item): item is { pct: number; symbol: string } => Boolean(item));

  if (ranked.length === 0) {
    return [];
  }

  const top = [...ranked]
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3)
    .map((item) => `${item.symbol} ${formatSignedPercent(item.pct * 100)}`);
  const bottom = [...ranked]
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 3)
    .map((item) => `${item.symbol} ${formatSignedPercent(item.pct * 100)}`);

  const findings: string[] = [];
  if (top.length > 0) {
    findings.push(`Top performers: ${top.join(', ')}.`);
  }
  if (bottom.length > 0) {
    findings.push(`Bottom performers: ${bottom.join(', ')}.`);
  }
  return findings;
}

export function roundToTwo(value: number) {
  return Math.round(value * 100) / 100;
}

export function formatSignedPercent(value: number) {
  const rounded = roundToTwo(value);
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

export function isPortfolioLikeTool(toolName: AgentToolName): boolean {
  return (
    toolName === 'portfolio_analysis' ||
    toolName === 'holdings_analysis' ||
    toolName === 'static_analysis'
  );
}

export function isCashSymbol(symbol: string): boolean {
  return symbol.toUpperCase() === 'USD';
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function stringOrUndefined(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

export function numberOrUndefined(value: unknown) {
  return typeof value === 'number' ? value : undefined;
}

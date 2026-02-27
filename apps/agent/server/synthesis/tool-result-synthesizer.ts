import { logger } from '../utils';
import type { AgentFeedbackMemory, AgentToolName } from '../types';
import {
  buildDeterministicToolSummary,
  enforceTransactionConsistency,
  enrichNextStepsWithFeedback,
  extractBalanceAndCashFindings,
  extractComplianceFindings,
  extractHoldingPerformerFindings,
  extractPerformanceFindings,
  extractPortfolioEvolutionFindings,
  extractTopAllocation,
  filterFindingsForUserIntent,
  hasProvenance,
  isObject,
  isPortfolioLikeTool,
  numberOrUndefined,
  stringOrUndefined,
  unwrapToolPayload
} from './tool-result-synthesizer-helpers';
import {
  buildDirectAnswer,
  formatDataAsOfLines,
  pruneContradictoryHoldingsFindings,
  shouldIncludeDataFreshnessSection
} from './tool-result-rendering';

export interface ToolExecutionResult {
  result: Record<string, unknown>;
  success: boolean;
  toolName: AgentToolName;
}

/**
 * Purpose: Build a coherent finance response from allowlisted tool payload fields.
 * Inputs: executed tool results and accumulated verification flags.
 * Outputs: structured natural-language synthesis and extra validation flags.
 * Failure modes: missing payload fields return conservative fallback text and flags.
 */
export function synthesizeToolResults({
  feedbackMemory,
  existingFlags,
  userMessage,
  toolCalls
}: {
  feedbackMemory?: AgentFeedbackMemory;
  existingFlags: string[];
  userMessage?: string;
  toolCalls: ToolExecutionResult[];
}) {
  logger.debug('[agent.synthesize_tool_results] INPUT', {
    existingFlags,
    hasFeedbackMemory: Boolean(feedbackMemory),
    toolCallCount: toolCalls.length,
    toolNames: toolCalls.map((c) => c.toolName),
    successCount: toolCalls.filter((c) => c.success).length
  });

  const summaryParts: string[] = [];
  const keyFindings: string[] = [];
  const risks: string[] = [];
  const nextSteps: string[] = [];
  const dataAsOfValues: string[] = [];
  const missingDataPoints: string[] = [];
  const transactionListLines: string[] = [];
  const toolErrors: { toolName: AgentToolName; message: string }[] = [];
  const flags = [...existingFlags];

  for (const call of toolCalls) {
    if (!call.success) {
      // Extract error message with fallback chain
      let errorMessage: string;

      if (typeof call.result?.errorMessage === 'string' && call.result.errorMessage.trim()) {
        errorMessage = call.result.errorMessage.trim();
      } else if (typeof call.result?.reason === 'string' && call.result.reason.trim()) {
        errorMessage = `Tool ${call.toolName} returned: ${call.result.reason.trim()}`;
      } else if (typeof call.result?.error === 'string' && call.result.error.trim()) {
        errorMessage = `Tool ${call.toolName} returned: ${call.result.error.trim()}`;
      } else if (isObject(call.result?.error) && typeof call.result.error.message === 'string') {
        errorMessage = `Tool ${call.toolName} returned: ${call.result.error.message.trim()}`;
      } else {
        errorMessage = `Tool ${call.toolName} failed; results may be incomplete.`;
      }

      logger.debug('[agent.synthesize_tool_results] TOOL_FAILURE', {
        toolName: call.toolName,
        errorMessage: errorMessage.slice(0, 200)
      });

      flags.push('tool_failure');
      toolErrors.push({ toolName: call.toolName, message: errorMessage });
      continue;
    }

    const rawPayload = isObject(call.result) ? call.result : {};
    const payload = unwrapToolPayload(rawPayload);
    collectPrimarySummary({ payload, rawPayload, toolName: call.toolName, summaryParts, risks, flags });
    collectProvenanceAndMetadata({ payload, dataAsOfValues, flags, missingDataPoints, risks });

    if (isPortfolioLikeTool(call.toolName)) {
      collectPortfolioFindings({
        flags,
        keyFindings,
        nextSteps,
        payload,
        rawPayload,
        toolName: call.toolName
      });
    } else if (call.toolName === 'market_data') {
      collectMarketDataFindings({ keyFindings, nextSteps, payload });
    } else if (call.toolName === 'market_overview') {
      collectMarketOverviewFindings({ keyFindings, nextSteps, payload });
    } else if (call.toolName === 'market_data_lookup') {
      collectMarketLookupFindings({ keyFindings, nextSteps, payload });
    } else if (call.toolName === 'analyze_stock_trend') {
      collectAnalyzeStockTrendFindings({ keyFindings, nextSteps, payload, rawPayload });
    } else if (call.toolName === 'transaction_categorize') {
      collectTransactionCategorizationFindings({
        flags,
        keyFindings,
        nextSteps,
        payload,
        risks
      });
    } else if (call.toolName === 'transaction_timeline') {
      collectTransactionTimelineFindings({
        keyFindings,
        nextSteps,
        payload,
        transactionListLines
      });
    } else if (call.toolName === 'compliance_check') {
      collectComplianceFindings({ keyFindings, nextSteps, payload, risks });
    } else if (call.toolName === 'fact_compliance_check') {
      const factPayload = isObject(payload.fact_check) ? payload.fact_check : {};
      const compliancePayload = isObject(payload.compliance_check) ? payload.compliance_check : {};
      const factAnswer = typeof factPayload.answer === 'string' ? factPayload.answer : '';
      if (factAnswer) keyFindings.push(factAnswer);
      if (factPayload.match === false) {
        risks.push('Fact check reported a price discrepancy between Ghostfolio and second source.');
      }
      collectComplianceFindings({
        keyFindings,
        nextSteps,
        payload: compliancePayload,
        risks
      });
      const hasExcerptWarning = [...(Array.isArray(compliancePayload.warnings) ? compliancePayload.warnings : []), ...(Array.isArray(compliancePayload.violations) ? compliancePayload.violations : [])]
        .some(
          (item) =>
            isObject(item) &&
            isObject(item.regulation_excerpt) &&
            typeof item.regulation_excerpt.excerpt === 'string'
        );
      if (hasExcerptWarning) {
        keyFindings.push('At least one compliance finding has a regulation excerpt available from the regulation bank.');
      }
    } else if (call.toolName === 'fact_check') {
      const answer = typeof payload.answer === 'string' ? payload.answer : '';
      if (answer) keyFindings.push(answer);
      if (payload.match === false) {
        risks.push('Fact check reported a price discrepancy between Ghostfolio and second source.');
      }
    }
  }

  const dedupedFlags = [...new Set(flags)];
  if (toolErrors.length > 0) {
    risks.push('One or more tool calls failed. See Tool errors for details.');
  }
  const summary = summaryParts.length > 0 ? summaryParts.join(' | ') : 'No reliable tool summary available.';
  const findings = filterFindingsForUserIntent({
    findings: keyFindings.length > 0 ? keyFindings : ['No material findings from the returned tool payload.'],
    toolCalls,
    userMessage
  });
  const dedupedFindings = pruneContradictoryHoldingsFindings([...new Set(findings)]);
  const riskLines = risks.length > 0 ? risks : ['No critical risks flagged by current checks.'];
  const directAnswer = buildDirectAnswer({
    findings: dedupedFindings,
    riskLines,
    userMessage
  });
  const hasNoHoldingsFinding = dedupedFindings.some((line) =>
    line.includes('No holdings found in portfolio.')
  );
  const steps = enrichNextStepsWithFeedback({
    feedbackMemory,
    fallbackSteps: hasNoHoldingsFinding
      ? []
      : ['Provide more detail to refine analysis.'],
    nextSteps,
    toolCalls
  });
  const freshestDataAsOf =
    dataAsOfValues.length > 0
      ? [...new Set(dataAsOfValues)].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))[0]
      : undefined;
  const missingDataLine =
    missingDataPoints.length > 0 ? [...new Set(missingDataPoints)].join(' | ') : 'None.';
  const dataAsOfLines = formatDataAsOfLines(freshestDataAsOf);
  const includeDataFreshnessSection = shouldIncludeDataFreshnessSection(freshestDataAsOf);

  const sections: string[] = [];
  if (directAnswer) {
    sections.push(`Answer: ${directAnswer}`, '');
  }
  sections.push(
    `Summary: ${summary}`,
    '',
    'Key findings:',
    ...dedupedFindings.map((line) => `- ${line}`)
  );

  if (includeDataFreshnessSection) {
    sections.push(
      '',
      'Data as of:',
      ...dataAsOfLines.map((line) => `- ${line}`),
      `Missing data: ${missingDataLine}`
    );
  }

  if (!hasNoHoldingsFinding) {
    sections.push(
      '',
      'Risks/flags:',
      ...riskLines.map((line) => `- ${line}`)
    );
  }

  if (toolErrors.length > 0) {
    sections.push(
      '',
      'Tool errors (ground your answer in these, do not speculate about portfolio state):',
      ...toolErrors.map((error) => `- ${error.toolName}: ${error.message}`)
    );
  }

  if (steps.length > 0) {
    sections.push(
      '',
      'Actionable next steps:',
      ...steps.map((line) => `- ${line}`)
    );
  }

  if (transactionListLines.length > 0) {
    sections.push(
      '',
      'Transaction list (date | symbol | type | quantity | unitPrice — include in your answer only rows that match the user\'s requested time period):',
      ...transactionListLines
    );
  }

  const answer = sections.join('\n');
  logger.debug('[agent.synthesize_tool_results] OUTPUT', {
    answerLength: answer.length,
    answerPreview: answer.slice(0, 500) + (answer.length > 500 ? '...' : ''),
    flags: dedupedFlags,
    transactionListLineCount: transactionListLines.length
  });

  return {
    answer,
    flags: dedupedFlags
  };
}


function collectPrimarySummary({
  payload,
  rawPayload,
  toolName,
  summaryParts,
  risks,
  flags
}: {
  payload: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
  toolName: AgentToolName;
  summaryParts: string[];
  risks: string[];
  flags: string[];
}) {
  const primarySummary = buildDeterministicToolSummary({ payload, rawPayload, toolName });
  if (primarySummary) {
    summaryParts.push(primarySummary);
    return;
  }
  risks.push(`Tool ${toolName} returned no summary.`);
  flags.push('incomplete_tool_payload');
}

function collectProvenanceAndMetadata({
  payload,
  dataAsOfValues,
  flags,
  missingDataPoints,
  risks
}: {
  payload: Record<string, unknown>;
  dataAsOfValues: string[];
  flags: string[];
  missingDataPoints: string[];
  risks: string[];
}) {
  if (!hasProvenance(payload)) {
    risks.push('Tool is missing provenance fields (sources, data_as_of).');
    flags.push('missing_provenance');
  }

  const dataAsOf = stringOrUndefined(payload.data_as_of);
  if (dataAsOf) {
    dataAsOfValues.push(dataAsOf);
  }

  const missingData = payload.missing_data;
  if (!Array.isArray(missingData)) {
    return;
  }
  for (const item of missingData) {
    if (typeof item === 'string' && item.trim().length > 0) {
      missingDataPoints.push(item.trim());
    }
  }
}

function collectPortfolioFindings({
  flags,
  keyFindings,
  nextSteps,
  payload,
  rawPayload,
  toolName
}: {
  flags: string[];
  keyFindings: string[];
  nextSteps: string[];
  payload: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
  toolName: AgentToolName;
}) {
  if (rawPayload.usd_removed_from_holdings === true) {
    flags.push('USD_SHOULD_BE_CASH_NOT_HOLDING');
  }

  if (toolName === 'holdings_analysis' && getNonCashHoldingState(payload) === 'empty') {
    keyFindings.push('No holdings found in portfolio.');
    return;
  }

  const topAllocation = extractTopAllocation(payload);
  keyFindings.push(...extractBalanceAndCashFindings(payload));
  if (topAllocation.length > 0) {
    keyFindings.push(`Top allocation: ${topAllocation.join(', ')}.`);
  }

  keyFindings.push(...extractPerformanceFindings(payload));
  keyFindings.push(...extractPortfolioEvolutionFindings(payload));
  keyFindings.push(...extractHoldingPerformerFindings(payload));
  nextSteps.push('Review position sizing against your target allocation and rebalance if needed.');
}

function getNonCashHoldingState(
  payload: Record<string, unknown>
): 'empty' | 'has_holdings' | 'unknown' {
  let sawExplicitStructure = false;
  const allocation = payload.allocation;
  if (Array.isArray(allocation)) {
    sawExplicitStructure = true;
    const nonCashAllocation = allocation.some((item) => {
      if (!isObject(item)) return false;
      const symbol = stringOrUndefined(item.symbol);
      const percentage = numberOrUndefined(item.percentage);
      if (!symbol || isCashSymbol(symbol)) return false;
      return percentage === undefined || percentage > 0;
    });
    if (nonCashAllocation) return 'has_holdings';
  }

  const holdings = payload.holdings;
  if (isObject(holdings)) {
    sawExplicitStructure = true;
    const hasFromHoldings = Object.values(holdings).some((item) => {
      if (!isObject(item)) return false;
      const symbol = stringOrUndefined(item.symbol);
      if (!symbol || isCashSymbol(symbol)) return false;
      const allocationShare = numberOrUndefined(item.allocationInPercentage);
      const quantity = numberOrUndefined(item.quantity);
      return (
        (allocationShare !== undefined && allocationShare > 0) ||
        (quantity !== undefined && quantity > 0)
      );
    });
    if (hasFromHoldings) return 'has_holdings';
  }

  return sawExplicitStructure ? 'empty' : 'unknown';
}

function isCashSymbol(symbol: string): boolean {
  const normalized = symbol.trim().toUpperCase();
  return normalized === 'USD' || normalized === 'CASH';
}

function collectMarketDataFindings({
  keyFindings,
  nextSteps,
  payload
}: {
  keyFindings: string[];
  nextSteps: string[];
  payload: Record<string, unknown>;
}) {
  const symbols = payload.symbols;
  if (Array.isArray(symbols) && symbols.length > 0) {
    const entries = symbols
      .slice(0, 5)
      .map((item) => formatMarketEntry(item))
      .filter((s): s is string => Boolean(s));
    if (entries.length > 0) {
      keyFindings.push(`Market data: ${entries.join('; ')}.`);
    }
  }
  nextSteps.push('Confirm price moves with your watchlist thresholds before trading.');
}

function formatMarketEntry(item: unknown): string | undefined {
  if (!isObject(item)) return undefined;
  const sym = stringOrUndefined(item.symbol) ?? 'unknown';
  const err =
    stringOrUndefined(item.error) ??
    (isObject(item.error) ? stringOrUndefined(item.error.message) : undefined);
  if (err) return `${sym}: ${err}`;
  const price = numberOrUndefined(item.currentPrice);
  const currency = stringOrUndefined(item.currency) ?? '';
  if (price === undefined) return undefined;
  const pct5d = numberOrUndefined(item.changePercent5d);
  const pct1w = numberOrUndefined(item.changePercent1w);
  const pct1m = numberOrUndefined(item.changePercent1m);
  const pct1y = numberOrUndefined(item.changePercent1y);
  if (pct5d !== undefined) return `${sym}: ${currency} ${price} (${withSign(pct5d)}% vs 5d ago)`;
  if (pct1w !== undefined) return `${sym}: ${currency} ${price} (${withSign(pct1w)}% vs 1w ago)`;
  if (pct1y !== undefined) return `${sym}: ${currency} ${price} (${withSign(pct1y)}% vs 1y ago)`;
  if (pct1m !== undefined) return `${sym}: ${currency} ${price} (${withSign(pct1m)}% vs 1m ago)`;
  return `${sym}: ${currency} ${price}`;
}

function withSign(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}`;
}

function collectMarketOverviewFindings({
  keyFindings,
  nextSteps,
  payload
}: {
  keyFindings: string[];
  nextSteps: string[];
  payload: Record<string, unknown>;
}) {
  const overview = payload.overview;
  if (isObject(overview)) {
    const stocks = isObject(overview.stocks) ? overview.stocks : undefined;
    const crypto = isObject(overview.cryptocurrencies) ? overview.cryptocurrencies : undefined;
    const parts: string[] = [];
    pushSentimentPart(parts, 'Stocks', stocks);
    pushSentimentPart(parts, 'Crypto', crypto);
    if (parts.length > 0) {
      keyFindings.push(`Market overview: ${parts.join('; ')}.`);
    }
  }
  nextSteps.push('Use sentiment as context only; confirm trend with price and breadth data.');
}

function pushSentimentPart(
  parts: string[],
  labelPrefix: 'Stocks' | 'Crypto',
  entry: Record<string, unknown> | undefined
) {
  if (!entry) return;
  const label = stringOrUndefined(entry.label);
  const value = numberOrUndefined(entry.value);
  if (!label && value === undefined) return;
  parts.push(`${labelPrefix} sentiment: ${label ?? 'unknown'}${value !== undefined ? ` (${value})` : ''}`);
}

function collectMarketLookupFindings({
  keyFindings,
  nextSteps,
  payload
}: {
  keyFindings: string[];
  nextSteps: string[];
  payload: Record<string, unknown>;
}) {
  const prices = payload.prices;
  if (Array.isArray(prices) && prices.length > 0) {
    const entries = prices
      .slice(0, 3)
      .map((item) => {
        if (!isObject(item)) return undefined;
        const symbol = stringOrUndefined(item.symbol) ?? 'unknown';
        const value = numberOrUndefined(item.value);
        return value === undefined ? symbol : `${symbol} ${value}`;
      })
      .filter((item): item is string => Boolean(item));
    if (entries.length > 0) {
      keyFindings.push(`Latest prices: ${entries.join(', ')}.`);
    }
  }
  nextSteps.push('Confirm price moves with your watchlist thresholds before trading.');
}

function collectAnalyzeStockTrendFindings({
  keyFindings,
  nextSteps,
  payload,
  rawPayload
}: {
  keyFindings: string[];
  nextSteps: string[];
  payload: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
}) {
  const answer = stringOrUndefined(payload.answer) ?? stringOrUndefined(rawPayload.answer);
  if (answer) {
    keyFindings.push(answer);
  } else {
    const trend = isObject(payload.trend) ? payload.trend : undefined;
    if (trend) {
      const currentPrice = numberOrUndefined(trend.currentPrice);
      const periodChange = numberOrUndefined(trend.periodChange);
      const periodChangePercent = numberOrUndefined(trend.periodChangePercent);
      const windowHigh = numberOrUndefined(trend.windowHigh);
      const windowLow = numberOrUndefined(trend.windowLow);
      const trendParts: string[] = [];
      if (currentPrice !== undefined) trendParts.push(`Current price: ${currentPrice}`);
      if (periodChange !== undefined && periodChangePercent !== undefined) {
        const signedChange = periodChange > 0 ? `+${periodChange}` : `${periodChange}`;
        const signedPct = periodChangePercent > 0 ? `+${periodChangePercent}` : `${periodChangePercent}`;
        trendParts.push(`Period change: ${signedChange} (${signedPct}%)`);
      }
      if (windowHigh !== undefined && windowLow !== undefined) {
        trendParts.push(`Window high/low: ${windowHigh} / ${windowLow}`);
      }
      if (trendParts.length > 0) {
        keyFindings.push(`Trend: ${trendParts.join('. ')}.`);
      }
    }
  }

  nextSteps.push('Compare this trend window to your entry thesis before changing position size.');
}

function collectTransactionCategorizationFindings({
  flags,
  keyFindings,
  nextSteps,
  payload,
  risks
}: {
  flags: string[];
  keyFindings: string[];
  nextSteps: string[];
  payload: Record<string, unknown>;
  risks: string[];
}) {
  const categories = payload.categories;
  if (Array.isArray(categories) && categories.length > 0) {
    const entries = categories
      .slice(0, 3)
      .map((item) => {
        if (!isObject(item)) return undefined;
        const category = stringOrUndefined(item.category) ?? 'unknown';
        const count = numberOrUndefined(item.count);
        return count === undefined ? category : `${category} (${count})`;
      })
      .filter((item): item is string => Boolean(item));
    if (entries.length > 0) {
      keyFindings.push(`Transaction categories: ${entries.join(', ')}.`);
    }
  }

  const patternLine = formatTransactionPatternLine(payload.patterns);
  if (patternLine) {
    keyFindings.push(patternLine);
  }

  nextSteps.push('Validate uncategorized transactions and update category rules.');
  enforceTransactionConsistency({
    categories: payload.categories,
    flags,
    keyFindings,
    patterns: payload.patterns,
    risks
  });
}

function formatTransactionPatternLine(patterns: unknown): string | undefined {
  const patternObject = isObject(patterns) ? patterns : undefined;
  if (!patternObject) return undefined;
  const parts: string[] = [];
  const buySellRatio = numberOrUndefined(patternObject.buySellRatio);
  if (buySellRatio !== undefined) parts.push(`buy/sell ratio ${buySellRatio}`);
  const activityTrend = numberOrUndefined(patternObject.activityTrend30dVsPrev30dPercent);
  if (activityTrend !== undefined) parts.push(`30d activity trend ${activityTrend}%`);
  const topSymbol = isObject(patternObject.topSymbolByCount) ? patternObject.topSymbolByCount : undefined;
  const topSymbolName = stringOrUndefined(topSymbol?.symbol);
  const topSymbolShare = numberOrUndefined(topSymbol?.sharePercent);
  if (topSymbolName) {
    parts.push(`top symbol ${topSymbolName}${topSymbolShare !== undefined ? ` (${topSymbolShare}%)` : ''}`);
  }
  return parts.length > 0 ? `Transaction patterns: ${parts.join(', ')}.` : undefined;
}

function collectTransactionTimelineFindings({
  keyFindings,
  nextSteps,
  payload,
  transactionListLines
}: {
  keyFindings: string[];
  nextSteps: string[];
  payload: Record<string, unknown>;
  transactionListLines: string[];
}) {
  const timeline = payload.timeline;
  if (Array.isArray(timeline) && timeline.length > 0) {
    const entries = timeline
      .slice(0, 3)
      .map((item) => formatTimelineSummaryLine(item))
      .filter((item): item is string => Boolean(item));
    if (entries.length > 0) {
      keyFindings.push(`Transaction timeline: ${entries.join(', ')}.`);
    }
    for (const item of timeline) {
      const fullLine = formatTimelineFullLine(item);
      if (fullLine) {
        transactionListLines.push(fullLine);
      }
    }
  }
  nextSteps.push('Compare entry prices to current market prices before your next rebalance.');
}

function formatTimelineSummaryLine(item: unknown): string | undefined {
  if (!isObject(item)) return undefined;
  const symbol = stringOrUndefined(item.symbol) ?? 'unknown';
  const type = stringOrUndefined(item.type) ?? 'UNKNOWN';
  const date = stringOrUndefined(item.date) ?? 'unknown-date';
  const unitPrice = numberOrUndefined(item.unitPrice);
  return unitPrice === undefined
    ? `${symbol} ${type} on ${date}`
    : `${symbol} ${type} on ${date} at ${unitPrice}`;
}

function formatTimelineFullLine(item: unknown): string | undefined {
  if (!isObject(item)) return undefined;
  const date = stringOrUndefined(item.date) ?? '';
  const symbol = stringOrUndefined(item.symbol) ?? 'unknown';
  const type = stringOrUndefined(item.type) ?? 'UNKNOWN';
  const qty = numberOrUndefined(item.quantity);
  const unitPrice = numberOrUndefined(item.unitPrice);
  const qtyStr = qty !== undefined ? String(qty) : '';
  const priceStr = unitPrice !== undefined ? String(unitPrice) : '';
  return `${date} | ${symbol} | ${type} | ${qtyStr} | ${priceStr}`;
}

function collectComplianceFindings({
  keyFindings,
  nextSteps,
  payload,
  risks
}: {
  keyFindings: string[];
  nextSteps: string[];
  payload: Record<string, unknown>;
  risks: string[];
}) {
  const complianceFindings = extractComplianceFindings(payload);
  const blockingCount = complianceFindings.violations.length;
  if (blockingCount > 0) {
    keyFindings.push(
      `No, you should not proceed yet because compliance check found ${blockingCount} blocking violation(s).`
    );
  } else {
    keyFindings.push(
      'Yes, there are no blocking compliance violations based on the available policy checks.'
    );
  }
  keyFindings.push(
    `Compliance check: ${blockingCount} violation(s), ${complianceFindings.warnings.length} warning(s).`
  );
  risks.push(...complianceFindings.violations, ...complianceFindings.warnings);
  nextSteps.push(
    complianceFindings.violations.length > 0
      ? 'Resolve compliance violations before executing this trade.'
      : 'No blocking compliance issues found; validate assumptions before execution.'
  );
}

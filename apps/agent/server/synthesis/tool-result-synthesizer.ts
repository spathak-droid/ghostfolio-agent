import { AgentToolName } from '../types';
import { logger } from '../logger';

export interface ToolExecutionResult {
  result: Record<string, unknown>;
  success: boolean;
  toolName: AgentToolName;
}

/**
 * Purpose: Build a coherent finance response from allowlisted tool payload fields.
 * Uses tool registry output_schema to prefer tool-provided fields (e.g. answer) when present.
 * Inputs: executed tool results and accumulated verification flags.
 * Outputs: structured natural-language synthesis and extra validation flags.
 * Failure modes: missing payload fields return conservative fallback text and flags.
 */
export function synthesizeToolResults({
  existingFlags,
  toolCalls
}: {
  existingFlags: string[];
  toolCalls: ToolExecutionResult[];
}) {
  logger.debug('[agent.synthesize_tool_results] INPUT', {
    existingFlags,
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
  const flags = [...existingFlags];

  for (const call of toolCalls) {
    if (!call.success) {
      risks.push(`Tool ${call.toolName} failed; results may be incomplete.`);
      flags.push('tool_failure');
      continue;
    }

    const rawPayload = isObject(call.result) ? call.result : {};
    const payload = unwrapToolPayload(rawPayload);
    const primarySummary = buildDeterministicToolSummary({
      payload,
      rawPayload,
      toolName: call.toolName
    });

    if (primarySummary) {
      summaryParts.push(primarySummary);
    } else {
      risks.push(`Tool ${call.toolName} returned no summary.`);
      flags.push('incomplete_tool_payload');
    }

    if (!hasProvenance(payload)) {
      risks.push(`Tool ${call.toolName} is missing provenance fields (sources, data_as_of).`);
      flags.push('missing_provenance');
    }

    const dataAsOf = stringOrUndefined(payload.data_as_of);
    if (dataAsOf) {
      dataAsOfValues.push(dataAsOf);
    }

    const missingData = payload.missing_data;
    if (Array.isArray(missingData)) {
      for (const item of missingData) {
        if (typeof item === 'string' && item.trim().length > 0) {
          missingDataPoints.push(item.trim());
        }
      }
    }

    if (call.toolName === 'portfolio_analysis') {
      const usdRemoved = rawPayload.usd_removed_from_holdings === true;
      if (usdRemoved) {
        flags.push('USD_SHOULD_BE_CASH_NOT_HOLDING');
      }
      const topAllocation = extractTopAllocation(payload);
      if (topAllocation.length > 0) {
        keyFindings.push(`Top allocation: ${topAllocation.join(', ')}.`);
      }

      const performanceFindings = extractPerformanceFindings(payload);
      keyFindings.push(...performanceFindings);

      const balanceFindings = extractBalanceAndCashFindings(payload);
      keyFindings.push(...balanceFindings);

      nextSteps.push('Review position sizing against your target allocation and rebalance if needed.');
    }

    if (call.toolName === 'market_data') {
      const symbols = payload.symbols;
      if (Array.isArray(symbols) && symbols.length > 0) {
        const entries = symbols
          .slice(0, 5)
          .map((item) => {
            if (!isObject(item)) return undefined;
            const sym = stringOrUndefined(item.symbol) ?? 'unknown';
            const err =
              stringOrUndefined(item.error) ??
              (isObject(item.error) ? stringOrUndefined(item.error.message) : undefined);
            if (err) return `${sym}: ${err}`;
            const price = numberOrUndefined(item.currentPrice);
            const currency = stringOrUndefined(item.currency) ?? '';
            const pct1w = numberOrUndefined(item.changePercent1w);
            const pct = numberOrUndefined(item.changePercent1m);
            if (price !== undefined) {
              if (pct1w !== undefined) {
                return `${sym}: ${currency} ${price} (${pct1w >= 0 ? '+' : ''}${pct1w}% vs 1w ago)`;
              }
              return pct !== undefined
                ? `${sym}: ${currency} ${price} (${pct >= 0 ? '+' : ''}${pct}% vs 1m ago)`
                : `${sym}: ${currency} ${price}`;
            }
            return undefined;
          })
          .filter((s): s is string => Boolean(s));
        if (entries.length > 0) {
          keyFindings.push(`Market data: ${entries.join('; ')}.`);
        }
      }
      nextSteps.push('Confirm price moves with your watchlist thresholds before trading.');
    }

    if (call.toolName === 'market_overview') {
      const overview = payload.overview;
      if (isObject(overview)) {
        const stocks = isObject(overview.stocks) ? overview.stocks : undefined;
        const crypto = isObject(overview.cryptocurrencies)
          ? overview.cryptocurrencies
          : undefined;
        const stocksLabel = stringOrUndefined(stocks?.label);
        const stocksValue = numberOrUndefined(stocks?.value);
        const cryptoLabel = stringOrUndefined(crypto?.label);
        const cryptoValue = numberOrUndefined(crypto?.value);
        const parts: string[] = [];
        if (stocksLabel || stocksValue !== undefined) {
          parts.push(
            `Stocks sentiment: ${stocksLabel ?? 'unknown'}${
              stocksValue !== undefined ? ` (${stocksValue})` : ''
            }`
          );
        }
        if (cryptoLabel || cryptoValue !== undefined) {
          parts.push(
            `Crypto sentiment: ${cryptoLabel ?? 'unknown'}${
              cryptoValue !== undefined ? ` (${cryptoValue})` : ''
            }`
          );
        }
        if (parts.length > 0) {
          keyFindings.push(`Market overview: ${parts.join('; ')}.`);
        }
      }
      nextSteps.push('Use sentiment as context only; confirm trend with price and breadth data.');
    }

    if (call.toolName === 'market_data_lookup') {
      const prices = payload.prices;
      if (Array.isArray(prices) && prices.length > 0) {
        const entries = prices
          .slice(0, 3)
          .map((item) => {
            if (!isObject(item)) {
              return undefined;
            }

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

    if (call.toolName === 'transaction_categorize') {
      const categories = payload.categories;
      if (Array.isArray(categories) && categories.length > 0) {
        const entries = categories
          .slice(0, 3)
          .map((item) => {
            if (!isObject(item)) {
              return undefined;
            }

            const category = stringOrUndefined(item.category) ?? 'unknown';
            const count = numberOrUndefined(item.count);
            return count === undefined ? category : `${category} (${count})`;
          })
          .filter((item): item is string => Boolean(item));

        if (entries.length > 0) {
          keyFindings.push(`Transaction categories: ${entries.join(', ')}.`);
        }
      }

      const patterns = isObject(payload.patterns) ? payload.patterns : undefined;
      if (patterns) {
        const patternParts: string[] = [];
        const buySellRatio = numberOrUndefined(patterns.buySellRatio);
        const activityTrend = numberOrUndefined(patterns.activityTrend30dVsPrev30dPercent);
        const topSymbol = isObject(patterns.topSymbolByCount) ? patterns.topSymbolByCount : undefined;
        const topSymbolName = stringOrUndefined(topSymbol?.symbol);
        const topSymbolShare = numberOrUndefined(topSymbol?.sharePercent);
        if (buySellRatio !== undefined) {
          patternParts.push(`buy/sell ratio ${buySellRatio}`);
        }
        if (activityTrend !== undefined) {
          patternParts.push(`30d activity trend ${activityTrend}%`);
        }
        if (topSymbolName) {
          patternParts.push(
            `top symbol ${topSymbolName}${topSymbolShare !== undefined ? ` (${topSymbolShare}%)` : ''}`
          );
        }
        if (patternParts.length > 0) {
          keyFindings.push(`Transaction patterns: ${patternParts.join(', ')}.`);
        }
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

    if (call.toolName === 'transaction_timeline') {
      const timeline = payload.timeline;
      if (Array.isArray(timeline) && timeline.length > 0) {
        // Key findings: first 3 for summary
        const entries = timeline
          .slice(0, 3)
          .map((item) => {
            if (!isObject(item)) {
              return undefined;
            }

            const symbol = stringOrUndefined(item.symbol) ?? 'unknown';
            const type = stringOrUndefined(item.type) ?? 'UNKNOWN';
            const date = stringOrUndefined(item.date) ?? 'unknown-date';
            const unitPrice = numberOrUndefined(item.unitPrice);
            return unitPrice === undefined
              ? `${symbol} ${type} on ${date}`
              : `${symbol} ${type} on ${date} at ${unitPrice}`;
          })
          .filter((item): item is string => Boolean(item));

        if (entries.length > 0) {
          keyFindings.push(`Transaction timeline: ${entries.join(', ')}.`);
        }

        // Full list for LLM date filtering: one line per transaction, date first (YYYY-MM-DD)
        for (const item of timeline) {
          if (!isObject(item)) continue;
          const date = stringOrUndefined(item.date) ?? '';
          const symbol = stringOrUndefined(item.symbol) ?? 'unknown';
          const type = stringOrUndefined(item.type) ?? 'UNKNOWN';
          const qty = numberOrUndefined(item.quantity);
          const unitPrice = numberOrUndefined(item.unitPrice);
          const qtyStr = qty !== undefined ? String(qty) : '';
          const priceStr = unitPrice !== undefined ? String(unitPrice) : '';
          transactionListLines.push(`${date} | ${symbol} | ${type} | ${qtyStr} | ${priceStr}`);
        }
      }

      nextSteps.push('Compare entry prices to current market prices before your next rebalance.');
    }

    if (call.toolName === 'compliance_check') {
      const complianceFindings = extractComplianceFindings(payload);
      keyFindings.push(
        `Compliance check: ${complianceFindings.violations.length} violation(s), ${complianceFindings.warnings.length} warning(s).`
      );
      risks.push(...complianceFindings.violations);
      if (complianceFindings.warnings.length > 0) {
        risks.push(...complianceFindings.warnings);
      }
      nextSteps.push(
        complianceFindings.violations.length > 0
          ? 'Resolve compliance violations before executing this trade.'
          : 'No blocking compliance issues found; validate assumptions before execution.'
      );
    }
  }

  const dedupedFlags = [...new Set(flags)];
  const summary = summaryParts.length > 0 ? summaryParts.join(' | ') : 'No reliable tool summary available.';
  const findings = keyFindings.length > 0 ? keyFindings : ['No material findings from the returned tool payload.'];
  const riskLines = risks.length > 0 ? risks : ['No critical risks flagged by current checks.'];
  const steps = nextSteps.length > 0 ? [...new Set(nextSteps)] : ['Provide more detail to refine analysis.'];
  const freshestDataAsOf =
    dataAsOfValues.length > 0
      ? [...new Set(dataAsOfValues)].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))[0]
      : undefined;
  const missingDataLine =
    missingDataPoints.length > 0
      ? [...new Set(missingDataPoints)].join(' | ')
      : 'None.';

  const sections: string[] = [
    `Summary: ${summary}`,
    `Key findings: ${findings.join(' ')}`,
    `Data as of: ${freshestDataAsOf ?? 'unknown'}`,
    `Missing data: ${missingDataLine}`,
    `Risks/flags: ${riskLines.join(' ')}`,
    `Actionable next steps: ${steps.join(' ')}`
  ];

  if (keyFindings.some((f) => f.includes('Holdings value') || f.includes('Cash (USD)'))) {
    sections.push(
      'Portfolio vs cash (critical): Report holdings/investments separately from cash. Do not include cash in "portfolio" when describing allocation or holdings. State holdings value and Cash (USD) separately; e.g. "Your holdings are worth X. Cash (USD): Y. Total value: Z."'
    );
  }

  if (transactionListLines.length > 0) {
    sections.push(
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

function buildDeterministicToolSummary({
  payload,
  rawPayload,
  toolName
}: {
  payload: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
  toolName: AgentToolName;
}) {
  if (toolName === 'portfolio_analysis') {
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

  return stringOrUndefined(rawPayload.summary) ?? stringOrUndefined(payload.summary);
}

function extractComplianceFindings(payload: Record<string, unknown>): {
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

  return items
    .map((item) => {
      if (!isObject(item)) {
        return undefined;
      }
      const ruleId = stringOrUndefined(item.rule_id) ?? 'unknown_rule';
      const message = stringOrUndefined(item.message) ?? 'No details provided.';
      return `${label} (${ruleId}): ${message}`;
    })
    .filter((entry): entry is string => Boolean(entry));
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

function enforceTransactionConsistency({
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

function hasProvenance(payload: Record<string, unknown>) {
  const sources = payload.sources;
  const source = payload.source;
  const dataAsOf = payload.data_as_of;

  const hasSources =
    (Array.isArray(sources) && sources.length > 0) || typeof source === 'string';

  return hasSources && typeof dataAsOf === 'string';
}

function unwrapToolPayload(payload: Record<string, unknown>) {
  const nestedData = payload.data;

  if (isObject(nestedData)) {
    return {
      ...payload,
      ...nestedData
    };
  }

  return payload;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringOrUndefined(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function numberOrUndefined(value: unknown) {
  return typeof value === 'number' ? value : undefined;
}

function extractBalanceAndCashFindings(payload: Record<string, unknown>): string[] {
  const findings: string[] = [];
  const summary = payload.summary;
  if (isObject(summary)) {
    const cash = numberOrUndefined(summary.cash);
    const totalValue = numberOrUndefined(summary.totalValueInBaseCurrency);
    if (cash !== undefined && Number.isFinite(cash)) {
      findings.push(`Cash (USD): ${roundToTwo(cash)}.`);
    }
    if (totalValue !== undefined && Number.isFinite(totalValue)) {
      const holdingsOnly =
        cash !== undefined && Number.isFinite(cash)
          ? totalValue - cash
          : totalValue;
      findings.push(`Holdings value (investments only, excluding cash): ${roundToTwo(holdingsOnly)}.`);
      findings.push(`Total value (holdings + cash): ${roundToTwo(totalValue)}.`);
    } else if (cash === undefined || !Number.isFinite(cash)) {
      if (totalValue !== undefined && Number.isFinite(totalValue)) {
        findings.push(`Total portfolio value (base currency): ${roundToTwo(totalValue)}.`);
      }
    }
  }
  const accounts = payload.accounts;
  if (isObject(accounts)) {
    const entries = Object.entries(accounts)
      .map(([, acc]) => {
        if (!isObject(acc)) return undefined;
        const name = stringOrUndefined(acc.name) ?? 'Account';
        const balance = numberOrUndefined(acc.balance);
        const currency = stringOrUndefined(acc.currency) ?? '';
        const valueInBase = numberOrUndefined(acc.valueInBaseCurrency);
        if (balance !== undefined && Number.isFinite(balance)) {
          return `${name}: balance ${roundToTwo(balance)} ${currency}` +
            (valueInBase !== undefined && Number.isFinite(valueInBase) ? ` (${roundToTwo(valueInBase)} base)` : '');
        }
        return undefined;
      })
      .filter((s): s is string => Boolean(s));
    if (entries.length > 0) {
      findings.push(`Account balances: ${entries.join('; ')}.`);
    }
  }
  const platforms = payload.platforms;
  if (isObject(platforms)) {
    const entries = Object.entries(platforms)
      .map(([, p]) => {
        if (!isObject(p)) return undefined;
        const name = stringOrUndefined(p.name) ?? 'Platform';
        const balance = numberOrUndefined(p.balance);
        const currency = stringOrUndefined(p.currency) ?? '';
        if (balance !== undefined && Number.isFinite(balance)) {
          return `${name}: ${roundToTwo(balance)} ${currency}`;
        }
        return undefined;
      })
      .filter((s): s is string => Boolean(s));
    if (entries.length > 0) {
      findings.push(`Platform balances: ${entries.join('; ')}.`);
    }
  }
  return findings;
}

function extractTopAllocation(payload: Record<string, unknown>) {
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

function extractPerformanceFindings(payload: Record<string, unknown>) {
  const findings: string[] = [];
  const performanceSource = resolvePerformanceSource(payload);

  if (!performanceSource) {
    return findings;
  }

  const netPerformance = numberOrUndefined(performanceSource.netPerformance);
  if (netPerformance !== undefined) {
    findings.push(`Net performance: ${roundToTwo(netPerformance)}.`);
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

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100;
}

/** USD is CASH, not a holding. Exclude from allocation/holdings display. */
function isCashSymbol(symbol: string): boolean {
  return symbol.toUpperCase() === 'USD';
}

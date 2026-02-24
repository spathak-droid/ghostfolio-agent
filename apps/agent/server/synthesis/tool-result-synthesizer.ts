import { AgentToolName } from '../types';
import { getToolDefinition } from '../tools/tool-registry';

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
  console.log('[agent.synthesize_tool_results] INPUT', {
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
    const toolDef = getToolDefinition(call.toolName);
    const hasAnswerInSchema = Boolean(toolDef?.output_schema.properties?.answer);
    const payloadAnswer = stringOrUndefined(rawPayload.answer) ?? stringOrUndefined(payload.answer);
    const payloadSummary =
      stringOrUndefined(rawPayload.summary) ?? stringOrUndefined(payload.summary);
    // Prefer tool's answer field when registry says it exists and tool returned it (e.g. transaction_timeline, transaction_categorize)
    const primarySummary =
      hasAnswerInSchema && payloadAnswer?.trim()
        ? payloadAnswer.trim()
        : payloadSummary;

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

      nextSteps.push('Validate uncategorized transactions and update category rules.');
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

  if (transactionListLines.length > 0) {
    sections.push(
      'Transaction list (date | symbol | type | quantity | unitPrice — include in your answer only rows that match the user\'s requested time period):',
      ...transactionListLines
    );
  }

  const answer = sections.join('\n');
  console.log('[agent.synthesize_tool_results] OUTPUT', {
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
    if (cash !== undefined && Number.isFinite(cash)) {
      findings.push(`Cash (available balance in base currency): ${roundToTwo(cash)}.`);
    }
    const totalValue = numberOrUndefined(summary.totalValueInBaseCurrency);
    if (totalValue !== undefined && Number.isFinite(totalValue)) {
      findings.push(`Total portfolio value (base currency): ${roundToTwo(totalValue)}.`);
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

/**
 * Purpose: Estimate federal tax impact from portfolio activities (realized gains/losses and income).
 * Inputs: Ghostfolio activities via GET /api/v1/order and user message hints (filing status, tax year, ordinary income,
 *         qualified dividends, self-employment income, state).
 * Outputs: Detailed federal tax estimate with realized P/L breakdown, AMT, wash sales, assumptions, sources, and data_as_of.
 * Failure modes: missing/invalid activity fields are skipped and surfaced in assumptions; missing tax table returns structured error.
 * When the user does not provide ordinary income, we return a concrete example scenario (single, $60k/year) so the response is never all zeros.
 * DISCLAIMER: This is an estimate based on user-provided data and detected activities. It does not account for all tax situations
 * (entity types, alternative minimum tax adjustments, state/local taxes, self-employment tax nuances, etc.).
 * Users MUST consult a qualified tax professional before filing.
 */

/** Default annual income for the illustrative scenario when user does not provide income (single filer, 2026). */
const DEFAULT_SCENARIO_ANNUAL_INCOME = 60_000;

import { GhostfolioClient } from '../clients';
import { loadFederalTaxTable, calculateTaxFromBrackets } from '../tax/tax-tables';
import { toToolErrorPayload } from './tool-error';
import { callOpenAi } from '../llm/openai-client-request';

type FilingStatus =
  | 'single'
  | 'marriedFilingJointly'
  | 'marriedFilingSeparately'
  | 'headOfHousehold';

interface Lot {
  acquiredAtMs: number;
  quantityRemaining: number;
  unitCost: number;
}

interface ParsedActivity {
  dateMs: number;
  fee: number;
  quantity: number;
  symbol: string;
  type: 'BUY' | 'SELL' | 'DIVIDEND' | 'INTEREST' | 'FEE' | 'LIABILITY';
  unitPrice: number;
  assetClass?: string;     // 'EQUITY' | 'LIQUIDITY' | ...
  assetSubClass?: string;  // 'STOCK' | 'CRYPTOCURRENCY' | ...
  isUSEquity: boolean;     // true if assetSubClass=STOCK and countries includes US
}

interface WashSaleDetection {
  disallowedLosses: number;
  affectedSymbols: string[];
}

export async function taxEstimateTool({
  client,
  impersonationId,
  message,
  range,
  take,
  token,
  conversation_history
}: {
  client: GhostfolioClient;
  impersonationId?: string;
  message: string;
  range?: string;
  take?: number;
  token?: string;
  conversation_history?: { role: string; content: string }[];
}) {
  const assumptions: string[] = [];
  try {
    // Use LLM to extract tax parameters, with full conversation history for context
    const extracted = await extractTaxParameters(message, {
      conversationHistory: conversation_history || []
    });

    const taxYear = extracted.taxYear ?? 2026;
    const hasExplicitTaxYear = extracted.taxYear !== undefined;
    if (!hasExplicitTaxYear) {
      assumptions.push('Tax year not provided; defaulted to 2026.');
    }
    const filingStatus = extracted.filingStatus ?? 'single';
    const hasExplicitFilingStatus = extracted.filingStatus !== undefined;
    if (!hasExplicitFilingStatus) {
      assumptions.push('Filing status not provided; defaulted to single.');
    }
    const ordinaryIncome = extracted.ordinaryIncome ?? 0;
    const hasExplicitOrdinaryIncome = extracted.ordinaryIncome !== undefined;

    const hasExplicitQualifiedDividends = extracted.qualifiedDividends !== undefined;

    const taxTable = loadFederalTaxTable(taxYear);
    const raw = await client.getTransactions({ impersonationId, range, take, token });
    const activities = Array.isArray(raw.activities) ? raw.activities : [];
    const taxActivities = activities
      .map(parseActivity)
      .filter((item): item is ParsedActivity => item !== undefined)
      .sort((a, b) => a.dateMs - b.dateMs);

    const { totals, washSales, byAssetClass, openPositions } = calculateTaxFromActivities({
      activities: taxActivities,
      assumptions
    });
    if (washSales.disallowedLosses > 0) {
      assumptions.push(
        `Wash sale detected: $${washSales.disallowedLosses.toFixed(2)} in losses disallowed for symbols: ${washSales.affectedSymbols.join(', ')}.`
      );
    }

    // Use auto-detected qualified dividends if available, otherwise use extracted or 0
    const finalQualifiedDividends = hasExplicitQualifiedDividends ? extracted.qualifiedDividends : totals.qualifiedDividends;
    const hasAutoDetectedQualified = totals.qualifiedDividends > 0 && !hasExplicitQualifiedDividends;

    // Only add the non-qualified assumption if there are dividends and none were auto-detected as qualified
    if (!hasExplicitQualifiedDividends && totals.dividends > 0 && !hasAutoDetectedQualified) {
      assumptions.push('All dividends assumed non-qualified ordinary dividend income.');
    }

    const estimate = calculateFederalEstimate({
      filingStatus,
      ordinaryIncome,
      taxTable,
      totals,
      qualifiedDividends: finalQualifiedDividends
    });

    const amt = calculateAMT({
      filingStatus,
      ordinaryIncome,
      totals,
      taxTable
    });
    const scenarioEstimate = !hasExplicitOrdinaryIncome
      ? calculateFederalEstimate({
          filingStatus,
          ordinaryIncome: DEFAULT_SCENARIO_ANNUAL_INCOME,
          taxTable,
          totals,
          qualifiedDividends: finalQualifiedDividends
        })
      : undefined;

    // When user did not provide income, show the example scenario as the primary numbers so the agent never displays "0 USD" for all components.
    const displayEstimate = hasExplicitOrdinaryIncome ? estimate : (scenarioEstimate ?? estimate);
    const effectiveRate =
      displayEstimate.totalEstimatedFederalTax > 0
        ? displayEstimate.totalEstimatedFederalTax /
          Math.max(1, displayEstimate.taxableOrdinaryIncome + displayEstimate.taxableLongTermGains)
        : 0;

    if (!hasExplicitOrdinaryIncome) {
      assumptions.push(
        `Ordinary income not provided; showing example scenario: ${filingStatus} filer, $${DEFAULT_SCENARIO_ANNUAL_INCOME.toLocaleString()} annual income (${taxYear}).`
      );
    }

    // Only ask for missing params if they're actually not provided AND couldn't be extracted
    // Don't ask if we successfully extracted them OR if they'll be used from defaults
    const missingParams: { param: string; question: string }[] = [];

    // If we have conversation history, don't ask for params that were likely mentioned
    // User provided values should be in the answer, not in missing_params
    if (!hasExplicitTaxYear && (!conversation_history || conversation_history.length === 0)) {
      missingParams.push({
        param: 'tax_year',
        question: 'Which tax year do you want the estimate for? (e.g. 2026)'
      });
    }
    if (!hasExplicitFilingStatus && (!conversation_history || conversation_history.length === 0)) {
      missingParams.push({
        param: 'filing_status',
        question:
          'What is your filing status? (e.g. single, married filing jointly, head of household, married filing separately)'
      });
    }
    if (!hasExplicitOrdinaryIncome && (!conversation_history || conversation_history.length === 0)) {
      missingParams.push({
        param: 'ordinary_income',
        question:
          'What is your approximate annual ordinary income in USD? (e.g. from W-2, self-employment, other taxable income)'
      });
    }
    // Only ask about qualified dividends if there are dividends and they weren't auto-detected
    if (totals.dividends > 0 && !hasExplicitQualifiedDividends && !hasAutoDetectedQualified) {
      missingParams.push({
        param: 'qualified_dividends',
        question:
          'Do you have any qualified dividends? (e.g. from US stocks held >60 days, taxed at capital gains rates)'
      });
    }

    // Generate tax insights
    const insights = generateTaxInsights({
      washSales,
      openPositions,
      byAssetClass,
      qualifiedDividends: finalQualifiedDividends,
      totals
    });

    const exampleBlock =
      hasExplicitOrdinaryIncome
        ? `For ${filingStatus}, tax year ${taxYear}, with the ordinary income and gains/dividends you provided, your estimated federal tax is USD ${round2(displayEstimate.totalEstimatedFederalTax)}. `
        : `Meanwhile, here's an example scenario: if you were ${filingStatus}, tax year ${taxYear}, with $${DEFAULT_SCENARIO_ANNUAL_INCOME.toLocaleString()} annual ordinary income and no portfolio gains in this period, estimated federal tax would be approximately USD ${round2(displayEstimate.totalEstimatedFederalTax)} (ordinary income tax ${round2(displayEstimate.ordinaryTax)} USD, long-term capital gains ${round2(displayEstimate.longTermTax)} USD, NIIT ${round2(displayEstimate.niitTax)} USD). `;
    const askBlock =
      missingParams.length > 0
        ? `To give you a personalized estimate, I need a few details:\n\n` +
          missingParams.map((p) => `• ${p.question}`).join('\n') +
          '\n\n' +
          exampleBlock
        : exampleBlock;

    const disclaimer = `

**IMPORTANT DISCLAIMER:** Not financial advice. This is an educational estimate based only on the data provided and portfolio activities detected. It is NOT a substitute for professional tax advice. This estimate:

• Does NOT account for state/local taxes, self-employment taxes, AMT adjustments, and other complex tax situations
• May UNDERESTIMATE your actual tax liability
• Should NOT be used for filing tax returns or making financial decisions

**You MUST consult a qualified tax professional (CPA, tax attorney, enrolled agent) before filing your tax return.**

Please consult with your financial advisor and a qualified tax professional before making decisions.`;

    return {
      success: true,
      tax_year: taxYear,
      filing_status: filingStatus,
      assumptions,
      ...(missingParams.length > 0 ? { missing_params: missingParams } : {}),
      activity_count: taxActivities.length,
      ...(!hasExplicitOrdinaryIncome && scenarioEstimate ? { illustrative: true } : {}),
      realized: {
        short_term_gains: round2(totals.shortTermGains),
        short_term_losses: round2(totals.shortTermLosses),
        long_term_gains: round2(totals.longTermGains),
        long_term_losses: round2(totals.longTermLosses),
        net_capital_gain_loss: round2(totals.netCapital)
      },
      income: {
        dividends: round2(totals.dividends),
        qualified_dividends: round2(finalQualifiedDividends),
        interest: round2(totals.interest)
      },
      by_asset_class: {
        equity: {
          short_term_gains: round2(byAssetClass.equity.shortTermGains),
          short_term_losses: round2(byAssetClass.equity.shortTermLosses),
          long_term_gains: round2(byAssetClass.equity.longTermGains),
          long_term_losses: round2(byAssetClass.equity.longTermLosses)
        },
        crypto: {
          short_term_gains: round2(byAssetClass.crypto.shortTermGains),
          short_term_losses: round2(byAssetClass.crypto.shortTermLosses),
          long_term_gains: round2(byAssetClass.crypto.longTermGains),
          long_term_losses: round2(byAssetClass.crypto.longTermLosses)
        },
        other: {
          short_term_gains: round2(byAssetClass.other.shortTermGains),
          short_term_losses: round2(byAssetClass.other.shortTermLosses),
          long_term_gains: round2(byAssetClass.other.longTermGains),
          long_term_losses: round2(byAssetClass.other.longTermLosses)
        }
      },
      open_positions: openPositions.map((pos) => ({
        symbol: pos.symbol,
        quantity: pos.quantity,
        days_held: pos.daysHeld,
        is_long_term: pos.isLongTerm,
        days_until_long_term: pos.daysUntilLongTerm
      })),
      insights,
      estimate: {
        taxable_ordinary_income: round2(displayEstimate.taxableOrdinaryIncome),
        taxable_long_term_gains: round2(displayEstimate.taxableLongTermGains),
        ordinary_tax: round2(displayEstimate.ordinaryTax),
        long_term_capital_gains_tax: round2(displayEstimate.longTermTax),
        niit: round2(displayEstimate.niitTax),
        total_estimated_federal_tax: round2(displayEstimate.totalEstimatedFederalTax),
        effective_tax_rate: round4(effectiveRate),
        ...(amt.amt > 0 ? { amt_due: round2(Math.max(0, amt.amt - displayEstimate.totalEstimatedFederalTax)) } : {})
      },
      ...(scenarioEstimate
        ? {
            scenario_estimate: {
              ordinary_income_assumed: DEFAULT_SCENARIO_ANNUAL_INCOME,
              taxable_ordinary_income: round2(scenarioEstimate.taxableOrdinaryIncome),
              taxable_long_term_gains: round2(scenarioEstimate.taxableLongTermGains),
              ordinary_tax: round2(scenarioEstimate.ordinaryTax),
              long_term_capital_gains_tax: round2(scenarioEstimate.longTermTax),
              niit: round2(scenarioEstimate.niitTax),
              total_estimated_federal_tax: round2(scenarioEstimate.totalEstimatedFederalTax)
            }
          }
        : {}),
      summary:
        (hasExplicitOrdinaryIncome
          ? `Tax estimate (${taxYear}, ${filingStatus}): `
          : `Example scenario (${taxYear}, ${filingStatus}, $${DEFAULT_SCENARIO_ANNUAL_INCOME.toLocaleString()}/year): `) +
        `total federal tax ${round2(displayEstimate.totalEstimatedFederalTax)} USD ` +
        `(ordinary ${round2(displayEstimate.ordinaryTax)} + LT gains ${round2(displayEstimate.longTermTax)} + NIIT ${round2(displayEstimate.niitTax)}).` +
        (amt.amt > 0 ? ` AMT may apply (${round2(amt.amt)} USD).` : ''),
      answer: askBlock + disclaimer,
      data_as_of: new Date().toISOString(),
      sources: ['ghostfolio_api', `docs/agent/tax/us/federal/${taxYear}.json`]
    };
  } catch (error) {
    const toolError = toToolErrorPayload(error);
    const disclaimer = `

Not financial advice. Please consult with your financial advisor and a qualified tax professional before making decisions.

**IMPORTANT DISCLAIMER:** This tool could not generate an estimate due to technical issues. If you need a tax estimate:

• Consult a qualified tax professional (CPA, tax attorney, enrolled agent)
• Use official IRS tools and resources
• Do NOT rely on incomplete or failed estimates`;

    return {
      success: false,
      answer: `Could not estimate taxes: ${toolError.message}${disclaimer}`,
      summary: `Tax estimate failed: ${toolError.message}`,
      error: toolError,
      data_as_of: new Date().toISOString(),
      sources: ['ghostfolio_api']
    };
  }
}

function generateTaxInsights({
  washSales,
  openPositions,
  byAssetClass,
  qualifiedDividends,
  totals
}: {
  washSales: WashSaleDetection;
  openPositions: { symbol: string; quantity: number; daysHeld: number; isLongTerm: boolean; daysUntilLongTerm: number }[];
  byAssetClass: Record<
    string,
    { shortTermGains: number; shortTermLosses: number; longTermGains: number; longTermLosses: number }
  >;
  qualifiedDividends: number;
  totals: {
    shortTermGains: number;
    shortTermLosses: number;
    longTermGains: number;
    longTermLosses: number;
    dividends: number;
    qualifiedDividends: number;
    interest: number;
    netCapital: number;
  };
}): string[] {
  const insights: string[] = [];

  // Insight 1: Wash sale detection
  if (washSales.disallowedLosses > 0) {
    insights.push(
      `Wash sale detected on ${washSales.affectedSymbols.join(', ')}: $${washSales.disallowedLosses.toFixed(2)} in losses disallowed.`
    );
  }

  // Insight 2: Qualified dividends
  if (qualifiedDividends > 0) {
    const nonQualifiedDividends = totals.dividends - qualifiedDividends;
    if (nonQualifiedDividends > 0) {
      insights.push(
        `You have $${qualifiedDividends.toFixed(2)} in qualified dividends (taxed at capital gains rates) and $${nonQualifiedDividends.toFixed(2)} in non-qualified dividends (taxed as ordinary income).`
      );
    } else {
      insights.push(
        `Your $${qualifiedDividends.toFixed(2)} in dividends are from US equities and treated as qualified — taxed at preferred capital gains rates.`
      );
    }
  }

  // Insight 3: Open positions approaching long-term
  const closestToLongTerm = openPositions.find((p) => !p.isLongTerm && p.daysUntilLongTerm > 0 && p.daysUntilLongTerm <= 90);
  if (closestToLongTerm) {
    const daysHeldPercentage = Math.round((closestToLongTerm.daysHeld / 365) * 100);
    insights.push(
      `${closestToLongTerm.symbol} has been held ${closestToLongTerm.daysHeld} days (${daysHeldPercentage}% of long-term threshold). Holding ${closestToLongTerm.daysUntilLongTerm} more days would shift it to long-term rates.`
    );
  }

  // Insight 4: Crypto allocation in gains
  const cryptoGains = byAssetClass.crypto.longTermGains + byAssetClass.crypto.shortTermGains;
  const equityGains = byAssetClass.equity.longTermGains + byAssetClass.equity.shortTermGains;
  const totalGains = cryptoGains + equityGains + byAssetClass.other.longTermGains + byAssetClass.other.shortTermGains;
  if (cryptoGains > 0 && totalGains > 0) {
    const cryptoPercent = Math.round((cryptoGains / totalGains) * 100);
    insights.push(
      `Cryptocurrency gains represent ${cryptoPercent}% of your total realized gains ($${cryptoGains.toFixed(2)}). Consider tax-loss harvesting in down markets.`
    );
  }

  return insights;
}

function calculateTaxFromActivities({
  activities,
  assumptions
}: {
  activities: ParsedActivity[];
  assumptions: string[];
}): {
  totals: {
    shortTermGains: number;
    shortTermLosses: number;
    longTermGains: number;
    longTermLosses: number;
    dividends: number;
    qualifiedDividends: number;
    interest: number;
    netCapital: number;
  };
  washSales: WashSaleDetection;
  byAssetClass: Record<
    string,
    { shortTermGains: number; shortTermLosses: number; longTermGains: number; longTermLosses: number }
  >;
  openPositions: {
    symbol: string;
    quantity: number;
    daysHeld: number;
    isLongTerm: boolean;
    daysUntilLongTerm: number;
  }[];
} {
  const lotsBySymbol = new Map<string, (Lot & { assetSubClass?: string; isUSEquity: boolean })[]>();
  let shortTermGains = 0;
  let shortTermLosses = 0;
  let longTermGains = 0;
  let longTermLosses = 0;
  let dividends = 0;
  let qualifiedDividends = 0;
  let interest = 0;
  const washSalesBySymbol = new Map<string, number>();
  const byAssetClass: Record<
    string,
    { shortTermGains: number; shortTermLosses: number; longTermGains: number; longTermLosses: number }
  > = {
    equity: { shortTermGains: 0, shortTermLosses: 0, longTermGains: 0, longTermLosses: 0 },
    crypto: { shortTermGains: 0, shortTermLosses: 0, longTermGains: 0, longTermLosses: 0 },
    other: { shortTermGains: 0, shortTermLosses: 0, longTermGains: 0, longTermLosses: 0 }
  };

  for (const activity of activities) {
    if (activity.type === 'DIVIDEND') {
      const dividendAmount = activity.unitPrice * activity.quantity;
      dividends += dividendAmount;
      // Auto-detect qualified dividends for US equities
      if (activity.isUSEquity) {
        qualifiedDividends += dividendAmount;
      }
      continue;
    }
    if (activity.type === 'INTEREST') {
      interest += activity.unitPrice * activity.quantity;
      continue;
    }
    if (activity.type === 'BUY') {
      const totalCost = activity.unitPrice * activity.quantity + activity.fee;
      const lot: Lot & { assetSubClass?: string; isUSEquity: boolean } = {
        acquiredAtMs: activity.dateMs,
        quantityRemaining: activity.quantity,
        unitCost: totalCost / activity.quantity,
        assetSubClass: activity.assetSubClass,
        isUSEquity: activity.isUSEquity
      };
      const list = lotsBySymbol.get(activity.symbol) ?? [];
      list.push(lot);
      lotsBySymbol.set(activity.symbol, list);
      continue;
    }
    if (activity.type !== 'SELL') {
      continue;
    }

    const lots = lotsBySymbol.get(activity.symbol) ?? [];
    let quantityToMatch = activity.quantity;

    while (quantityToMatch > 0 && lots.length > 0) {
      const lot = lots[0];
      const consumed = Math.min(quantityToMatch, lot.quantityRemaining);
      const proceedsUnit = activity.unitPrice;
      const realized = consumed * proceedsUnit - consumed * lot.unitCost;
      const heldDays = Math.floor((activity.dateMs - lot.acquiredAtMs) / 86_400_000);
      const isLongTerm = heldDays >= 365;

      // Determine asset class bucket for tracking
      let bucket = 'other';
      if (lot.assetSubClass === 'STOCK') {
        bucket = 'equity';
      } else if (lot.assetSubClass === 'CRYPTOCURRENCY') {
        bucket = 'crypto';
      }

      // Check for wash sale: loss within 30 days before/after sell
      if (realized < 0) {
        const buyWindowStart = activity.dateMs - 30 * 86_400_000;
        const buyWindowEnd = activity.dateMs + 30 * 86_400_000;
        const hasRecentBuy = activities.some(
          (a) =>
            a.type === 'BUY' &&
            a.symbol === activity.symbol &&
            a.dateMs >= buyWindowStart &&
            a.dateMs <= buyWindowEnd &&
            a.dateMs > activity.dateMs
        );
        if (hasRecentBuy) {
          const loss = Math.abs(realized);
          washSalesBySymbol.set(activity.symbol, (washSalesBySymbol.get(activity.symbol) ?? 0) + loss);
        }
      }

      if (realized >= 0) {
        if (isLongTerm) {
          longTermGains += realized;
          byAssetClass[bucket].longTermGains += realized;
        } else {
          shortTermGains += realized;
          byAssetClass[bucket].shortTermGains += realized;
        }
      } else if (isLongTerm) {
        longTermLosses += Math.abs(realized);
        byAssetClass[bucket].longTermLosses += Math.abs(realized);
      } else {
        shortTermLosses += Math.abs(realized);
        byAssetClass[bucket].shortTermLosses += Math.abs(realized);
      }
      lot.quantityRemaining -= consumed;
      quantityToMatch -= consumed;
      if (lot.quantityRemaining <= 0) {
        lots.shift();
      }
    }

    if (quantityToMatch > 0) {
      assumptions.push(
        `Unmatched sell quantity for ${activity.symbol}: ${round4(quantityToMatch)} units (insufficient prior buys).`
      );
    }

    const sellProceeds = activity.unitPrice * activity.quantity - activity.fee;
    const feeAdjustment = sellProceeds - (activity.unitPrice * activity.quantity);
    if (feeAdjustment < 0) {
      shortTermLosses += Math.abs(feeAdjustment);
      byAssetClass['other'].shortTermLosses += Math.abs(feeAdjustment);
    }
  }

  // Build open positions list from remaining lots
  const openPositions: {
    symbol: string;
    quantity: number;
    daysHeld: number;
    isLongTerm: boolean;
    daysUntilLongTerm: number;
  }[] = [];
  const now = Date.now();
  for (const [symbol, lots] of lotsBySymbol.entries()) {
    for (const lot of lots) {
      if (lot.quantityRemaining > 0) {
        const daysHeld = Math.floor((now - lot.acquiredAtMs) / 86_400_000);
        const isLongTerm = daysHeld >= 365;
        const daysUntilLongTerm = isLongTerm ? 0 : 365 - daysHeld;
        openPositions.push({
          symbol,
          quantity: round4(lot.quantityRemaining),
          daysHeld,
          isLongTerm,
          daysUntilLongTerm
        });
      }
    }
  }
  // Sort by days_until_long_term ascending (positions closest to long-term first)
  openPositions.sort((a, b) => a.daysUntilLongTerm - b.daysUntilLongTerm);

  const netCapital = shortTermGains - shortTermLosses + (longTermGains - longTermLosses);
  assumptions.push('FIFO lot matching used for cost basis.');

  return {
    totals: {
      shortTermGains,
      shortTermLosses,
      longTermGains,
      longTermLosses,
      dividends,
      qualifiedDividends,
      interest,
      netCapital
    },
    washSales: {
      disallowedLosses: Array.from(washSalesBySymbol.values()).reduce((a, b) => a + b, 0),
      affectedSymbols: Array.from(washSalesBySymbol.keys())
    },
    byAssetClass,
    openPositions
  };
}

function calculateFederalEstimate({
  filingStatus,
  ordinaryIncome,
  taxTable,
  totals,
  qualifiedDividends = 0
}: {
  filingStatus: FilingStatus;
  ordinaryIncome: number;
  taxTable: ReturnType<typeof loadFederalTaxTable>;
  totals: {
    shortTermGains: number;
    shortTermLosses: number;
    longTermGains: number;
    longTermLosses: number;
    dividends: number;
    interest: number;
    netCapital: number;
  };
  qualifiedDividends?: number;
}) {
  const stNet = totals.shortTermGains - totals.shortTermLosses;
  const ltNet = totals.longTermGains - totals.longTermLosses;
  const nonQualifiedDividends = Math.max(0, totals.dividends - qualifiedDividends);
  const taxableLongTermGains = Math.max(0, ltNet + Math.min(0, stNet) + qualifiedDividends);
  const taxableShortTermComponent = Math.max(0, stNet + Math.min(0, ltNet));
  const maxOffset = taxTable.capitalLossRules.maxOrdinaryOffset;
  const ordinaryLossOffset =
    totals.netCapital < 0 ? Math.min(maxOffset, Math.abs(totals.netCapital)) : 0;

  const standardDeduction = taxTable.standardDeduction[filingStatus];
  const taxableOrdinaryIncome = Math.max(
    0,
    ordinaryIncome - standardDeduction + taxableShortTermComponent + nonQualifiedDividends + totals.interest - ordinaryLossOffset
  );

  const ordinaryTax = calculateTaxFromBrackets(
    taxableOrdinaryIncome,
    taxTable.ordinaryBrackets[filingStatus]
  );
  const longTermTax = calculateLongTermGainsTax({
    ordinaryTaxableIncome: taxableOrdinaryIncome,
    taxableLongTermGains,
    brackets: taxTable.longTermCapitalGainsBrackets[filingStatus]
  });

  const netInvestmentIncome =
    Math.max(0, stNet) + Math.max(0, ltNet) + totals.dividends + totals.interest;
  const magiApprox =
    Math.max(0, ordinaryIncome) + Math.max(0, stNet) + Math.max(0, ltNet) + totals.dividends + totals.interest;
  const niitExcess = Math.max(0, magiApprox - taxTable.niit.threshold[filingStatus]);
  const niitTax = Math.min(netInvestmentIncome, niitExcess) * taxTable.niit.rate;

  return {
    taxableOrdinaryIncome,
    taxableLongTermGains,
    ordinaryTax,
    longTermTax,
    niitTax,
    totalEstimatedFederalTax: ordinaryTax + longTermTax + niitTax
  };
}

function calculateLongTermGainsTax({
  brackets,
  ordinaryTaxableIncome,
  taxableLongTermGains
}: {
  brackets: readonly { upTo: number | null; rate: number }[];
  ordinaryTaxableIncome: number;
  taxableLongTermGains: number;
}): number {
  if (taxableLongTermGains <= 0) return 0;

  let currentTotalIncome = Math.max(0, ordinaryTaxableIncome);
  let remaining = taxableLongTermGains;
  let tax = 0;
  for (const bracket of brackets) {
    if (remaining <= 0) break;
    const upper = bracket.upTo ?? Number.POSITIVE_INFINITY;
    const room = Math.max(0, upper - currentTotalIncome);
    if (room <= 0) continue;
    const taxedHere = Math.min(remaining, room);
    tax += taxedHere * bracket.rate;
    remaining -= taxedHere;
    currentTotalIncome += taxedHere;
  }
  return tax;
}

function calculateAMT({
  filingStatus,
  ordinaryIncome,
  totals,
  taxTable
}: {
  filingStatus: FilingStatus;
  ordinaryIncome: number;
  totals: {
    shortTermGains: number;
    shortTermLosses: number;
    longTermGains: number;
    longTermLosses: number;
    dividends: number;
    interest: number;
    netCapital: number;
  };
  taxTable: ReturnType<typeof loadFederalTaxTable>;
}): { amt: number } {
  // Simplified AMT calculation (full AMT is complex with many adjustments)
  // Return 0 if AMT data not available in tax table
  if (!taxTable.optional?.AMT) {
    return { amt: 0 };
  }

  const amtExemption = taxTable.optional.AMT.exemptionAmount[filingStatus];
  const amtIncome = ordinaryIncome + Math.max(0, totals.netCapital) + totals.dividends + totals.interest;
  const phaseoutStarts = taxTable.optional.AMT.phaseoutStartsAt[filingStatus];
  const phaseoutRate = 0.25; // 25% phaseout

  let exemptionUsed = amtExemption;
  if (amtIncome > phaseoutStarts) {
    const phaseoutAmount = Math.floor((amtIncome - phaseoutStarts) / 1000) * 1000;
    exemptionUsed = Math.max(0, amtExemption - phaseoutAmount * phaseoutRate);
  }

  const amtTaxableIncome = Math.max(0, amtIncome - exemptionUsed);
  // AMT uses two rates: 26% and 28%
  const amtRate1 = 0.26;
  const amtRate2 = 0.28;
  const amtThreshold = 200000;

  let amtTax = 0;
  if (amtTaxableIncome <= amtThreshold) {
    amtTax = amtTaxableIncome * amtRate1;
  } else {
    amtTax = amtThreshold * amtRate1 + (amtTaxableIncome - amtThreshold) * amtRate2;
  }

  return { amt: amtTax };
}

async function extractTaxParameters(
  message: string,
  context?: {
    conversationHistory?: { role: string; content: string }[];
  }
): Promise<{
  taxYear?: number;
  filingStatus?: FilingStatus;
  ordinaryIncome?: number;
  qualifiedDividends?: number;
}> {
  try {
    // Try LLM-based extraction first
    const openRouterApiKey = process.env.OPENROUTER_API_KEY ?? process.env.API_KEY_OPENROUTER;
    const openAiApiKey = process.env.OPENAI_API_KEY;
    const apiKey = openRouterApiKey ?? openAiApiKey ?? '';

    if (!apiKey) {
      // Fall back to regex if no API key
      return fallbackRegexExtraction(message);
    }

    const usingOpenRouter = Boolean(openRouterApiKey);
    const requestUrl = usingOpenRouter
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions';
    const model = process.env.OPENAI_MODEL || (usingOpenRouter ? 'openai/gpt-4o-mini' : 'gpt-4o-mini');

    // Build conversation context from history, extracting all previously mentioned values
    const conversationHistory = context?.conversationHistory || [];

    // Find any mentions of years, filing statuses, and numbers that look like income
    const mentionedYears = extractAllYears(conversationHistory);
    const mentionedFilingStatuses = extractAllFilingStatuses(conversationHistory);
    const mentionedIncomes = extractAllNumbers(conversationHistory);

    const conversationContext =
      conversationHistory.length > 0
        ? `\nFull conversation history:
${conversationHistory.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n')}

Previously mentioned values in conversation:
- Years mentioned: ${mentionedYears.length > 0 ? mentionedYears.join(', ') : 'none'}
- Filing statuses mentioned: ${mentionedFilingStatuses.length > 0 ? mentionedFilingStatuses.join(', ') : 'none'}
- Income/numbers mentioned: ${mentionedIncomes.length > 0 ? mentionedIncomes.slice(0, 5).join(', ') : 'none'}`
        : '';

    const extractionPrompt = `Extract tax parameters from this conversation. Return ONLY a JSON object (no markdown, no extra text).

${conversationContext}

Latest user message: "${message}"

Extract these fields (ALWAYS look at ALL previous messages, keep values that were mentioned before):
{
  "tax_year": <number or null, e.g. 2026>,
  "filing_status": <"single", "marriedFilingJointly", "marriedFilingSeparately", "headOfHousehold", or null>,
  "ordinary_income": <number or null, e.g. 50000>,
  "qualified_dividends": <number or null, e.g. 1000>
}

CRITICAL RULES:
1. Look at the ENTIRE conversation from beginning to end, not just the latest message
2. If a value was mentioned ANYWHERE in the conversation, extract it (don't lose it)
3. Accept any format: "50000 income", "income is 50000", "I make 50k", "single", "married", "2026", etc.
4. When user provides only one value, keep all previously mentioned values

Examples:
- Conversation: "single and 50000" / "2026" → {"tax_year": 2026, "filing_status": "single", "ordinary_income": 50000, "qualified_dividends": null}
- Conversation: "2026, single" / "50000" → {"tax_year": 2026, "filing_status": "single", "ordinary_income": 50000, "qualified_dividends": null}
- Conversation: "50000 income" / "single" / "2026" → ALL THREE should be in final extraction

Return ONLY the JSON object, nothing else.`;

    const response = await callOpenAi({
      apiKey,
      model,
      requestUrl,
      messages: [{ role: 'user', content: extractionPrompt }],
      requireJson: false,
      tier: 'fast',
      timeoutMs: 3000,
      candidateIndex: 0,
      traceContext: undefined
    });

    if (!response) {
      return fallbackRegexExtraction(message);
    }

    const parsed = JSON.parse(response.trim());

    // If LLM didn't extract a value, fall back to helper extraction from conversation
    const taxYear =
      typeof parsed.tax_year === 'number'
        ? parsed.tax_year
        : mentionedYears.length > 0
          ? mentionedYears[0]
          : undefined;
    const filingStatus =
      isValidFilingStatus(parsed.filing_status)
        ? parsed.filing_status
        : mentionedFilingStatuses.length > 0
          ? (mentionedFilingStatuses[0] as FilingStatus)
          : undefined;
    const ordinaryIncome =
      typeof parsed.ordinary_income === 'number' && parsed.ordinary_income >= 0
        ? parsed.ordinary_income
        : mentionedIncomes.length > 0
          ? mentionedIncomes[0]
          : undefined;
    const qualifiedDividends =
      typeof parsed.qualified_dividends === 'number' && parsed.qualified_dividends >= 0
        ? parsed.qualified_dividends
        : undefined;

    return {
      taxYear,
      filingStatus,
      ordinaryIncome,
      qualifiedDividends
    };
  } catch {
    // Fall back to regex on any LLM error
    return fallbackRegexExtraction(message);
  }
}

function isValidFilingStatus(value: unknown): value is FilingStatus {
  return (
    value === 'single' ||
    value === 'marriedFilingJointly' ||
    value === 'marriedFilingSeparately' ||
    value === 'headOfHousehold'
  );
}

function extractAllYears(conversationHistory: { role: string; content: string }[]): number[] {
  const years = new Set<number>();
  for (const msg of conversationHistory) {
    const matches = msg.content.match(/\b(20\d{2})\b/g);
    if (matches) {
      matches.forEach((y) => {
        const year = Number(y);
        if (Number.isFinite(year)) years.add(year);
      });
    }
  }
  return Array.from(years).sort((a, b) => b - a); // Most recent first
}

function extractAllFilingStatuses(conversationHistory: { role: string; content: string }[]): string[] {
  const statuses = new Set<string>();
  const fullText = conversationHistory.map((m) => m.content).join(' ').toLowerCase();

  if (/\b(head of household|hoh)\b/.test(fullText)) statuses.add('headOfHousehold');
  if (/\b(married filing jointly|mfj)\b/.test(fullText)) statuses.add('marriedFilingJointly');
  if (/\b(married filing separately|mfs)\b/.test(fullText)) statuses.add('marriedFilingSeparately');
  if (/\bsingle\b/.test(fullText)) statuses.add('single');

  return Array.from(statuses);
}

function extractAllNumbers(conversationHistory: { role: string; content: string }[]): number[] {
  const numbers = new Set<number>();
  for (const msg of conversationHistory) {
    const matches = msg.content.match(/\$?(\d{1,3}(?:,\d{3})*(?:\.\d+)?)|(\d+k)/gi);
    if (matches) {
      matches.forEach((numStr) => {
        const cleaned = numStr.replace(/[$,k]/g, '');
        const num = Number(cleaned);
        if (Number.isFinite(num) && num > 0) {
          // Scale 'k' suffix
          const scaled = numStr.toLowerCase().includes('k') ? num * 1000 : num;
          numbers.add(scaled);
        }
      });
    }
  }
  return Array.from(numbers).sort((a, b) => b - a); // Largest first
}

function fallbackRegexExtraction(message: string): {
  taxYear?: number;
  filingStatus?: FilingStatus;
  ordinaryIncome?: number;
  qualifiedDividends?: number;
} {
  return {
    taxYear: parseTaxYear(message),
    filingStatus: parseFilingStatus(message),
    ordinaryIncome: parseOrdinaryIncome(message),
    qualifiedDividends: parseQualifiedDividends(message)
  };
}

function parseActivity(value: unknown): ParsedActivity | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const activity = value as Record<string, unknown>;
  const type = asType(activity.type);
  const quantity = asPositiveNumber(activity.quantity);
  const unitPrice = asNonNegativeNumber(activity.unitPrice);
  const fee = asNonNegativeNumber(activity.fee) ?? 0;
  const dateMs = asDateMs(activity.date);
  if (!type || quantity === undefined || unitPrice === undefined || dateMs === undefined) {
    return undefined;
  }

  const symbolProfile =
    activity.SymbolProfile &&
    typeof activity.SymbolProfile === 'object' &&
    !Array.isArray(activity.SymbolProfile)
      ? (activity.SymbolProfile as Record<string, unknown>)
      : undefined;

  const symbolFromProfile =
    symbolProfile && typeof symbolProfile.symbol === 'string' ? String(symbolProfile.symbol) : undefined;

  const symbol =
    symbolFromProfile ??
    (typeof activity.symbol === 'string' ? activity.symbol : undefined) ??
    (typeof activity.symbolProfileId === 'string' ? activity.symbolProfileId : undefined);

  if (!symbol) return undefined;

  // Extract asset class metadata from SymbolProfile
  const assetClass = symbolProfile && typeof symbolProfile.assetClass === 'string' ? symbolProfile.assetClass : undefined;
  const assetSubClass =
    symbolProfile && typeof symbolProfile.assetSubClass === 'string' ? symbolProfile.assetSubClass : undefined;

  // Determine if this is a US equity (STOCK assetSubClass with US in countries)
  const countries = symbolProfile && Array.isArray(symbolProfile.countries) ? symbolProfile.countries : [];
  const isUSEquity =
    assetSubClass === 'STOCK' && countries.some((c) => isObject(c) && (c as Record<string, unknown>).code === 'US');

  return {
    type,
    quantity,
    unitPrice,
    fee,
    dateMs,
    symbol,
    assetClass,
    assetSubClass,
    isUSEquity
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseTaxYear(message: string): number | undefined {
  const match = /\b(20\d{2})\b/.exec(message);
  if (!match) return undefined;
  const year = Number(match[1]);
  return Number.isFinite(year) ? year : undefined;
}

function parseFilingStatus(message: string): FilingStatus | undefined {
  const normalized = message.toLowerCase();
  if (/\b(head of household|hoh)\b/.test(normalized)) return 'headOfHousehold';
  if (/\b(married filing jointly|mfj)\b/.test(normalized)) return 'marriedFilingJointly';
  if (/\b(married filing separately|mfs)\b/.test(normalized)) return 'marriedFilingSeparately';
  if (/\b(single)\b/.test(normalized)) return 'single';
  return undefined;
}

function parseOrdinaryIncome(message: string): number | undefined {
  const match =
    /\b(?:ordinary income|income)\s*(?:is|=|:)?\s*\$?([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)\b/i.exec(
      message
    );
  if (!match?.[1]) return undefined;
  const parsed = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseQualifiedDividends(message: string): number | undefined {
  const match =
    /\b(?:qualified dividends?)\s*(?:is|=|:)?\s*\$?([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)\b/i.exec(
      message
    );
  if (!match?.[1]) return undefined;
  const parsed = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function asType(value: unknown): ParsedActivity['type'] | undefined {
  if (value === 'BUY' || value === 'SELL' || value === 'DIVIDEND' || value === 'INTEREST' || value === 'FEE' || value === 'LIABILITY') {
    return value;
  }
  return undefined;
}

function asPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function asNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function asDateMs(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

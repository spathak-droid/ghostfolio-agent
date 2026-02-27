/**
 * Purpose: Estimate federal tax impact from portfolio activities (realized gains/losses and income).
 * Inputs: Ghostfolio activities via GET /api/v1/order and user message hints (filing status, tax year, ordinary income).
 * Outputs: Deterministic tax estimate with realized P/L breakdown, assumptions, sources, and data_as_of.
 * Failure modes: missing/invalid activity fields are skipped and surfaced in assumptions; missing tax table returns structured error.
 * When the user does not provide ordinary income, we return a concrete example scenario (single, $60k/year) so the response is never all zeros.
 */

/** Default annual income for the illustrative scenario when user does not provide income (single filer, 2026). */
const DEFAULT_SCENARIO_ANNUAL_INCOME = 60_000;

import { GhostfolioClient } from '../clients';
import { loadFederalTaxTable, calculateTaxFromBrackets } from '../tax/tax-tables';
import { toToolErrorPayload } from './tool-error';

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
}

export async function taxEstimateTool({
  client,
  impersonationId,
  message,
  range,
  take,
  token
}: {
  client: GhostfolioClient;
  impersonationId?: string;
  message: string;
  range?: string;
  take?: number;
  token?: string;
}) {
  const assumptions: string[] = [];
  try {
    const taxYear = parseTaxYear(message) ?? 2026;
    const hasExplicitTaxYear = parseTaxYear(message) !== undefined;
    if (!hasExplicitTaxYear) {
      assumptions.push('Tax year not provided; defaulted to 2026.');
    }
    const filingStatus = parseFilingStatus(message) ?? 'single';
    const hasExplicitFilingStatus = parseFilingStatus(message) !== undefined;
    if (!hasExplicitFilingStatus) {
      assumptions.push('Filing status not provided; defaulted to single.');
    }
    const parsedOrdinaryIncome = parseOrdinaryIncome(message);
    const ordinaryIncome = parsedOrdinaryIncome ?? 0;
    const hasExplicitOrdinaryIncome = parsedOrdinaryIncome !== undefined;

    const taxTable = loadFederalTaxTable(taxYear);
    const raw = await client.getTransactions({ impersonationId, range, take, token });
    const activities = Array.isArray(raw.activities) ? raw.activities : [];
    const taxActivities = activities
      .map(parseActivity)
      .filter((item): item is ParsedActivity => item !== undefined)
      .sort((a, b) => a.dateMs - b.dateMs);

    const totals = calculateTaxFromActivities({ activities: taxActivities, assumptions });
    const estimate = calculateFederalEstimate({
      filingStatus,
      ordinaryIncome,
      taxTable,
      totals
    });
    const scenarioEstimate = !hasExplicitOrdinaryIncome
      ? calculateFederalEstimate({
          filingStatus,
          ordinaryIncome: DEFAULT_SCENARIO_ANNUAL_INCOME,
          taxTable,
          totals
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

    const missingParams: { param: string; question: string }[] = [];
    if (!hasExplicitTaxYear) {
      missingParams.push({
        param: 'tax_year',
        question: 'Which tax year do you want the estimate for? (e.g. 2026)'
      });
    }
    if (!hasExplicitFilingStatus) {
      missingParams.push({
        param: 'filing_status',
        question:
          'What is your filing status? (e.g. single, married filing jointly, head of household, married filing separately)'
      });
    }
    if (!hasExplicitOrdinaryIncome) {
      missingParams.push({
        param: 'ordinary_income',
        question:
          'What is your approximate annual ordinary income in USD? (e.g. from W-2, self-employment, other taxable income)'
      });
    }

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
        interest: round2(totals.interest)
      },
      estimate: {
        taxable_ordinary_income: round2(displayEstimate.taxableOrdinaryIncome),
        taxable_long_term_gains: round2(displayEstimate.taxableLongTermGains),
        ordinary_tax: round2(displayEstimate.ordinaryTax),
        long_term_capital_gains_tax: round2(displayEstimate.longTermTax),
        niit: round2(displayEstimate.niitTax),
        total_estimated_federal_tax: round2(displayEstimate.totalEstimatedFederalTax),
        effective_tax_rate: round4(effectiveRate)
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
        `(ordinary ${round2(displayEstimate.ordinaryTax)} + LT gains ${round2(displayEstimate.longTermTax)} + NIIT ${round2(displayEstimate.niitTax)}).`,
      answer:
        askBlock +
        'Not financial advice. Please consult with your financial advisor and a qualified tax professional before making decisions.',
      data_as_of: new Date().toISOString(),
      sources: ['ghostfolio_api', `docs/agent/tax/us/federal/${taxYear}.json`]
    };
  } catch (error) {
    const toolError = toToolErrorPayload(error);
    return {
      success: false,
      answer:
        `Could not estimate taxes: ${toolError.message}` +
        '\n\nNot financial advice.\n\nPlease consult with your financial advisor and a qualified tax professional before making decisions.',
      summary: `Tax estimate failed: ${toolError.message}`,
      error: toolError,
      data_as_of: new Date().toISOString(),
      sources: ['ghostfolio_api']
    };
  }
}

function calculateTaxFromActivities({
  activities,
  assumptions
}: {
  activities: ParsedActivity[];
  assumptions: string[];
}) {
  const lotsBySymbol = new Map<string, Lot[]>();
  let shortTermGains = 0;
  let shortTermLosses = 0;
  let longTermGains = 0;
  let longTermLosses = 0;
  let dividends = 0;
  let interest = 0;

  for (const activity of activities) {
    if (activity.type === 'DIVIDEND') {
      dividends += activity.unitPrice * activity.quantity;
      continue;
    }
    if (activity.type === 'INTEREST') {
      interest += activity.unitPrice * activity.quantity;
      continue;
    }
    if (activity.type === 'BUY') {
      const totalCost = activity.unitPrice * activity.quantity + activity.fee;
      const lot: Lot = {
        acquiredAtMs: activity.dateMs,
        quantityRemaining: activity.quantity,
        unitCost: totalCost / activity.quantity
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
      if (realized >= 0) {
        if (isLongTerm) longTermGains += realized;
        else shortTermGains += realized;
      } else if (isLongTerm) {
        longTermLosses += Math.abs(realized);
      } else {
        shortTermLosses += Math.abs(realized);
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
      // Treat sell fee as additional loss (or reduced gain) in short-term bucket by default.
      shortTermLosses += Math.abs(feeAdjustment);
    }
  }

  const netCapital = shortTermGains - shortTermLosses + (longTermGains - longTermLosses);
  assumptions.push('FIFO lot matching used for cost basis.');
  assumptions.push('All dividends treated as non-qualified unless explicitly classified.');
  return {
    shortTermGains,
    shortTermLosses,
    longTermGains,
    longTermLosses,
    dividends,
    interest,
    netCapital
  };
}

function calculateFederalEstimate({
  filingStatus,
  ordinaryIncome,
  taxTable,
  totals
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
}) {
  const stNet = totals.shortTermGains - totals.shortTermLosses;
  const ltNet = totals.longTermGains - totals.longTermLosses;
  const taxableLongTermGains = Math.max(0, ltNet + Math.min(0, stNet));
  const taxableShortTermComponent = Math.max(0, stNet + Math.min(0, ltNet));
  const maxOffset = taxTable.capitalLossRules.maxOrdinaryOffset;
  const ordinaryLossOffset =
    totals.netCapital < 0 ? Math.min(maxOffset, Math.abs(totals.netCapital)) : 0;

  const standardDeduction = taxTable.standardDeduction[filingStatus];
  const taxableOrdinaryIncome = Math.max(
    0,
    ordinaryIncome - standardDeduction + taxableShortTermComponent + totals.dividends + totals.interest - ordinaryLossOffset
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

  const symbolFromProfile =
    activity.SymbolProfile &&
    typeof activity.SymbolProfile === 'object' &&
    !Array.isArray(activity.SymbolProfile) &&
    typeof (activity.SymbolProfile as Record<string, unknown>).symbol === 'string'
      ? String((activity.SymbolProfile as Record<string, unknown>).symbol)
      : undefined;

  const symbol =
    symbolFromProfile ??
    (typeof activity.symbol === 'string' ? activity.symbol : undefined) ??
    (typeof activity.symbolProfileId === 'string' ? activity.symbolProfileId : undefined);

  if (!symbol) return undefined;
  return {
    type,
    quantity,
    unitPrice,
    fee,
    dateMs,
    symbol
  };
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

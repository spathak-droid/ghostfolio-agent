/**
 * Purpose: Load and validate US federal tax tables from docs.
 * Inputs: tax year (number), taxable income values for bracket calculations.
 * Outputs: typed federal tax table object and deterministic bracket tax computation.
 * Failure modes: throws on missing file, invalid JSON shape, invalid bracket definitions.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

type FilingStatus =
  | 'single'
  | 'marriedFilingJointly'
  | 'marriedFilingSeparately'
  | 'headOfHousehold';

interface TaxBracket {
  upTo: number | null;
  rate: number;
}

interface StandardDeduction {
  single: number;
  marriedFilingJointly: number;
  marriedFilingSeparately: number;
  headOfHousehold: number;
}

interface NiitConfig {
  threshold: StandardDeduction;
  rate: number;
}

interface CapitalLossRules {
  maxOrdinaryOffset: number;
}

interface AmtConfig {
  exemptionAmount: StandardDeduction;
  phaseoutStartsAt: StandardDeduction;
  rates: TaxBracket[];
}

interface OptionalConfig {
  AMT: AmtConfig;
}

export interface FederalTaxTable {
  taxYear: number;
  standardDeduction: StandardDeduction;
  ordinaryBrackets: Record<FilingStatus, TaxBracket[]>;
  longTermCapitalGainsBrackets: Record<FilingStatus, TaxBracket[]>;
  niit: NiitConfig;
  capitalLossRules: CapitalLossRules;
  optional?: OptionalConfig;
}

export function loadFederalTaxTable(year: number): FederalTaxTable {
  const filePath = resolve(process.cwd(), `docs/agent/tax/us/federal/${year}.json`);
  if (!existsSync(filePath)) {
    throw new Error(`tax table file not found: ${filePath}`);
  }

  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  validateFederalTaxTable(raw, year);
  return raw;
}

export function calculateTaxFromBrackets(
  taxableIncome: number,
  brackets: readonly TaxBracket[]
): number {
  if (!Number.isFinite(taxableIncome) || taxableIncome <= 0) {
    return 0;
  }

  let previousCap = 0;
  let remaining = taxableIncome;
  let total = 0;

  for (const bracket of brackets) {
    if (remaining <= 0) break;
    const cap = bracket.upTo ?? Number.POSITIVE_INFINITY;
    const span = Math.max(0, cap - previousCap);
    const taxableAtThisRate = Math.min(remaining, span);
    total += taxableAtThisRate * bracket.rate;
    remaining -= taxableAtThisRate;
    previousCap = cap;
  }

  return total;
}

function validateFederalTaxTable(value: unknown, expectedYear: number): asserts value is FederalTaxTable {
  if (!isObject(value)) {
    throw new Error('invalid tax table: root must be object');
  }

  if (value.taxYear !== expectedYear) {
    throw new Error(`invalid tax table: taxYear must be ${expectedYear}`);
  }

  validateStandardDeduction(value.standardDeduction, 'standardDeduction');
  validateBracketMap(value.ordinaryBrackets, 'ordinaryBrackets');
  validateBracketMap(value.longTermCapitalGainsBrackets, 'longTermCapitalGainsBrackets');
  validateNiit(value.niit);
  validateCapitalLossRules(value.capitalLossRules);
}

function validateNiit(value: unknown): void {
  if (!isObject(value)) {
    throw new Error('invalid tax table: niit must be object');
  }
  validateStandardDeduction(value.threshold, 'niit.threshold');
  if (!isFiniteNonNegativeNumber(value.rate)) {
    throw new Error('invalid tax table: niit.rate must be finite non-negative number');
  }
}

function validateCapitalLossRules(value: unknown): void {
  if (!isObject(value)) {
    throw new Error('invalid tax table: capitalLossRules must be object');
  }
  if (!isFiniteNonNegativeNumber(value.maxOrdinaryOffset)) {
    throw new Error('invalid tax table: capitalLossRules.maxOrdinaryOffset must be finite non-negative number');
  }
}

function validateStandardDeduction(value: unknown, label: string): asserts value is StandardDeduction {
  if (!isObject(value)) {
    throw new Error(`invalid tax table: ${label} must be object`);
  }
  const keys: FilingStatus[] = [
    'single',
    'marriedFilingJointly',
    'marriedFilingSeparately',
    'headOfHousehold'
  ];
  for (const key of keys) {
    if (!isFiniteNonNegativeNumber(value[key])) {
      throw new Error(`invalid tax table: ${label}.${key} must be finite non-negative number`);
    }
  }
}

function validateBracketMap(
  value: unknown,
  label: string
): asserts value is Record<FilingStatus, TaxBracket[]> {
  if (!isObject(value)) {
    throw new Error(`invalid tax table: ${label} must be object`);
  }
  const keys: FilingStatus[] = [
    'single',
    'marriedFilingJointly',
    'marriedFilingSeparately',
    'headOfHousehold'
  ];
  for (const key of keys) {
    validateBrackets(value[key], `${label}.${key}`);
  }
}

function validateBrackets(value: unknown, label: string): asserts value is TaxBracket[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`invalid tax table: ${label} must be non-empty array`);
  }

  let previousCap = 0;
  for (let index = 0; index < value.length; index++) {
    const bracket = value[index];
    if (!isObject(bracket)) {
      throw new Error(`invalid tax table: ${label}[${index}] must be object`);
    }

    const rate = bracket.rate;
    const upTo = bracket.upTo;
    if (!isFiniteNonNegativeNumber(rate)) {
      throw new Error(`invalid tax table: ${label}[${index}].rate must be finite non-negative number`);
    }
    if (upTo !== null && !isFiniteNonNegativeNumber(upTo)) {
      throw new Error(`invalid tax table: ${label}[${index}].upTo must be null or finite non-negative number`);
    }
    if (typeof upTo === 'number' && upTo < previousCap) {
      throw new Error(`invalid tax table: ${label}[${index}].upTo must be non-decreasing`);
    }
    if (typeof upTo === 'number') {
      previousCap = upTo;
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

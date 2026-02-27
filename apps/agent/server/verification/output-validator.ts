import type { AgentToolCall } from '../types';

const FACTUAL_TOOLS = new Set([
  'market_data',
  'market_data_lookup',
  'fact_check',
  'fact_compliance_check',
  'compliance_check',
  'portfolio_analysis',
  'holdings_analysis',
  'static_analysis',
  'transaction_categorize',
  'transaction_timeline'
]);

const SEVERE_VALIDATION_ERRORS = new Set([
  'VALIDATION_EMPTY_ANSWER',
  'VALIDATION_NON_FINITE_NUMBER',
  'VALIDATION_INCOMPLETE_COMPLIANCE_GUIDANCE'
]);

export interface OutputValidationChecks {
  completeness: boolean;
  numeric: boolean;
  provenance: boolean;
  schema: boolean;
}

export interface OutputValidationResult {
  checks: OutputValidationChecks;
  errors: string[];
  isValid: boolean;
  severeErrors: string[];
  warnings: string[];
}

export function validateOutput(
  input:
    | string
    | {
        answer: string;
        intent?: 'finance' | 'general';
        requiresProvenance?: boolean;
        toolCalls?: AgentToolCall[];
      }
): OutputValidationResult {
  const answer = typeof input === 'string' ? input : input.answer;
  const toolCalls = typeof input === 'string' ? [] : input.toolCalls ?? [];
  const intent = typeof input === 'string' ? 'finance' : input.intent ?? 'finance';
  const requiresProvenance =
    typeof input === 'string'
      ? false
      : input.requiresProvenance ?? intent === 'finance';

  const errors: string[] = [];
  const warnings: string[] = [];
  const checks: OutputValidationChecks = {
    completeness: true,
    numeric: true,
    provenance: true,
    schema: true
  };

  if (answer.trim().length === 0) {
    checks.schema = false;
    errors.push('VALIDATION_EMPTY_ANSWER');
  }

  const nonFiniteCount = countNonFiniteNumbers(toolCalls);
  if (nonFiniteCount > 0) {
    checks.numeric = false;
    errors.push('VALIDATION_NON_FINITE_NUMBER');
  }

  if (requiresProvenance && !hasRequiredProvenance(toolCalls)) {
    checks.provenance = false;
    warnings.push('VALIDATION_MISSING_PROVENANCE');
  }

  if (hasComplianceViolations(toolCalls) && !hasActionableComplianceGuidance(answer)) {
    checks.completeness = false;
    errors.push('VALIDATION_INCOMPLETE_COMPLIANCE_GUIDANCE');
  }

  const severeErrors = errors.filter((code) => SEVERE_VALIDATION_ERRORS.has(code));
  if (warnings.includes('VALIDATION_MISSING_PROVENANCE')) {
    warnings.push('Missing provenance metadata for one or more factual tool outputs.');
  }

  return {
    checks,
    errors,
    isValid: errors.length === 0,
    severeErrors,
    warnings
  };
}

function countNonFiniteNumbers(toolCalls: AgentToolCall[]): number {
  let count = 0;
  for (const call of toolCalls) {
    count += countNonFiniteInValue(call.result);
  }
  return count;
}

function countNonFiniteInValue(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? 0 : 1;
  }
  if (!value || typeof value !== 'object') {
    return 0;
  }
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + countNonFiniteInValue(item), 0);
  }

  return Object.values(value).reduce(
    (total, item) => total + countNonFiniteInValue(item),
    0
  );
}

function hasRequiredProvenance(toolCalls: AgentToolCall[]): boolean {
  const factualCalls = toolCalls.filter(
    ({ success, toolName }) => success && FACTUAL_TOOLS.has(toolName)
  );
  if (factualCalls.length === 0) {
    return true;
  }

  return factualCalls.every(({ result }) => {
    const record = isRecord(result) ? result : {};
    const hasSources = Array.isArray(record.sources) && record.sources.length > 0;
    const hasDataAsOf =
      typeof record.data_as_of === 'string' && record.data_as_of.trim().length > 0;
    return hasSources && hasDataAsOf;
  });
}

function hasComplianceViolations(toolCalls: AgentToolCall[]): boolean {
  for (const call of toolCalls) {
    if (!call.success) continue;
    const result = isRecord(call.result) ? call.result : {};

    if (call.toolName === 'compliance_check') {
      if (Array.isArray(result.violations) && result.violations.length > 0) {
        return true;
      }
    }

    if (call.toolName === 'fact_compliance_check' && isRecord(result.compliance_check)) {
      const nested = result.compliance_check;
      if (Array.isArray(nested.violations) && nested.violations.length > 0) {
        return true;
      }
    }
  }
  return false;
}

function hasActionableComplianceGuidance(answer: string): boolean {
  const normalized = answer.toLowerCase();
  return (
    /\bnext step\b/.test(normalized) ||
    /\bbefore executing\b/.test(normalized) ||
    /\byou should not execute\b/.test(normalized) ||
    /\bresolve\b/.test(normalized) ||
    /\breview\b/.test(normalized)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

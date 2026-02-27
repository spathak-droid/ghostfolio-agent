/**
 * Domain constraints and verification flags for agent answers.
 *
 * PORTFOLIO VS CASH (CRITICAL):
 * - USD is CASH, not a holding. Never include USD in holdings or allocation.
 * - Portfolio/holdings/allocation/performance: exclude USD; show cash separately as "Cash (USD)" if available.
 * - Balance/cash questions: include USD cash balance in the answer.
 * - If tool results include USD as a holding, treat as data issue: remove from holdings/allocation and add flag USD_SHOULD_BE_CASH_NOT_HOLDING.
 * (USD exclusion and flag are applied in portfolio-analysis tool and tool-result-synthesizer.)
 */
export function applyDomainConstraints(
  answer: string,
  existingFlags: string[],
  options?: { intent?: 'finance' | 'general' }
) {
  const flags = [...existingFlags];
  const lowered = answer.toLowerCase();

  if (
    lowered.includes('invest all your money') ||
    lowered.includes('guaranteed return') ||
    lowered.includes('you should invest all')
  ) {
    flags.push('deterministic_financial_advice');
  }

  const intent = options?.intent ?? 'finance';
  const effectiveFlags =
    intent === 'general'
      ? flags.filter((flag) => flag !== 'missing_provenance')
      : flags;
  const nonFatalFlags = new Set<string>(['USD_SHOULD_BE_CASH_NOT_HOLDING']);
  const fatalFlags = effectiveFlags.filter((flag) => !nonFatalFlags.has(flag));

  return {
    flags: effectiveFlags,
    isValid: fatalFlags.length === 0
  };
}

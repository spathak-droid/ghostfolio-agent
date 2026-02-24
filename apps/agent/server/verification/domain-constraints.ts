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

  return {
    flags: effectiveFlags,
    isValid: effectiveFlags.length === 0
  };
}

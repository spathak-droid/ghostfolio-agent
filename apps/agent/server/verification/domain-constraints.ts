export function applyDomainConstraints(answer: string, existingFlags: string[]) {
  const flags = [...existingFlags];
  const lowered = answer.toLowerCase();

  if (
    lowered.includes('invest all your money') ||
    lowered.includes('guaranteed return') ||
    lowered.includes('you should invest all')
  ) {
    flags.push('deterministic_financial_advice');
  }

  return {
    flags,
    isValid: flags.length === 0
  };
}

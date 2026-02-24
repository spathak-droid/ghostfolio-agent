export function scoreConfidence({ hasErrors, invalid }: { hasErrors: boolean; invalid: boolean }) {
  if (hasErrors) {
    return 0.3;
  }

  if (invalid) {
    return 0.45;
  }

  return 0.82;
}

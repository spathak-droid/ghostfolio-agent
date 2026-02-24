export function scoreConfidence({
  hasErrors,
  invalid,
  hasCriticalFlags
}: {
  hasErrors: boolean;
  invalid: boolean;
  hasCriticalFlags?: boolean;
}) {
  if (hasErrors) {
    return 0.3;
  }

  if (hasCriticalFlags) {
    return 0.4;
  }

  if (invalid) {
    return 0.45;
  }

  return 0.82;
}

export const MAX_USD_TRANSACTION_AMOUNT = 100_000;

export function isUsdTransactionCapExceeded({
  amount,
  currency
}: {
  amount: number;
  currency: string;
}): boolean {
  return (
    Number.isFinite(amount) &&
    amount > MAX_USD_TRANSACTION_AMOUNT &&
    currency.trim().toUpperCase() === 'USD'
  );
}

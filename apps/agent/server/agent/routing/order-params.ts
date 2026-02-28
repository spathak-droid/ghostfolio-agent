/**
 * Order parameter inference: Extract order details from user message text.
 * Used to infer create_order parameters from natural language.
 */

import type { CreateOrderParams } from '../../types';

export function mergeCreateOrderParams(
  ...candidates: (CreateOrderParams | Partial<CreateOrderParams> | undefined)[]
): CreateOrderParams | undefined {
  const merged = Object.assign({}, ...candidates.filter(Boolean)) as CreateOrderParams;
  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function inferCreateOrderParamsFromMessage(
  message: string
): Partial<CreateOrderParams> | undefined {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  const inferred: Partial<CreateOrderParams> = {};
  if (/\b(dividend|divident)\b/.test(normalized)) {
    inferred.type = 'DIVIDEND';
  } else if (/\b(fee|charges?)\b/.test(normalized)) {
    inferred.type = 'FEE';
  } else if (/\b(interest)\b/.test(normalized)) {
    inferred.type = 'INTEREST';
  } else if (/\b(liability|liabilty|liablity|mortgage|loan|debt)\b/.test(normalized)) {
    inferred.type = 'LIABILITY';
  } else if (/\b(sell|sold)\b/.test(normalized)) {
    inferred.type = 'SELL';
  } else if (/\b(buy|purchase|long)\b/.test(normalized)) {
    inferred.type = 'BUY';
  }

  if (/\bsolana\b|\bsol-usd\b|\bsolusd\b|\bsol\b/.test(normalized)) {
    inferred.symbol = 'SOL-USD';
  } else if (/\bbitcoin\b|\bbtc-usd\b|\bbtcusd\b|\bbtc\b/.test(normalized)) {
    inferred.symbol = 'BTC-USD';
  } else if (/\bethereum\b|\beth-usd\b|\bethusd\b|\beth\b/.test(normalized)) {
    inferred.symbol = 'ETH-USD';
  } else if (/\bapple\b|\baapl\b/.test(normalized)) {
    inferred.symbol = 'AAPL';
  } else if (/\btesla\b|\btsla\b/.test(normalized)) {
    inferred.symbol = 'TSLA';
  } else if (/\b(mortgage)\b/.test(normalized)) {
    inferred.symbol = 'MORTGAGE';
  } else if (/\b(loan)\b/.test(normalized)) {
    inferred.symbol = 'LOAN';
  } else if (/\b(debt)\b/.test(normalized)) {
    inferred.symbol = 'DEBT';
  }

  const amountRegex = /\b(?:amount\s*(?:to)?|of)\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)\b/;
  const amountMatch = amountRegex.exec(normalized);
  if (amountMatch?.[1] && inferred.unitPrice === undefined) {
    const parsed = Number(amountMatch[1].replace(/,/g, ''));
    if (Number.isFinite(parsed) && parsed > 0) {
      inferred.unitPrice = parsed;
    }
  }

  const quantityRegex = /\b(?:buy|sell)(?:\s+me)?\s+([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)\b/;
  const quantityMatch = quantityRegex.exec(normalized);
  if (quantityMatch?.[1]) {
    const parsed = Number(quantityMatch[1].replace(/,/g, ''));
    if (Number.isFinite(parsed) && parsed > 0) {
      inferred.quantity = parsed;
    }
  }

  return Object.keys(inferred).length > 0 ? inferred : undefined;
}

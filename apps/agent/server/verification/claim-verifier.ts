import { symbolToCoinGeckoId } from '../coingecko-client';
import type { AgentToolCall } from '../types';

const PRICE_QUERY_PATTERN =
  /\b(price|quote|current price|trading at|how much is|what is .* price)\b/i;
const PRICE_CLAIM_PATTERN = /\b([A-Z][A-Z0-9-]{1,11})\b[^0-9]{0,16}(?:USD\s*)?(\d+(?:\.\d+)?)/g;
const PRICE_LINE_PATTERN = /\b(latest prices|market data|fact check|price|quote|trading at)\b/i;
const PRICE_TOLERANCE = 0.02;

export interface ClaimVerificationResult {
  flags: string[];
  unsupportedClaims: string[];
}

/**
 * Purpose: Verify that material price claims are grounded in tool evidence.
 * Inputs: synthesized answer text, user message, and tool execution results.
 * Outputs: verification flags and unsupported claim details.
 * Failure modes: malformed tool payloads are ignored; verifier remains conservative.
 */
export function verifyClaimsAgainstToolEvidence({
  answer,
  message,
  toolCalls
}: {
  answer: string;
  message: string;
  toolCalls: AgentToolCall[];
}): ClaimVerificationResult {
  const flags = new Set<string>();
  const unsupportedClaims: string[] = [];

  const supportedClaims = collectSupportedPriceClaims(toolCalls);
  const enforcePriceGrounding = shouldEnforcePriceGrounding({ message, toolCalls });
  appendFactCheckFlags({ flags, message, toolCalls });

  if (enforcePriceGrounding) {
    for (const extracted of extractAnswerPriceClaims(answer)) {
      const supported = supportedClaims.get(extracted.symbol);
      if (!supported || !isWithinTolerance(extracted.value, supported)) {
        unsupportedClaims.push(`${extracted.rawSymbol}:${extracted.value}`);
      }
    }
  }

  if (unsupportedClaims.length > 0) {
    flags.add('unsupported_claim');
  }

  return {
    flags: [...flags],
    unsupportedClaims
  };
}

function appendFactCheckFlags({
  flags,
  message,
  toolCalls
}: {
  flags: Set<string>;
  message: string;
  toolCalls: AgentToolCall[];
}) {
  const factCheckComparisons = new Set<string>();
  const priceQuery = PRICE_QUERY_PATTERN.test(message);
  const marketSymbols = new Set<string>();

  for (const call of toolCalls) {
    if (!call.success) continue;

    if (call.toolName === 'fact_check') {
      const comparisons = Array.isArray(call.result.comparisons) ? call.result.comparisons : [];
      for (const item of comparisons) {
        if (!isRecord(item)) continue;
        const symbol = normalizeSymbol(item.symbol);
        if (!symbol) continue;
        factCheckComparisons.add(symbol);
        if (item.match === false) {
          flags.add('fact_check_mismatch');
        }
      }
    }

    if (call.toolName === 'fact_compliance_check' && isRecord(call.result.fact_check)) {
      const nestedFact = call.result.fact_check;
      const comparisons = Array.isArray(nestedFact.comparisons) ? nestedFact.comparisons : [];
      for (const item of comparisons) {
        if (!isRecord(item)) continue;
        const symbol = normalizeSymbol(item.symbol);
        if (!symbol) continue;
        factCheckComparisons.add(symbol);
        if (item.match === false) {
          flags.add('fact_check_mismatch');
        }
      }
    }

    if (call.toolName === 'market_data') {
      const symbols = Array.isArray(call.result.symbols) ? call.result.symbols : [];
      for (const item of symbols) {
        if (!isRecord(item)) continue;
        const symbol = normalizeSymbol(item.symbol);
        if (symbol) {
          marketSymbols.add(symbol);
        }
      }
    }
  }

  if (!priceQuery) return;

  for (const symbol of marketSymbols) {
    if (!isSecondSourceEligible(symbol)) continue;
    if (!factCheckComparisons.has(symbol)) {
      flags.add('fact_check_missing_for_price_claim');
    }
  }
}

function collectSupportedPriceClaims(toolCalls: AgentToolCall[]): Map<string, number> {
  const claims = new Map<string, number>();

  for (const call of toolCalls) {
    if (!call.success) continue;
    const result = isRecord(call.result) ? call.result : {};

    if (call.toolName === 'market_data_lookup') {
      const prices = Array.isArray(result.prices) ? result.prices : [];
      for (const item of prices) {
        if (!isRecord(item)) continue;
        const symbol = normalizeSymbol(item.symbol);
        const value = asNumber(item.value);
        if (symbol && value !== undefined) {
          claims.set(symbol, value);
        }
      }
    }

    if (call.toolName === 'market_data') {
      const symbols = Array.isArray(result.symbols) ? result.symbols : [];
      for (const item of symbols) {
        if (!isRecord(item)) continue;
        const symbol = normalizeSymbol(item.symbol);
        const value = asNumber(item.currentPrice);
        if (symbol && value !== undefined) {
          claims.set(symbol, value);
        }
      }
    }

    if (call.toolName === 'fact_check') {
      const comparisons = Array.isArray(result.comparisons) ? result.comparisons : [];
      for (const item of comparisons) {
        if (!isRecord(item)) continue;
        const symbol = normalizeSymbol(item.symbol);
        const value = asNumber(item.primaryPrice);
        if (symbol && value !== undefined) {
          claims.set(symbol, value);
        }
      }
    }

    if (call.toolName === 'fact_compliance_check') {
      const nestedFact = isRecord(result.fact_check) ? result.fact_check : {};
      const comparisons = Array.isArray(nestedFact.comparisons) ? nestedFact.comparisons : [];
      for (const item of comparisons) {
        if (!isRecord(item)) continue;
        const symbol = normalizeSymbol(item.symbol);
        const value = asNumber(item.primaryPrice);
        if (symbol && value !== undefined) {
          claims.set(symbol, value);
        }
      }
    }
  }

  return claims;
}

function extractAnswerPriceClaims(answer: string): { rawSymbol: string; symbol: string; value: number }[] {
  const claims: { rawSymbol: string; symbol: string; value: number }[] = [];

  const lines = answer
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => PRICE_LINE_PATTERN.test(line));
  for (const line of lines) {
    for (const match of line.matchAll(PRICE_CLAIM_PATTERN)) {
      const rawSymbol = match[1];
      const valueToken = match[2];
      const value = Number(valueToken);
      const symbol = normalizeSymbol(rawSymbol);
      if (!symbol || !Number.isFinite(value)) continue;
      if (symbol === 'USD') continue;
      const matchStart = match.index ?? -1;
      const nextChar = matchStart >= 0 ? line[matchStart + match[0].length] : undefined;
      if (nextChar === '%') continue;
      claims.push({ rawSymbol, symbol, value });
    }
  }

  return claims;
}

function shouldEnforcePriceGrounding({
  message,
  toolCalls
}: {
  message: string;
  toolCalls: AgentToolCall[];
}) {
  const hasPriceTool = toolCalls.some(
    ({ toolName }) =>
      toolName === 'fact_check' ||
      toolName === 'fact_compliance_check' ||
      toolName === 'market_data' ||
      toolName === 'market_data_lookup'
  );
  if (hasPriceTool) {
    return true;
  }

  if (PRICE_QUERY_PATTERN.test(message)) {
    return true;
  }

  return false;
}

function normalizeSymbol(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  const cleaned = input.toUpperCase().trim();
  if (!cleaned) return undefined;
  const canonical = cleaned.replace(/[^A-Z0-9]/g, '');
  if (!canonical) return undefined;
  if (canonical.endsWith('USD') && canonical.length > 3) {
    return canonical.slice(0, -3);
  }
  return canonical;
}

function isSecondSourceEligible(symbol: string): boolean {
  const canonical = `${symbol}-USD`;
  return Boolean(symbolToCoinGeckoId(canonical));
}

function isWithinTolerance(value: number, expected: number): boolean {
  return Math.abs(value - expected) <= PRICE_TOLERANCE;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

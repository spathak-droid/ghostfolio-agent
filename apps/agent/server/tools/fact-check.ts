/**
 * Fact-check tool: cross-check market_data (price) against CoinGecko as second source.
 *
 * Purpose: Verify price claims for crypto symbols by comparing Ghostfolio primary
 *          result with CoinGecko; returns match/mismatch and provenance.
 * Inputs: message, optional symbols; uses Ghostfolio client and CoinGecko client.
 * Outputs: match, primary, secondary, discrepancy?, answer, sources, data_as_of.
 * Failure modes: primary failure → tool error; secondary failure → secondary null, answer states limitation.
 */

import {
  getSimplePrice,
  symbolToCoinGeckoId,
  type CoinGeckoClientError,
  type CoinGeckoClientResponse
} from '../clients';
import type { GhostfolioClient } from '../clients';
import { toToolErrorPayload } from './tool-error';
import { marketDataTool } from './market-data';

const PRICE_TOLERANCE_PERCENT = 0.5;
const MAX_SYMBOLS = 10;

export interface FactCheckToolInput {
  client: GhostfolioClient;
  impersonationId?: string;
  message: string;
  token?: string;
  symbols?: string[];
}

interface PrimarySymbolItem {
  symbol: string;
  dataSource: string;
  currentPrice: number;
  currency: string;
  error?: { error_code: string; message: string; retryable: boolean };
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseSymbolsFromMessage(message: string): string[] {
  const normalized = message.toLowerCase();
  const symbols: string[] = [];
  const aliasKeys = ['bitcoin', 'btc', 'ethereum', 'eth', 'solana', 'sol', 'tesla', 'tsla', 'apple', 'aapl'];

  for (const key of aliasKeys) {
    if (normalized.includes(key)) {
      symbols.push(key);
    }
  }

  const tickerMatch = message.match(/\b([A-Z]{2,5})\b/g);
  if (tickerMatch) {
    for (const ticker of tickerMatch) {
      if (!symbols.includes(ticker.toLowerCase())) {
        symbols.push(ticker);
      }
    }
  }

  return [...new Set(symbols)].slice(0, MAX_SYMBOLS);
}

function isPriceWithinTolerance(primary: number, secondary: number): boolean {
  if (primary <= 0) return false;
  const pct = Math.abs(primary - secondary) / primary * 100;
  return pct <= PRICE_TOLERANCE_PERCENT;
}

export async function factCheckTool({
  client,
  impersonationId,
  message,
  token,
  symbols: inputSymbols
}: FactCheckToolInput): Promise<Record<string, unknown>> {
  try {
    const symbols =
      Array.isArray(inputSymbols) && inputSymbols.length > 0
        ? inputSymbols.filter(Boolean).slice(0, MAX_SYMBOLS)
        : parseSymbolsFromMessage(message ?? '');

    if (symbols.length === 0) {
      return {
        match: true,
        primary: { symbols: [], summary: 'No symbols to verify' },
        secondary: null,
        answer:
          'No symbols specified. Ask to verify a price for a symbol (e.g. "verify bitcoin price", "fact check ETH").',
        sources: ['ghostfolio_api'],
        data_as_of: new Date().toISOString(),
        summary: 'Fact check: no symbols provided'
      };
    }

    const primaryResult = await marketDataTool({
      client,
      impersonationId,
      message: message ?? '',
      token,
      symbols,
      metrics: ['price']
    });

    const primarySymbols = Array.isArray(primaryResult.symbols) ? primaryResult.symbols : [];
    const primaryItems = primarySymbols as PrimarySymbolItem[];

    const idsToFetch: string[] = [];
    const symbolById: Record<string, string> = {};
    for (const item of primaryItems) {
      if (item.error || typeof item.currentPrice !== 'number' || item.currentPrice <= 0) continue;
      const id = symbolToCoinGeckoId(item.symbol);
      if (id && !idsToFetch.includes(id)) {
        idsToFetch.push(id);
        symbolById[id] = item.symbol;
      }
    }

    let secondary: CoinGeckoClientResponse | null = null;
    if (idsToFetch.length > 0) {
      secondary = await getSimplePrice(idsToFetch, 'usd');
    }

    const comparisons: { symbol: string; primaryPrice: number; secondaryPrice?: number; match: boolean; note?: string }[] = [];
    let allMatch = true;
    const discrepancyParts: string[] = [];

    for (const item of primaryItems) {
      if (item.error) {
        comparisons.push({
          symbol: item.symbol,
          primaryPrice: 0,
          match: false,
          note: item.error.message
        });
        allMatch = false;
        continue;
      }
      const price = roundTwo(item.currentPrice);
      const id = symbolToCoinGeckoId(item.symbol);
      if (!id) {
        comparisons.push({
          symbol: item.symbol,
          primaryPrice: price,
          match: true,
          note: 'No second source (stocks/other not on CoinGecko)'
        });
        continue;
      }
      if (!secondary?.ok) {
        comparisons.push({
          symbol: item.symbol,
          primaryPrice: price,
          match: true,
          note: 'Secondary source unavailable'
        });
        allMatch = false;
        const errMsg =
          secondary && !secondary.ok
            ? (secondary as CoinGeckoClientError).message
            : 'unknown';
        discrepancyParts.push(`CoinGecko unavailable: ${errMsg}`);
        continue;
      }
      const secPrice = secondary.data[id]?.usd;
      if (typeof secPrice !== 'number' || !Number.isFinite(secPrice)) {
        comparisons.push({
          symbol: item.symbol,
          primaryPrice: price,
          match: true,
          note: 'No CoinGecko price for this id'
        });
        allMatch = false;
        continue;
      }
      const secRounded = roundTwo(secPrice);
      const match = isPriceWithinTolerance(price, secRounded);
      comparisons.push({
        symbol: item.symbol,
        primaryPrice: price,
        secondaryPrice: secRounded,
        match
      });
      if (!match) {
        allMatch = false;
        discrepancyParts.push(
          `${item.symbol}: Ghostfolio ${item.currency} ${price} vs CoinGecko USD ${secRounded}`
        );
      }
    }

    const sources: string[] = ['ghostfolio_api'];
    if (secondary?.ok) sources.push('coingecko');

    const answer =
      discrepancyParts.length > 0
        ? `Fact check: discrepancy between sources. ${discrepancyParts.join('; ')}.`
        : idsToFetch.length === 0
          ? 'Fact check: no second source available for the requested symbols (CoinGecko supports crypto only).'
          : 'Fact check: prices match between Ghostfolio and CoinGecko within tolerance.';

    const summary =
      allMatch && comparisons.length > 0
        ? `Fact check: ${comparisons.length} symbol(s) verified; prices match.`
        : comparisons.length === 0
          ? 'Fact check: no comparable data.'
          : `Fact check: ${comparisons.filter((c) => !c.match).length} discrepancy(ies).`;

    return {
      match: allMatch,
      primary: {
        symbols: primaryItems.map((s) => ({
          symbol: s.symbol,
          dataSource: s.dataSource,
          currentPrice: s.currentPrice,
          currency: s.currency,
          error: s.error
        })),
        summary: primaryResult.summary,
        data_as_of: primaryResult.data_as_of
      },
      secondary:
        secondary?.ok === true
          ? {
              data: secondary.data,
              data_as_of: secondary.data_as_of
            }
          : secondary?.ok === false
            ? { error_code: secondary.error_code, message: secondary.message, retryable: secondary.retryable }
            : null,
      discrepancy: discrepancyParts.length > 0 ? discrepancyParts.join('; ') : undefined,
      comparisons,
      answer,
      sources,
      data_as_of: new Date().toISOString(),
      summary
    };
  } catch (error) {
    const toolError = toToolErrorPayload(error);
    return {
      match: false,
      primary: null,
      secondary: null,
      answer: `Fact check failed: ${toolError.message}`,
      summary: `Fact check failed: ${toolError.message}`,
      error: toolError,
      sources: ['ghostfolio_api'],
      data_as_of: new Date().toISOString()
    };
  }
}

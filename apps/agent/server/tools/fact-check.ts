/**
 * Fact-check tool: cross-check market_data (price) against secondary sources.
 *
 * Purpose: Verify price claims for symbols by comparing Ghostfolio primary
 *          result with Finnhub (or CoinGecko fallback); returns match/mismatch and provenance.
 *          Finnhub supports both stocks (AAPL, TSLA) and crypto (BTC, ETH).
 *          CoinGecko serves as fallback for crypto when Finnhub unavailable.
 * Inputs: message, symbols (required; pre-resolved upstream by symbol-resolver); uses Ghostfolio, Finnhub, CoinGecko.
 * Outputs: match, primary, secondary, discrepancy?, answer, sources, data_as_of.
 * Failure modes: primary failure → tool error; secondary failure → secondary null, answer states limitation.
 */

import {
  getFinnhubQuote,
  getSimplePrice,
  symbolToCoinGeckoId,
  type FinnhubClientResponse,
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

function isPriceWithinTolerance(primary: number, secondary: number): boolean {
  if (primary <= 0) return false;
  const pct = Math.abs(primary - secondary) / primary * 100;
  return pct <= PRICE_TOLERANCE_PERCENT;
}

/**
 * Extract potential symbol candidates from message when no explicit symbols provided.
 * Looks for common aliases (bitcoin, btc, etc.) and uppercase ticker symbols (AAPL, TSLA).
 * Prioritizes uppercase tickers to preserve intended symbol format.
 */
function extractSymbolsFromMessage(message: string): string[] {
  const normalized = message.toLowerCase();
  const aliasKeys = [
    'bitcoin', 'btc', 'ethereum', 'eth', 'solana', 'sol',
    'tesla', 'tsla', 'apple', 'aapl', 'nvidia', 'nvda'
  ];
  // Find aliases (company names) in lowercase form
  const found = aliasKeys.filter(key => normalized.includes(key));

  // Find uppercase ticker symbols (2-5 capital letters as a word)
  const tickerMatch = message.match(/\b([A-Z]{2,5})\b/g) ?? [];

  // Combine: uppercase tickers first (preserve case), then lowercase aliases
  // Use Set to deduplicate (e.g., if both "NVDA" and "nvidia" found)
  const symbols = [...new Set([...tickerMatch, ...found])];

  console.log('[fact-check.extractSymbolsFromMessage]', { message, symbols }); // DEBUG
  return symbols;
}

export async function factCheckTool({
  client,
  impersonationId,
  message,
  token,
  symbols: inputSymbols
}: FactCheckToolInput): Promise<Record<string, unknown>> {
  try {
    // Extract symbols from message if not explicitly provided
    const resolvedInputSymbols = Array.isArray(inputSymbols) && inputSymbols.length > 0
      ? inputSymbols.filter(Boolean).slice(0, MAX_SYMBOLS)
      : extractSymbolsFromMessage(message ?? '');

    // Pass explicit symbols to market_data for resolution
    const marketDataParams = {
      client,
      impersonationId,
      message: message ?? '',
      token,
      ...(resolvedInputSymbols.length > 0 ? { symbols: resolvedInputSymbols } : {}),
      metrics: ['price']
    };

    const primaryResult = await marketDataTool(marketDataParams);

    const primarySymbols = Array.isArray(primaryResult.symbols) ? primaryResult.symbols : [];
    const primaryItems = primarySymbols as PrimarySymbolItem[];

    // Check if all items have errors (market_data failed to resolve symbols)
    const errorItems = primaryItems.filter(item => item.error);
    const validItems = primaryItems.filter(item => !item.error && typeof item.currentPrice === 'number' && item.currentPrice > 0);

    // If market_data had resolution errors, report them instead of generic "no symbols" message
    if (errorItems.length > 0 && validItems.length === 0) {
      const errorMessages = errorItems.map(item => item.error?.message || 'Unknown error').join('; ');
      return {
        match: false,
        primary: { symbols: primaryItems, summary: primaryResult.summary },
        secondary: null,
        answer: `Could not verify prices: ${errorMessages}`,
        summary: `Fact check: symbol resolution failed - ${errorMessages}`,
        sources: ['ghostfolio_api'],
        data_as_of: new Date().toISOString()
      };
    }

    // Extract symbols to verify from primary items (use original symbol for Finnhub)
    const symbolsToFetch: string[] = [];
    for (const item of validItems) {
      if (!symbolsToFetch.includes(item.symbol)) {
        symbolsToFetch.push(item.symbol);
      }
    }

    // Try Finnhub first (most reliable), then fall back to CoinGecko for crypto symbols
    let secondary: (FinnhubClientResponse | CoinGeckoClientResponse) | null = null;
    if (symbolsToFetch.length > 0) {
      secondary = await getFinnhubQuote(symbolsToFetch);

      // If Finnhub failed, try CoinGecko for crypto symbols
      if (!secondary.ok) {
        const cryptoIds = primaryItems
          .filter(item => !item.error && item.currentPrice > 0)
          .map(item => symbolToCoinGeckoId(item.symbol))
          .filter((id): id is string => !!id);

        if (cryptoIds.length > 0) {
          secondary = await getSimplePrice(cryptoIds, 'usd');
        }
      }
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

      if (!secondary?.ok) {
        comparisons.push({
          symbol: item.symbol,
          primaryPrice: price,
          match: false,
          note: 'Secondary verification unavailable'
        });
        allMatch = false;
        const errMsg =
          secondary && !secondary.ok ? (secondary as { message?: string }).message : 'unknown';
        // Identify which source failed
        const sourceInfo = (secondary as { error_code?: string })?.error_code?.includes('FINNHUB')
          ? 'Finnhub'
          : (secondary as { error_code?: string })?.error_code?.includes('COINGECKO')
            ? 'CoinGecko'
            : 'Secondary source';
        discrepancyParts.push(`${item.symbol}: Could not verify (${sourceInfo}: ${errMsg})`);
        continue;
      }

      // Try to find secondary price from Finnhub or CoinGecko
      const coinGeckoId = symbolToCoinGeckoId(item.symbol);

      // First try Finnhub data (stocks and crypto)
      let secPrice: number | undefined;
      let source = 'finnhub';

      const finnhubData = secondary.data?.[item.symbol] as { price?: number } | undefined;
      if (typeof finnhubData?.price === 'number' && Number.isFinite(finnhubData.price)) {
        secPrice = finnhubData.price;
      } else if (coinGeckoId && coinGeckoId in (secondary.data || {})) {
        // Fall back to CoinGecko data (for crypto)
        const cgData = secondary.data[coinGeckoId] as { usd?: number } | undefined;
        if (typeof cgData?.usd === 'number' && Number.isFinite(cgData.usd)) {
          secPrice = cgData.usd;
          source = 'coingecko';
        }
      }

      if (!secPrice) {
        comparisons.push({
          symbol: item.symbol,
          primaryPrice: price,
          match: false,
          note: `Could not verify (no price data from secondary source)`
        });
        allMatch = false;
        discrepancyParts.push(`${item.symbol}: No verification data available`);
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
          `${item.symbol}: Ghostfolio ${item.currency} ${price} vs ${source} USD ${secRounded}`
        );
      }
    }

    const sources: string[] = ['ghostfolio_api'];
    if (secondary?.ok) {
      // Determine which secondary source was used
      const hasFinnhub = primaryItems.some(item => {
        const finnhubData = secondary.data?.[item.symbol] as { price?: number } | undefined;
        return typeof finnhubData?.price === 'number';
      });
      const hasCoinGecko = primaryItems.some(item => {
        const coinGeckoId = symbolToCoinGeckoId(item.symbol);
        return coinGeckoId && secondary.data?.[coinGeckoId];
      });
      if (hasFinnhub) sources.push('finnhub');
      if (hasCoinGecko) sources.push('coingecko');
    }

    const answer =
      discrepancyParts.length > 0
        ? `Fact check: ${discrepancyParts.join('; ')}.`
        : symbolsToFetch.length === 0
          ? 'Fact check: no symbols found to verify.'
          : primaryItems.length > 0
            ? 'Fact check: prices verified from Ghostfolio and matched against Yahoo Finance within tolerance.'
            : 'Fact check: no data available.';

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

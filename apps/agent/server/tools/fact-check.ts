/**
 * Fact-check tool: cross-check market_data (price) against Yahoo Finance as second source.
 *
 * Purpose: Verify price claims for symbols by comparing Ghostfolio primary
 *          result with Yahoo Finance; returns match/mismatch and provenance.
 *          Yahoo Finance supports both stocks (AAPL, TSLA) and crypto (BTC-USD, ETH-USD).
 * Inputs: message, symbols (required; pre-resolved upstream by symbol-resolver); uses Ghostfolio and Yahoo Finance.
 * Outputs: match, primary, secondary, discrepancy?, answer, sources, data_as_of.
 * Failure modes: primary failure → tool error; secondary failure → secondary null, answer states limitation.
 */

import {
  getYahooQuote,
  getSimplePrice,
  symbolToCoinGeckoId,
  type YahooFinanceClientError,
  type YahooFinanceClientResponse,
  type CoinGeckoClientResponse
} from '../clients';
import type { GhostfolioClient } from '../clients';
import { toToolErrorPayload } from './tool-error';
import { marketDataTool } from './market-data';

const PRICE_TOLERANCE_PERCENT = 0.5;
const MAX_SYMBOLS = 10;

/** Map CoinGecko symbol IDs to Yahoo Finance symbols for cross-source comparison. */
const COINGECKO_TO_YAHOO: Readonly<Record<string, string>> = {
  bitcoin: 'BTC-USD',
  ethereum: 'ETH-USD',
  solana: 'SOL-USD'
};

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
 */
function extractSymbolsFromMessage(message: string): string[] {
  const normalized = message.toLowerCase();
  const aliasKeys = [
    'bitcoin', 'btc', 'ethereum', 'eth', 'solana', 'sol',
    'tesla', 'tsla', 'apple', 'aapl', 'nvidia', 'nvda'
  ];
  const found = aliasKeys.filter(key => normalized.includes(key));
  const tickerMatch = message.match(/\b([A-Z]{2,5})\b/g) ?? [];
  return [...new Set([...found, ...tickerMatch])];
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

    // Build mappings from primary symbol (possibly CoinGecko id) to Yahoo Finance symbol
    const symbolMappings: { primarySymbol: string; yahooSymbol: string }[] = [];
    for (const item of primaryItems) {
      if (item.error || typeof item.currentPrice !== 'number' || item.currentPrice <= 0) continue;
      const yahooSymbol = COINGECKO_TO_YAHOO[item.symbol.toLowerCase()] ?? item.symbol;
      if (!symbolMappings.some(m => m.yahooSymbol === yahooSymbol)) {
        symbolMappings.push({ primarySymbol: item.symbol, yahooSymbol });
      }
    }
    const symbolsToFetch = symbolMappings.map(m => m.yahooSymbol);

    // Try Yahoo Finance first, then fall back to CoinGecko for crypto symbols
    let secondary: (YahooFinanceClientResponse | CoinGeckoClientResponse) | null = null;
    if (symbolsToFetch.length > 0) {
      secondary = await getYahooQuote(symbolsToFetch);

      // If Yahoo Finance failed, try CoinGecko for crypto symbols
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
          secondary && !secondary.ok ? (secondary as YahooFinanceClientError).message : 'unknown';
        discrepancyParts.push(`${item.symbol}: Could not verify (${errMsg})`);
        continue;
      }

      // Try to find secondary price from Yahoo Finance or CoinGecko
      const mapping = symbolMappings.find(m => m.primarySymbol === item.symbol);
      const yahooSymbol = mapping?.yahooSymbol ?? item.symbol;
      const coinGeckoId = symbolToCoinGeckoId(item.symbol);

      // First try Yahoo Finance data (for stocks and crypto with proper symbols)
      let secData: { regularMarketPrice?: number; currency?: string; usd?: number } | undefined;
      let source = 'secondary';

      if ('regularMarketPrice' in (secondary.data?.[yahooSymbol] || {})) {
        secData = secondary.data[yahooSymbol] as { regularMarketPrice?: number; currency?: string };
      } else if (coinGeckoId && coinGeckoId in (secondary.data || {})) {
        // Fall back to CoinGecko data (for crypto)
        const cgData = secondary.data[coinGeckoId] as { usd?: number } | undefined;
        if (cgData?.usd) {
          secData = { regularMarketPrice: cgData.usd, currency: 'USD' };
          source = 'coingecko';
        }
      }

      if (!secData || typeof secData.regularMarketPrice !== 'number' || !Number.isFinite(secData.regularMarketPrice)) {
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

      const secRounded = roundTwo(secData.regularMarketPrice);
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
          `${item.symbol}: Ghostfolio ${item.currency} ${price} vs ${source} ${secData.currency} ${secRounded}`
        );
      }
    }

    const sources: string[] = ['ghostfolio_api'];
    if (secondary?.ok) {
      // Determine which secondary source was used
      const hasYahoo = primaryItems.some(item => {
        const mapping = symbolMappings.find(m => m.primarySymbol === item.symbol);
        const yahooSymbol = mapping?.yahooSymbol ?? item.symbol;
        return secondary.data?.[yahooSymbol];
      });
      const hasCoinGecko = primaryItems.some(item => {
        const coinGeckoId = symbolToCoinGeckoId(item.symbol);
        return coinGeckoId && secondary.data?.[coinGeckoId];
      });
      if (hasYahoo) sources.push('yahoo_finance');
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

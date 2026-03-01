/**
 * Resolves a name or ticker (e.g. "bitcoin", "BTC", "Apple") to (dataSource, symbol)
 * for use with the Ghostfolio symbol and market-data APIs.
 */

import { logger } from '../utils';

export interface ResolvedSymbol {
  dataSource: string;
  symbol: string;
}

export interface SymbolCandidate {
  dataSource: string;
  symbol: string;
  name?: string;
  currency?: string;
}

export interface SymbolResolutionResult {
  resolved: ResolvedSymbol | null;
  candidates?: SymbolCandidate[];
}

interface RankedCandidate {
  currency?: string;
  dataSource: string;
  name?: string;
  score: number;
  symbol: string;
}

/** Shape of one item from GET /api/v1/symbol/lookup response. */
export interface LookupItem {
  dataSource: string;
  symbol: string;
  name?: string;
  currency?: string;
}

const SYMBOL_ALIASES: Readonly<Record<string, ResolvedSymbol>> = {
  bitcoin: { dataSource: 'YAHOO', symbol: 'BTC-USD' },
  btc: { dataSource: 'YAHOO', symbol: 'BTC-USD' },
  'btc-usd': { dataSource: 'YAHOO', symbol: 'BTC-USD' },
  btcusd: { dataSource: 'YAHOO', symbol: 'BTC-USD' },
  ethereum: { dataSource: 'YAHOO', symbol: 'ETH-USD' },
  eth: { dataSource: 'YAHOO', symbol: 'ETH-USD' },
  'eth-usd': { dataSource: 'YAHOO', symbol: 'ETH-USD' },
  ethusd: { dataSource: 'YAHOO', symbol: 'ETH-USD' },
  solana: { dataSource: 'YAHOO', symbol: 'SOL-USD' },
  sol: { dataSource: 'YAHOO', symbol: 'SOL-USD' },
  'sol-usd': { dataSource: 'YAHOO', symbol: 'SOL-USD' },
  solusd: { dataSource: 'YAHOO', symbol: 'SOL-USD' },
  tesla: { dataSource: 'YAHOO', symbol: 'TSLA' },
  telsa: { dataSource: 'YAHOO', symbol: 'TSLA' },
  tsla: { dataSource: 'YAHOO', symbol: 'TSLA' },
  apple: { dataSource: 'YAHOO', symbol: 'AAPL' },
  aapl: { dataSource: 'YAHOO', symbol: 'AAPL' },
  nvidia: { dataSource: 'YAHOO', symbol: 'NVDA' },
  nvda: { dataSource: 'YAHOO', symbol: 'NVDA' }
};

function normalizeAliasKey(input: string): string {
  const normalized = input.trim().toLowerCase().replace(/[-._/]+/g, '');
  const stripped = normalized.replace(/\b(?:stock|stocks|share|shares|coin|coins)\b$/, '').trim();
  return stripped.replace(/\s+/g, '');
}

/**
 * Resolves a name or ticker to (dataSource, symbol).
 * Uses lookup API first; falls back to static alias map.
 */
export async function resolveSymbol(
  nameOrTicker: string,
  lookup: (query: string) => Promise<LookupItem[]>
): Promise<ResolvedSymbol | null> {
  const result = await resolveSymbolWithCandidates(nameOrTicker, lookup);
  return result.resolved;
}

export async function resolveSymbolWithCandidates(
  nameOrTicker: string,
  lookup: (query: string) => Promise<LookupItem[]>
): Promise<SymbolResolutionResult> {
  const normalized = nameOrTicker.trim();
  if (!normalized) {
    logger.debug('[symbol_resolver] empty input', { nameOrTicker });
    return { resolved: null };
  }

  const aliasKey = normalizeAliasKey(normalized);
  const alias = SYMBOL_ALIASES[aliasKey];
  if (alias) {
    logger.debug('[symbol_resolver] resolved via alias', { query: normalized, aliasKey, dataSource: alias.dataSource, symbol: alias.symbol });
    return { resolved: alias };
  }

  logger.debug('[symbol_resolver] calling lookup API', { query: normalized });
  const items = await lookup(normalized);
  if (!Array.isArray(items) || items.length === 0) {
    logger.debug('[symbol_resolver] no items from lookup', { query: normalized, itemsLength: Array.isArray(items) ? items.length : 'not-array' });
    return { resolved: null };
  }

  const ranked = rankCandidates(normalized, items);
  if (ranked.length === 0) {
    logger.debug('[symbol_resolver] rankCandidates returned empty', { query: normalized, itemsFromApi: items.length });
    return { resolved: null };
  }

  const top = ranked[0];
  const second = ranked[1];
  const scoreOk = top.score >= 90;
  const gapOk = !second || top.score - second.score >= 10;

  if (scoreOk && gapOk) {
    logger.debug('[symbol_resolver] resolved from lookup', {
      query: normalized,
      dataSource: top.dataSource,
      symbol: top.symbol,
      name: top.name,
      topScore: top.score
    });
    return {
      resolved: { dataSource: top.dataSource, symbol: top.symbol }
    };
  }

  // When no single clear winner (score < 90 or top two close), use best match by name/symbol
  // (ranked[0]), not raw API order. We score both item.name and item.symbol so "binance coin"
  // matches items whose name contains "Binance Coin" better than unrelated first result.
  const bestMatch = ranked[0];
  if (bestMatch?.dataSource && bestMatch?.symbol) {
    logger.debug('[symbol_resolver] resolved to best name/symbol match', {
      query: normalized,
      dataSource: bestMatch.dataSource,
      symbol: bestMatch.symbol,
      name: bestMatch.name,
      score: bestMatch.score
    });
    return {
      resolved: {
        dataSource: bestMatch.dataSource.trim(),
        symbol: bestMatch.symbol.trim()
      },
      candidates: ranked.slice(0, 3).map((c) => ({
        currency: c.currency,
        dataSource: c.dataSource,
        name: c.name,
        symbol: c.symbol
      }))
    };
  }

  logger.debug('[symbol_resolver] ambiguous or low score, not resolving', {
    query: normalized,
    topScore: top.score,
    topSymbol: top.symbol,
    topName: top.name,
    topDataSource: top.dataSource,
    secondScore: second?.score,
    reason: !scoreOk ? 'top_score_below_90' : 'top_two_too_close',
    rankedTop3: ranked.slice(0, 3).map((r) => ({ score: r.score, symbol: r.symbol, name: r.name, dataSource: r.dataSource }))
  });
  return {
    resolved: null,
    candidates: ranked.slice(0, 3).map((candidate) => ({
      currency: candidate.currency,
      dataSource: candidate.dataSource,
      name: candidate.name,
      symbol: candidate.symbol
    }))
  };
}

function rankCandidates(query: string, items: LookupItem[]) {
  // Score each lookup item by how well its name and symbol match the query (both are used).
  const normalizedQuery = normalizeAliasKey(query);
  const seen = new Set<string>();
  const scored = items
    .map((item) => {
      const symbol = typeof item.symbol === 'string' ? item.symbol.trim() : '';
      const dataSource = typeof item.dataSource === 'string' ? item.dataSource.trim() : '';
      if (!symbol || !dataSource) {
        return undefined;
      }
      const name = typeof item.name === 'string' ? item.name.trim() : undefined;
      const symbolKey = normalizeAliasKey(symbol);
      const nameKey = normalizeAliasKey(name ?? '');
      let score = 0;
      if (symbolKey === normalizedQuery) score += 100;
      if (nameKey === normalizedQuery) score += 90;
      if (symbolKey.startsWith(normalizedQuery)) score += 70;
      if (nameKey.startsWith(normalizedQuery)) score += 60;
      if (symbolKey.includes(normalizedQuery)) score += 45;
      if (nameKey.includes(normalizedQuery)) score += 40;
      if (dataSource === 'YAHOO') score += 5;
      if (dataSource === 'COINGECKO') score += 4;
      const candidate: RankedCandidate = {
        currency: item.currency,
        dataSource,
        name,
        score,
        symbol
      };
      return candidate;
    })
    .filter((item): item is RankedCandidate => item !== undefined)
    .sort((a, b) => b.score - a.score);

  return scored.filter((item) => {
    const key = `${item.dataSource}:${item.symbol}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

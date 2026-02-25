/**
 * Resolves a name or ticker (e.g. "bitcoin", "BTC", "Apple") to (dataSource, symbol)
 * for use with the Ghostfolio symbol and market-data APIs.
 */

export interface ResolvedSymbol {
  dataSource: string;
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
  btcusd: { dataSource: 'YAHOO', symbol: 'BTC-USD' },
  ethereum: { dataSource: 'YAHOO', symbol: 'ETH-USD' },
  eth: { dataSource: 'YAHOO', symbol: 'ETH-USD' },
  solana: { dataSource: 'YAHOO', symbol: 'SOL-USD' },
  sol: { dataSource: 'YAHOO', symbol: 'SOL-USD' },
  tesla: { dataSource: 'YAHOO', symbol: 'TSLA' },
  telsa: { dataSource: 'YAHOO', symbol: 'TSLA' },
  tsla: { dataSource: 'YAHOO', symbol: 'TSLA' },
  apple: { dataSource: 'YAHOO', symbol: 'AAPL' },
  aapl: { dataSource: 'YAHOO', symbol: 'AAPL' },
  nvidia: { dataSource: 'YAHOO', symbol: 'NVDA' },
  nvda: { dataSource: 'YAHOO', symbol: 'NVDA' }
};

function normalizeAliasKey(input: string): string {
  const normalized = input.trim().toLowerCase().replace(/[._/]+/g, '');
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
  const normalized = nameOrTicker.trim();
  if (!normalized) {
    return null;
  }

  const aliasKey = normalizeAliasKey(normalized);
  const alias = SYMBOL_ALIASES[aliasKey];
  if (alias) {
    return alias;
  }

  const items = await lookup(normalized);
  if (Array.isArray(items) && items.length > 0) {
    const first = items[0];
    if (first?.dataSource && first?.symbol) {
      return { dataSource: first.dataSource, symbol: first.symbol };
    }
  }

  return null;
}

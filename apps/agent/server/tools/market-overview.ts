import { GhostfolioClient } from '../ghostfolio-client';

/**
 * Purpose: Return high-level market sentiment from Ghostfolio market endpoint.
 * Inputs: authenticated Ghostfolio client context (token, impersonation, message).
 * Outputs: normalized sentiment labels/scores for stocks and crypto with provenance.
 * Failure modes: upstream API errors propagate as tool execution failures.
 */
interface FearGreedPoint {
  marketPrice?: number;
}

interface FearGreedBlock {
  CRYPTOCURRENCIES?: FearGreedPoint;
  STOCKS?: FearGreedPoint;
}

function labelSentiment(value: number): string {
  if (value <= 24) return 'extreme fear';
  if (value <= 44) return 'fear';
  if (value <= 55) return 'neutral';
  if (value <= 74) return 'greed';
  return 'extreme greed';
}

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export async function marketOverviewTool({
  client,
  impersonationId,
  message,
  token
}: {
  client: GhostfolioClient;
  impersonationId?: string;
  message: string;
  token?: string;
}) {
  const data = (await client.getMarketData({
    impersonationId,
    token
  })) as { fearAndGreedIndex?: FearGreedBlock };
  const fearAndGreedIndex = data.fearAndGreedIndex ?? {};
  const stocks = toNumber(fearAndGreedIndex.STOCKS?.marketPrice);
  const crypto = toNumber(fearAndGreedIndex.CRYPTOCURRENCIES?.marketPrice);
  const stocksLabel = stocks !== undefined ? labelSentiment(stocks) : 'unknown';
  const cryptoLabel = crypto !== undefined ? labelSentiment(crypto) : 'unknown';

  return {
    answer:
      `Market sentiment snapshot: ` +
      `stocks are ${stocksLabel}${stocks !== undefined ? ` (${stocks})` : ''}; ` +
      `crypto is ${cryptoLabel}${crypto !== undefined ? ` (${crypto})` : ''}.`,
    data,
    data_as_of: new Date().toISOString(),
    message,
    overview: {
      cryptocurrencies: {
        label: cryptoLabel,
        value: crypto
      },
      stocks: {
        label: stocksLabel,
        value: stocks
      }
    },
    source: 'ghostfolio_api',
    sources: ['ghostfolio_api'],
    summary: 'Market overview from Ghostfolio fear & greed index'
  };
}

import { GhostfolioClient } from '../ghostfolio-client';

export async function marketDataLookupTool({
  client,
  message,
  token
}: {
  client: GhostfolioClient;
  message: string;
  token?: string;
}) {
  const data = await client.getMarketData(token);

  return {
    message,
    source: 'ghostfolio_api',
    summary: 'Market data lookup from Ghostfolio API',
    data
  };
}

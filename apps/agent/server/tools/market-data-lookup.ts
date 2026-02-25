import { GhostfolioClient } from '../ghostfolio-client';

export async function marketDataLookupTool({
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
  const data = await client.getMarketData({ impersonationId, token });

  return {
    data_as_of: new Date().toISOString(),
    message,
    source: 'ghostfolio_api',
    sources: ['ghostfolio_api'],
    summary: 'Market data lookup from Ghostfolio API',
    data
  };
}

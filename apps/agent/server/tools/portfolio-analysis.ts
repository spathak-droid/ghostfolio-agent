import { GhostfolioClient } from '../ghostfolio-client';

export async function portfolioAnalysisTool({
  client,
  message,
  token
}: {
  client: GhostfolioClient;
  message: string;
  token?: string;
}) {
  const data = await client.getPortfolioSummary(token);

  return {
    message,
    source: 'ghostfolio_api',
    summary: 'Portfolio analysis from Ghostfolio data',
    data
  };
}

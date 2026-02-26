import { GhostfolioClient } from '../ghostfolio-client';
import { toToolErrorPayload } from './tool-error';

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
  try {
    const data = await client.getMarketData({ impersonationId, token });

    return {
      data_as_of: new Date().toISOString(),
      message,
      source: 'ghostfolio_api',
      sources: ['ghostfolio_api'],
      summary: 'Market data lookup from Ghostfolio API',
      data
    };
  } catch (error) {
    const toolError = toToolErrorPayload(error);
    return {
      success: false,
      answer: `Could not fetch market lookup data: ${toolError.message}`,
      summary: `Market data lookup failed: ${toolError.message}`,
      error: toolError,
      data_as_of: new Date().toISOString(),
      sources: ['ghostfolio_api']
    };
  }
}

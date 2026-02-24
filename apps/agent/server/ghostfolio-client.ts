export class GhostfolioClient {
  public constructor(private readonly baseUrl: string) {}

  public async getPortfolioSummary(token?: string) {
    return this.get('/api/v1/portfolio/details', token);
  }

  public async getMarketData(token?: string) {
    return this.get('/api/v1/market-data/markets', token);
  }

  private async get(path: string, token?: string) {
    const headers: Record<string, string> = {};

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, { headers });

    if (!response.ok) {
      throw new Error(`Ghostfolio API request failed: ${response.status}`);
    }

    return response.json();
  }
}

# How the agent uses Yahoo and other data APIs

The **agent never calls Yahoo, CoinGecko, or any external market-data API directly**. All market and symbol data goes through the **Ghostfolio API** (Nest backend), which then calls the right data provider.

## End-to-end flow

```
User / Chat
    → Agent (standalone service)
        → GhostfolioClient.getSymbolData({ dataSource: 'YAHOO', symbol: 'BTC-USD' })
            → HTTP GET to Ghostfolio API: /api/v1/symbol/YAHOO/BTC-USD
    → Ghostfolio API (Nest)
        → SymbolController.getSymbolData(dataSource, symbol)
        → SymbolService.get({ dataGatheringItem: { dataSource, symbol } })
        → DataProviderService.getQuotes({ items: [{ dataSource, symbol }] })
        → getDataProvider('YAHOO')  → YahooFinanceService
        → YahooFinanceService.getQuotes({ symbols: ['BTC-USD'] })
            → yahoo-finance2 npm: YahooFinance.quote() or quoteSummary()
            → External: Yahoo Finance (no API key for basic use)
        → Response (marketPrice, currency, etc.) back to SymbolService
    → Agent receives JSON (marketPrice, currency, historicalData, …)
```

So: **Agent → Ghostfolio API → Data provider (Yahoo / CoinGecko / …) → External API**.

## Where each API is used (Ghostfolio API side)

| Data source   | Service / package              | External API / usage |
|---------------|--------------------------------|----------------------|
| **YAHOO**     | `YahooFinanceService`          | `yahoo-finance2` → Yahoo Finance (e.g. quote, quoteSummary, chart) |
| **COINGECKO** | `CoinGeckoService`             | `https://api.coingecko.com/api/v3` (optional API key: `API_KEY_COINGECKO_DEMO` / `API_KEY_COINGECKO_PRO`) |
| **ALPHA_VANTAGE** | `AlphaVantageService`     | Alpha Vantage API (API key required) |
| **EOD_HISTORICAL_DATA** | `EodHistoricalDataService` | EOD Historical Data API |
| **FINANCIAL_MODELING_PREP** | `FinancialModelingPrepService` | Financial Modeling Prep API |
| **RAPID_API** | `RapidApiService`              | RapidAPI-hosted providers |
| **MANUAL**    | `ManualService`                | No external API; manual prices |
| **GHOSTFOLIO** | `GhostfolioService`           | Used for derived/special data |

All of these implement `DataProviderInterface` (e.g. `getQuotes`, `getAssetProfile`, `getHistorical`, `search`). The **DataProviderService** picks the implementation by the `dataSource` in the request (and optional mapping in `PROPERTY_DATA_SOURCE_MAPPING`).

## Key files

- **Agent calling Ghostfolio API:** `apps/agent/server/ghostfolio-client.ts` — `get()`, `post()`, `put()`; e.g. `getSymbolData()` → `GET /api/v1/symbol/:dataSource/:symbol`.
- **Ghostfolio API entry:** `apps/api/src/app/symbol/symbol.controller.ts` — `getSymbolData(dataSource, symbol)`.
- **Symbol → quotes:** `apps/api/src/app/symbol/symbol.service.ts` — `get()` calls `dataProviderService.getQuotes()`.
- **Provider selection and caching:** `apps/api/src/services/data-provider/data-provider.service.ts` — `getQuotes()`, `getDataProvider()`.
- **Yahoo:** `apps/api/src/services/data-provider/yahoo-finance/yahoo-finance.service.ts` — uses `yahoo-finance2` (e.g. `this.yahooFinance.quote()`).
- **CoinGecko:** `apps/api/src/services/data-provider/coingecko/coingecko.service.ts` — `fetch(api.coingecko.com/...)`.
- **Provider registration:** `apps/api/src/services/data-provider/data-provider.module.ts` — lists all `DataProviderInterface` implementations.

## Agent-side fallback (market_data tool)

When the Ghostfolio API returns 404 for a symbol (e.g. YAHOO has no data for that ticker), the **agent’s** `market_data` tool can retry with another data source. For crypto it tries **COINGECKO** after **YAHOO** (see `apps/agent/server/tools/market-data.ts`: `getSymbolDataWithFallback`, `COINGECKO_SYMBOL_IDS`). So the agent still only talks to the Ghostfolio API; the API is just called again with a different `dataSource` (e.g. COINGECKO instead of YAHOO).

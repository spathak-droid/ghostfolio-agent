# Symbol Lookup and Price: UI vs Agent

This document describes how **symbol lookup** and **current price** work in the Ghostfolio UI (Add activity) and how the **agent** uses the same APIs and logic.

## UI flow (Add activity)

1. **Lookup search**  
   User types in "Name, symbol or ISIN".  
   - Component: `gf-symbol-autocomplete` (libs/ui)  
   - Call: `DataService.fetchSymbols({ query })`  
   - **API**: `GET /api/v1/symbol/lookup?query=...`  
   - Response: `LookupResponse { items: LookupItem[] }` (each item has `dataSource`, `symbol`, `name`, `currency`, etc.)

2. **User selects a symbol**  
   Form gets `searchSymbol: { dataSource, symbol }`.

3. **Price and profile**  
   On selection, the dialog calls `updateAssetProfile()`:  
   - Call: `DataService.fetchSymbolItem({ dataSource, symbol })`  
   - **API**: `GET /api/v1/symbol/{dataSource}/{symbol}`  
   - Response: `SymbolItem { marketPrice, currency, historicalData?, ... }`  
   - The UI sets `currentMarketPrice = marketPrice` and uses it for the unit price field.

4. **Reload (refresh) button**  
   When the date is today and type is BUY/SELL, a refresh icon is shown.  
   - Click calls `applyCurrentMarketPrice()` which sets `unitPrice` to the already-fetched `currentMarketPrice`.  
   - So "reload" does **not** call the API again; it reuses the price from step 3 (same source: `GET /api/v1/symbol/{dataSource}/{symbol}` → `marketPrice`).

**Summary:** In the UI, price always comes from **GET /api/v1/symbol/{dataSource}/{symbol}** → `marketPrice`. The API implements this in `SymbolService.get()` which uses `dataProviderService.getQuotes()` and returns `SymbolItem` with `marketPrice`.

---

## Agent: same APIs and price source

The agent uses the same endpoints and the same notion of "current price":

| Step | UI | Agent |
|------|----|--------|
| Lookup | `GET /api/v1/symbol/lookup?query=...` | `GhostfolioClient.getSymbolLookup({ query })` → same path |
| Resolve | User picks one item → `{ dataSource, symbol }` | `resolveSymbolWithCandidates()` uses lookup result and ranking → same `(dataSource, symbol)` |
| Price | `GET /api/v1/symbol/{dataSource}/{symbol}` → `marketPrice` | `GhostfolioClient.getSymbolData({ dataSource, symbol })` → same path; agent reads `marketPrice` |

### Where the agent uses this

- **market_data tool**  
  Resolves symbols via lookup, then for each resolved `(dataSource, symbol)` calls `getSymbolData` and uses `marketPrice` as the current price (with fallbacks for data source). Same source as the UI’s unit price after "reload".

  When the lookup returns **multiple matches** (e.g. "binance" or "dogecoin"), the agent uses the **first item from the lookup API** as the resolution—same as the first option in the UI’s dropdown—so "current price of X" returns the same symbol and price as in the UI.

- **create_order tool**  
  Resolves symbol via `getSymbolLookup` + `resolveSymbolWithCandidates`. When unit price is missing, it fetches price with `fetchPriceForSymbol()` → `getSymbolData()` → `marketPrice`. So the agent’s suggested or used unit price is the same as in the UI (same API and field).

No extra "reload" step is needed in the agent: whenever it needs a current price it calls the same symbol endpoint and uses `marketPrice`, matching the UI’s reload behavior in terms of data source.

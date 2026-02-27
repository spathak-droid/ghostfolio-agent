# Fact-Check Tool & Second-Source Plan (High Level)

## 1. Goal

- Use **CoinGecko** as a second source of truth for **market/price** (and related) data alongside the Ghostfolio API.
- Add a dedicated **`fact_check()`** tool that cross-checks claims against primary (Ghostfolio) and secondary (e.g. CoinGecko, Alternative.me) and returns match/mismatch with provenance.

**Principle:** `fact_check` is a **separate tool** from `market_data`. It does not replace or merge with existing tools; it verifies their outputs (or equivalent queries) against a second source.

---

## 2. Architecture

- **Primary source:** Ghostfolio API (existing tools: `market_data`, `market_data_lookup`, `market_overview`, `analyze_stock_trend`, etc.).
- **Second sources:**
  - **Prices (crypto):** CoinGecko `simple/price` (and optionally `market_chart` for trend).
  - **Sentiment (crypto F&G):** Alternative.me FNG API.
- **Where second sources are called:** Inside the **agent** service (new small clients), not necessarily inside the Ghostfolio backend. Agent calls Ghostfolio for primary and the new clients for secondary, then compares in `fact_check`.

---

## 3. fact_check Tool Design

### 3.1 Role

- **Input:** A claim to verify (e.g. "Bitcoin is $X", "BTC is up 5% this week", "Crypto fear & greed is 45") or structured inputs (symbols, claim type, range).
- **Behavior:** Fetch primary result (via existing Ghostfolio paths) and secondary result (CoinGecko / Alternative.me), compare, return match + sources + `data_as_of`.
- **Output:** `match`, `primary`, `secondary`, optional `discrepancy`, `answer`, `sources`, `data_as_of`; plus standard tool fields (`summary`, `error` if any).

### 3.2 Claim Types (What fact_check Can Verify)

| Claim type              | Primary (existing)           | Second source        | Notes |
|-------------------------|------------------------------|----------------------|--------|
| **price**               | `market_data` (Ghostfolio)   | CoinGecko simple/price | Crypto only; stocks "no second source". |
| **sentiment**           | `market_data_lookup` / `market_overview` (F&G) | Alternative.me FNG   | Crypto F&G comparable; stocks optional later. |
| **trend**               | `analyze_stock_trend`        | CoinGecko market_chart (7d/30d) | Crypto period-change % comparison. |
| **compliance_determinism** | `compliance_check`       | N/A (re-run same tool) | Same inputs → same result; no external second source. |
| **consistency** (opt.)  | e.g. `portfolio_analysis` vs `holdings_analysis` | N/A                  | Internal consistency only. |

### 3.3 Input Schema (extensible)

- **Required:** `message` (and auth/context as other tools).
- **Optional:**
  - `claimType`: `'price' | 'sentiment' | 'trend' | 'compliance_determinism' | 'consistency'` (default inferred or `'price'`).
  - `symbol`, `symbols[]`, `range` (e.g. `7d` for trend).
  - For compliance: same params as `compliance_check` (symbol, type, quantity, unitPrice, etc.).
  - For consistency: references or re-call of two tools.

### 3.4 Output Schema

- `match: boolean`
- `primary: object` (normalized primary result)
- `secondary: object | null` (null if no second source or failure)
- `discrepancy?: string`
- `answer: string` (short natural-language verdict)
- `sources: string[]`
- `data_as_of: string`
- Plus: `summary`, `error` per tool contract.

---

## 4. Implementation Phases (High Level)

1. **CoinGecko client (agent)**  
   New module (e.g. `coingecko-client.ts`): config (URL, optional API key), `getSimplePrice(ids, vsCurrency)`, symbol→id mapping for crypto, timeout/errors, no secrets in logs.

2. **fact_check tool – price only**  
   New tool `fact_check`: input (message + optional symbols/claimType), call Ghostfolio (same as market_data path) + CoinGecko, compare, return schema above. Register in tool registry, agent-tool-runtime, types (`AgentToolName` etc.).

3. **Sentiment (Fear & Greed)**  
   Alternative.me client (or single fetch); add `claimType: 'sentiment'`; compare Ghostfolio crypto F&G vs Alternative.me.

4. **Trend**  
   CoinGecko `market_chart` for 7d/30d; add `claimType: 'trend'`; compare `analyze_stock_trend` period change % vs CoinGecko.

5. **Compliance determinism**  
   Add `claimType: 'compliance_determinism'`; run `compliance_check` twice with same inputs; expect identical result.

6. **Optional: consistency**  
   Optional mode comparing e.g. portfolio total vs sum of holdings, or transaction totals vs timeline.

7. **Orchestration & synthesis**  
   LLM selects `fact_check` when user asks to verify/confirm/double-check; synthesis layer uses `match: false` for flags/confidence.

8. **Evals & docs**  
   Eval cases for fact_check (happy, edge, adversarial); document in `docs/agent/` (data-provider flow, fact-check behavior, supported symbols/claim types).

---

## 5. Env & Config

- Agent `.env`: `COINGECKO_API_URL`, optional `API_KEY_COINGECKO_*`; no secrets in logs.
- Alternative.me: public API; optional rate limit / caching in agent.

---

## 6. What fact_check Does Not Do

- It does **not** replace `market_data` or other tools.
- It does **not** guess or invent data; if secondary is unavailable, it returns `secondary: null` and states limitation.
- It does **not** provide financial advice; it only reports match/mismatch and provenance.

---

## 7. Success Criteria

- fact_check is a separate, registered tool with clear input/output and error model.
- Price (crypto) verified against CoinGecko; sentiment (crypto) against Alternative.me; trend (crypto) against CoinGecko where applicable.
- All factual outputs include `sources` and `data_as_of`.
- Evals and docs updated; no regression on existing tools.

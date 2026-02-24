# Ghostfolio API response schemas

Response shapes for portfolio, order, and related endpoints used by the agent and clients. All under `/api/v1` unless noted.

---

## Transactions (GET /order)

Transactions are returned by **GET /order**. The response has `activities`; each element is a transaction (order/activity). The agent’s `get_transactions` tool calls **GET /api/v1/order?range=max&take=200** and exposes `data.activities` as `transactions`.

**Response:** `ActivitiesResponse`

```ts
{
  activities: Transaction[];  // list of transactions
  count: number;
}

// Transaction (= Activity: Prisma Order + computed fields)
{
  id: string;
  userId: string;
  accountId: string | null;
  accountUserId: string | null;
  symbolProfileId: string;
  createdAt: string;       // ISO date
  updatedAt: string;
  date: string;            // activity/trade date (ISO)
  type: string;            // BUY | SELL | DIVIDEND | INTEREST | ITEM | LIABILITY
  quantity: number;
  unitPrice: number;
  fee: number;
  currency: string | null;
  comment: string | null;
  isDraft: boolean;
  // Relations / computed (when expanded)
  account?: { id: string; name: string; platformId?: string; userId: string };
  SymbolProfile: {
    id: string;
    dataSource: string;
    symbol: string;
    name?: string;
    currency?: string;
    assetClass?: string;
    assetSubClass?: string;
    isin?: string;
    // ... other symbol profile fields
  };
  tags?: { id: string; name: string }[];
  tagIds?: string[];
  feeInAssetProfileCurrency: number;
  feeInBaseCurrency: number;
  unitPriceInAssetProfileCurrency: number;
  value: number;
  valueInBaseCurrency: number;
  updateAccountBalance?: boolean;
  error?: { code: 'IS_DUPLICATE'; message?: string };
}
```

**Query params (GET /order):** `range`, `take`, `skip`, `sortColumn`, `sortDirection`, and filters: `accounts`, `assetClasses`, `dataSource`, `symbol`, `tags`.

---

## 1. GET /portfolio/details

**Response:** `PortfolioDetails & { hasError: boolean }`

```ts
{
  hasError: boolean;
  accounts: {
    [id: string]: {
      balance: number;
      currency: string;
      name: string;
      valueInBaseCurrency: number;
      valueInPercentage?: number;
    };
  };
  createdAt: string; // ISO date
  holdings: { [symbol: string]: PortfolioPosition };
  markets?: { [key: string]: { id: string; valueInBaseCurrency?: number; valueInPercentage: number } };
  marketsAdvanced?: { [key: string]: { id: string; valueInBaseCurrency?: number; valueInPercentage: number } };
  platforms: {
    [id: string]: {
      balance: number;
      currency: string;
      name: string;
      valueInBaseCurrency: number;
      valueInPercentage?: number;
    };
  };
  summary?: PortfolioSummary;
}

// PortfolioPosition
{
  activitiesCount: number;
  allocationInPercentage: number;
  assetClass?: string;
  assetClassLabel?: string;
  assetSubClass?: string;
  assetSubClassLabel?: string;
  countries: { code: string; weight: number }[];
  currency: string;
  dataSource: string;
  dateOfFirstActivity: string;
  dividend: number;
  exchange?: string;
  grossPerformance: number;
  grossPerformancePercent: number;
  grossPerformancePercentWithCurrencyEffect: number;
  grossPerformanceWithCurrencyEffect: number;
  holdings: { allocationInPercentage: number; name: string; valueInBaseCurrency: number }[];
  investment: number;
  marketChange?: number;
  marketChangePercent?: number;
  marketPrice: number;
  markets?: Record<string, number>;
  marketsAdvanced?: Record<string, number>;
  name: string;
  netPerformance: number;
  netPerformancePercent: number;
  netPerformancePercentWithCurrencyEffect: number;
  netPerformanceWithCurrencyEffect: number;
  quantity: number;
  sectors: { weight: number; name?: string }[];
  symbol: string;
  tags?: { id: string; name: string }[];
  type?: string;
  url?: string;
  valueInBaseCurrency?: number;
  valueInPercentage?: number;
}

// PortfolioSummary (extends PortfolioPerformance)
{
  activityCount: number;
  annualizedPerformancePercent: number;
  annualizedPerformancePercentWithCurrencyEffect: number;
  cash: number;
  committedFunds?: number; // deprecated
  dateOfFirstActivity: string;
  dividendInBaseCurrency: number;
  emergencyFund: { assets: number; cash: number; total: number };
  excludedAccountsAndActivities: number;
  fees: number;
  filteredValueInBaseCurrency?: number;
  filteredValueInPercentage?: number;
  fireWealth: { today: { valueInBaseCurrency: number } };
  grossPerformance: number;
  grossPerformanceWithCurrencyEffect: number;
  interestInBaseCurrency: number;
  liabilitiesInBaseCurrency: number;
  totalBuy: number;
  totalSell: number;
  totalValueInBaseCurrency?: number;
  // PortfolioPerformance
  annualizedPerformancePercent?: number;
  currentNetWorth?: number;
  currentValueInBaseCurrency: number;
  netPerformance: number;
  netPerformancePercentage: number;
  netPerformancePercentageWithCurrencyEffect: number;
  netPerformanceWithCurrencyEffect: number;
  totalInvestment: number;
  totalInvestmentValueWithCurrencyEffect: number;
}
```

---

## 2. GET /portfolio/dividends

**Response:** `PortfolioDividendsResponse`

```ts
{
  dividends: { date: string; investment: number }[];
}
```

---

## 3. GET /portfolio/holding/:dataSource/:symbol

**Response:** `PortfolioHoldingResponse`

```ts
{
  activitiesCount: number;
  averagePrice: number;
  dataProviderInfo: Record<string, unknown>;
  dateOfFirstActivity: string;
  dividendInBaseCurrency: number;
  dividendYieldPercent: number;
  dividendYieldPercentWithCurrencyEffect: number;
  feeInBaseCurrency: number;
  grossPerformance: number;
  grossPerformancePercent: number;
  grossPerformancePercentWithCurrencyEffect: number;
  grossPerformanceWithCurrencyEffect: number;
  historicalData: HistoricalDataItem[];
  investmentInBaseCurrencyWithCurrencyEffect: number;
  marketPrice: number;
  marketPriceMax: number;
  marketPriceMin: number;
  netPerformance: number;
  netPerformancePercent: number;
  netPerformancePercentWithCurrencyEffect: number;
  netPerformanceWithCurrencyEffect: number;
  performances: unknown; // Benchmark['performances']
  quantity: number;
  SymbolProfile: EnhancedSymbolProfile; // symbol, name, dataSource, etc.
  tags: { id: string; name: string }[];
  value: number;
}
```

---

## 4. GET /portfolio/holdings

**Response:** `PortfolioHoldingsResponse`

```ts
{
  holdings: PortfolioPosition[];  // same shape as in §1
}
```

---

## 5. GET /portfolio/investments

**Response:** `PortfolioInvestmentsResponse`

```ts
{
  investments: { date: string; investment: number }[];
  streaks: { currentStreak: number; longestStreak: number };
}
```

---

## 6. GET /portfolio/performance (v2: /api/v2/portfolio/performance)

**Response:** `PortfolioPerformanceResponse`

```ts
{
  hasErrors?: boolean;
  errors?: { dataSource: string; symbol: string }[];
  chart?: HistoricalDataItem[];
  firstOrderDate: string; // ISO date
  performance: PortfolioPerformance;
}

// HistoricalDataItem
{
  date: string;
  averagePrice?: number;
  grossPerformancePercent?: number;
  investmentValueWithCurrencyEffect?: number;
  marketPrice?: number;
  netPerformance?: number;
  netPerformanceInPercentage?: number;
  netPerformanceInPercentageWithCurrencyEffect?: number;
  netPerformanceWithCurrencyEffect?: number;
  netWorth?: number;
  netWorthInPercentage?: number;
  quantity?: number;
  totalAccountBalance?: number;
  totalInvestment?: number;
  totalInvestmentValueWithCurrencyEffect?: number;
  value?: number;
  valueInPercentage?: number;
  valueWithCurrencyEffect?: number;
}

// PortfolioPerformance
{
  annualizedPerformancePercent?: number;
  currentNetWorth?: number;
  currentValueInBaseCurrency: number;
  netPerformance: number;
  netPerformancePercentage: number;
  netPerformancePercentageWithCurrencyEffect: number;
  netPerformanceWithCurrencyEffect: number;
  totalInvestment: number;
  totalInvestmentValueWithCurrencyEffect: number;
}
```

---

## 7. GET /portfolio/report

**Response:** `PortfolioReportResponse`

```ts
{
  xRay: {
    categories: {
      key: string;
      name: string;
      rules: PortfolioReportRule[];
    }[];
    statistics: {
      rulesActiveCount: number;
      rulesFulfilledCount: number;
    };
  };
}

// PortfolioReportRule
{
  configuration?: {
    threshold?: { max: number; min: number; step: number; unit?: string };
    thresholdMax?: boolean;
    thresholdMin?: boolean;
  };
  evaluation?: string;
  isActive: boolean;
  key: string;
  name: string;
  value?: boolean;
}
```

---

## 8. GET /order (list activities / transactions)

Same as **Transactions** above: returns `{ activities, count }`. Each `activities[i]` is a transaction (Activity). See **Transactions** for the full transaction schema.

---

## 9. GET /order/:id (single activity)

**Response:** `ActivityResponse` (= `Activity`, same shape as one element of `activities` above)

---

## 10. POST /order (create order)

The agent’s **create_order** tool calls this endpoint with `updateAccountBalance: true` when recording a buy/sell/activity.

**Response:** Prisma `Order` (same core fields as `Activity` without the extended client fields)

```ts
{
  id: string;
  userId: string;
  accountId: string | null;
  accountUserId: string | null;
  symbolProfileId: string;
  createdAt: string;
  updatedAt: string;
  date: string;
  type: string;
  quantity: number;
  unitPrice: number;
  fee: number;
  currency: string | null;
  comment: string | null;
  isDraft: boolean;
  // SymbolProfile relation typically included
}
```

---

## 11. PUT /order/:id (update order)

The agent’s **update_order** tool calls this endpoint with `updateAccountBalance: true` when editing an activity.

**Response:** Prisma `Order` (same as POST response)

---

## 12. DELETE /order (bulk delete by query params)

**Response:** `number` (deleted count)

---

## 13. DELETE /order/:id

**Response:** Prisma `Order` (the deleted order)

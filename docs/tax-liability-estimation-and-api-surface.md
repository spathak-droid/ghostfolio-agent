# Ghostfolio API Surface and Tax Liability Estimation Spec

## Purpose

This document captures:
- The API surface currently exposed by this Ghostfolio backend.
- A specification for `tax_estimate(income, deductions) -> estimated_liability` since no dedicated tax estimation API currently exists.

## Inputs

- Source code in `apps/api/src/app/**/*controller.ts`
- Liability-related schema in `libs/common/src/lib/dtos/create-order.dto.ts`

## Outputs

- Route inventory snapshot
- Calculation contract and pseudocode for liability estimation

## Failure Modes

- Route inventory may become stale as controllers change.
- Tax liability estimation is jurisdiction-specific; using incorrect tax brackets/credits will produce incorrect outputs.

## API Surface Snapshot

`data_as_of: 2026-02-26T22:10:54Z`

Global API prefix is `/api` with URI versioning (`v1`), so endpoints are generally under `/api/v1/*`.

### Route inventory (controller-derived)

```text
GET /api/v1/access
POST /api/v1/access
DELETE /api/v1/access/:id
PUT /api/v1/access/:id
DELETE /api/v1/account/:id
GET /api/v1/account
GET /api/v1/account/:id
GET /api/v1/account/:id/balances
POST /api/v1/account
POST /api/v1/account/transfer-balance
PUT /api/v1/account/:id
POST /api/v1/account-balance
DELETE /api/v1/account-balance/:id
GET /api/v1/admin
GET /api/v1/admin/demo-user/sync
POST /api/v1/admin/gather
POST /api/v1/admin/gather/max
POST /api/v1/admin/gather/profile-data
POST /api/v1/admin/gather/profile-data/:dataSource/:symbol
POST /api/v1/admin/gather/:dataSource/:symbol
POST /api/v1/admin/gather/:dataSource/:symbol/:dateString
GET /api/v1/admin/market-data
POST /api/v1/admin/market-data/:dataSource/:symbol/test
POST /api/v1/admin/profile-data/:dataSource/:symbol
DELETE /api/v1/admin/profile-data/:dataSource/:symbol
PATCH /api/v1/admin/profile-data/:dataSource/:symbol
PUT /api/v1/admin/settings/:key
GET /api/v1/admin/user
GET /api/v1/admin/user/:id
DELETE /api/v1/admin/queue/job
GET /api/v1/admin/queue/job
DELETE /api/v1/admin/queue/job/:id
GET /api/v1/admin/queue/job/:id/execute
POST /api/v1/agent/chat
POST /api/v1/agent/feedback
GET /api/v1/agent/widget/:asset
GET /api/v1/agent/widget/:folder/:asset
GET /api/v1/asset/:dataSource/:symbol
GET /api/v1/auth/anonymous/:accessToken
POST /api/v1/auth/anonymous
POST /api/v1/auth/admin-login
GET /api/v1/auth/google
GET /api/v1/auth/google/callback
GET /api/v1/auth/oidc
GET /api/v1/auth/oidc/callback
POST /api/v1/auth/webauthn/generate-authentication-options
GET /api/v1/auth/webauthn/generate-registration-options
POST /api/v1/auth/webauthn/verify-attestation
POST /api/v1/auth/webauthn/verify-authentication
DELETE /api/v1/auth-device/:id
POST /api/v1/cache/flush
GET /api/v1/ai/prompt/:mode
POST /api/v1/api-keys
GET /api/v1/assets/:languageCode/site.webmanifest
POST /api/v1/benchmarks
DELETE /api/v1/benchmarks/:dataSource/:symbol
GET /api/v1/benchmarks
GET /api/v1/benchmarks/:dataSource/:symbol/:startDateString
GET /api/v1/data-providers/ghostfolio/asset-profile/:symbol
GET /api/v1/data-providers/ghostfolio/dividends/:symbol
GET /api/v1/data-providers/ghostfolio/historical/:symbol
GET /api/v1/data-providers/ghostfolio/lookup
GET /api/v1/data-providers/ghostfolio/quotes
GET /api/v1/data-providers/ghostfolio/status
GET /api/v1/market-data/markets
GET /api/v1/market-data/:dataSource/:symbol
POST /api/v1/market-data/:dataSource/:symbol
GET /api/v1/platforms
GET /api/v1/public/:accessId/portfolio
GET /api/v1/sitemap.xml
POST /api/v1/tags
DELETE /api/v1/tags/:id
GET /api/v1/tags
PUT /api/v1/tags/:id
POST /api/v1/watchlist
DELETE /api/v1/watchlist/:dataSource/:symbol
GET /api/v1/watchlist
GET /api/v1/exchange-rate/:symbol/:dateString
GET /api/v1/export
GET /api/v1/health
GET /api/v1/health/data-enhancer/:name
GET /api/v1/health/data-provider/:dataSource
POST /api/v1/import
GET /api/v1/import/dividends/:dataSource/:symbol
GET /api/v1/info
GET /api/v1/logo/:dataSource/:symbol
GET /api/v1/logo
DELETE /api/v1/order
DELETE /api/v1/order/:id
GET /api/v1/order
GET /api/v1/order/:id
POST /api/v1/order
PUT /api/v1/order/:id
GET /api/v1/platform
POST /api/v1/platform
PUT /api/v1/platform/:id
DELETE /api/v1/platform/:id
GET /api/v1/portfolio/details
GET /api/v1/portfolio/dividends
GET /api/v1/portfolio/holding/:dataSource/:symbol
GET /api/v1/portfolio/holdings
GET /api/v1/portfolio/investments
GET /api/v1/portfolio/performance
GET /api/v1/portfolio/report
PUT /api/v1/portfolio/holding/:dataSource/:symbol/tags
POST /api/v1/subscription/redeem-coupon
GET /api/v1/subscription/stripe/callback
POST /api/v1/subscription/stripe/checkout-session
GET /api/v1/symbol/lookup
GET /api/v1/symbol/:dataSource/:symbol
GET /api/v1/symbol/:dataSource/:symbol/:dateString
DELETE /api/v1/user
DELETE /api/v1/user/:id
POST /api/v1/user/:id/access-token
POST /api/v1/user/access-token
GET /api/v1/user
POST /api/v1/user
PUT /api/v1/user/setting
```

### Tax estimation availability check

There is no existing endpoint matching `tax`, `tax-estimate`, or `tax_estimate` in the backend controllers.

Related existing capability:
- Liability activities can be recorded through `POST /api/v1/order` with `type = LIABILITY`.
- This records liabilities in portfolio accounting, but it does not estimate tax from income/deductions.

## Proposed Contract: `tax_estimate(income, deductions) -> estimated_liability`

Label: `education`  
Not financial advice.

### Required input schema

```ts
type TaxBracket = {
  readonly upTo: number | null; // null means no upper bound
  readonly rate: number; // decimal, e.g. 0.22 for 22%
};

type TaxEstimateInput = {
  readonly income: number;
  readonly deductions: number;
  readonly credits?: number;
  readonly brackets: readonly TaxBracket[];
};
```

### Output schema

```ts
type TaxEstimateOutput = {
  readonly taxableIncome: number;
  readonly grossTax: number;
  readonly creditsApplied: number;
  readonly estimatedLiability: number;
  readonly effectiveRateOnIncome: number;
};
```

### Deterministic formula

```text
taxableIncome = max(0, income - deductions)

grossTax = sum over brackets:
  taxedAmountInBracket * bracketRate

creditsApplied = min(max(0, credits), grossTax)

estimatedLiability = max(0, grossTax - creditsApplied)

effectiveRateOnIncome =
  income > 0 ? estimatedLiability / income : 0
```

### Pseudocode

```ts
export function taxEstimate(input: TaxEstimateInput): TaxEstimateOutput {
  const income = Number.isFinite(input.income) ? input.income : NaN;
  const deductions = Number.isFinite(input.deductions) ? input.deductions : NaN;
  const credits = Number.isFinite(input.credits ?? 0) ? (input.credits ?? 0) : NaN;

  if (!Number.isFinite(income) || income < 0) {
    throw new Error('VALIDATION_ERROR: income must be a finite number >= 0');
  }

  if (!Number.isFinite(deductions) || deductions < 0) {
    throw new Error('VALIDATION_ERROR: deductions must be a finite number >= 0');
  }

  if (!Number.isFinite(credits) || credits < 0) {
    throw new Error('VALIDATION_ERROR: credits must be a finite number >= 0');
  }

  const taxableIncome = Math.max(0, income - deductions);

  let remaining = taxableIncome;
  let lower = 0;
  let grossTax = 0;

  for (const bracket of input.brackets) {
    if (!Number.isFinite(bracket.rate) || bracket.rate < 0 || bracket.rate > 1) {
      throw new Error('VALIDATION_ERROR: invalid bracket rate');
    }

    const upper = bracket.upTo;

    if (upper === null) {
      grossTax += remaining * bracket.rate;
      remaining = 0;
      break;
    }

    if (!Number.isFinite(upper) || upper < lower) {
      throw new Error('VALIDATION_ERROR: invalid bracket upper bound');
    }

    const width = upper - lower;
    const taxed = Math.max(0, Math.min(remaining, width));
    grossTax += taxed * bracket.rate;
    remaining -= taxed;
    lower = upper;

    if (remaining <= 0) {
      break;
    }
  }

  const creditsApplied = Math.min(credits, grossTax);
  const estimatedLiability = Math.max(0, grossTax - creditsApplied);

  return {
    taxableIncome,
    grossTax,
    creditsApplied,
    estimatedLiability,
    effectiveRateOnIncome: income > 0 ? estimatedLiability / income : 0
  };
}
```

## Suggested API addition (if you want this exposed)

```text
POST /api/v1/tax/estimate
```

Request body:

```json
{
  "income": 150000,
  "deductions": 30000,
  "credits": 2000,
  "brackets": [
    { "upTo": 11000, "rate": 0.10 },
    { "upTo": 44725, "rate": 0.12 },
    { "upTo": null, "rate": 0.22 }
  ]
}
```

Response body:

```json
{
  "taxableIncome": 120000,
  "grossTax": 21800,
  "creditsApplied": 2000,
  "estimatedLiability": 19800,
  "effectiveRateOnIncome": 0.132
}
```

## Provenance

```yaml
sources:
  - apps/api/src/main.ts
  - apps/api/src/app/**/*controller.ts
  - libs/common/src/lib/dtos/create-order.dto.ts
data_as_of: 2026-02-26T22:10:54Z
```

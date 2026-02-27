# Ghostfolio API Endpoint Catalog

## Account Management

| Method | Path | Description | Auth Required | Notes |
|--------|------|-------------|---------------|-------|
| DELETE | /account/:id | Delete account (must have no activities) | JWT | permission.deleteAccount |
| GET | /account | Get all user accounts with aggregations | JWT | Supports filtering by dataSource, symbol; Redacted values in response |
| GET | /account/:id | Get account by ID | JWT | Returns single account with aggregations |
| GET | /account/:id/balances | Get account balance history | JWT | Redacted values in response |
| POST | /account | Create new account | JWT | permission.createAccount; Supports platform connection |
| POST | /account/transfer-balance | Transfer balance between accounts | JWT | permission.updateAccount |
| PUT | /account/:id | Update account details | JWT | permission.updateAccount |

## Account Balance

| Method | Path | Description | Auth Required | Notes |
|--------|------|-------------|---------------|-------|
| DELETE | /account-balance/:id | Delete account balance record | JWT | permission.deleteAccountBalance |
| POST | /account-balance | Create/update account balance for a date | JWT | permission.createAccountBalance |

## Authentication

| Method | Path | Description | Auth Required | Notes |
|--------|------|-------------|---------------|-------|
| GET | /auth/anonymous/:accessToken | DEPRECATED - Validate anonymous login | None | Returns authToken |
| POST | /auth/anonymous | Validate anonymous login via accessToken | None | Returns authToken |
| POST | /auth/admin-login | Admin login (requires ADMIN_ID config) | None | Returns authToken |
| GET | /auth/google | Initiate Google OAuth flow | None | Redirect to provider |
| GET | /auth/google/callback | Google OAuth callback | None | Sets JWT in redirect URL |
| GET | /auth/oidc | Initiate OIDC login flow | None | Requires ENABLE_FEATURE_AUTH_OIDC |
| GET | /auth/oidc/callback | OIDC callback | None | Sets JWT in redirect URL |
| POST | /auth/webauthn/generate-authentication-options | Get WebAuthn authentication challenge | None | Request body: {deviceId} |
| GET | /auth/webauthn/generate-registration-options | Generate WebAuthn registration options | JWT | permission.hasPermission |
| POST | /auth/webauthn/verify-attestation | Verify WebAuthn attestation | JWT | Register new authenticator |
| POST | /auth/webauthn/verify-authentication | Verify WebAuthn assertion | None | Returns authToken |

## Auth Devices

| Method | Path | Description | Auth Required | Notes |
|--------|------|-------------|---------------|-------|
| DELETE | /auth-device/:id | Delete authentication device | JWT | permission.deleteAuthDevice |

## Orders/Activities

| Method | Path | Description | Auth Required | Notes |
|--------|------|-------------|---------------|-------|
| DELETE | /order | Bulk delete orders by filters | JWT | permission.deleteOrder; Supports filtering by accounts, assetClasses, dataSource, symbol, tags |
| DELETE | /order/:id | Delete specific order | JWT | permission.deleteOrder |
| GET | /order | Get all orders for user | JWT | Supports filtering, sorting, pagination, date ranges |
| GET | /order/:id | Get order by ID | JWT | Returns single activity |
| POST | /order | Create new order/activity | JWT | permission.createOrder; Validates activity data; Triggers data gathering |
| PUT | /order/:id | Update order/activity | JWT | permission.updateOrder |

## Portfolio

| Method | Path | Description | Auth Required | Notes |
|--------|------|-------------|---------------|-------|
| GET | /portfolio/details | Get portfolio summary and holdings | JWT | Includes accounts, holdings, platforms, markets; Redacted for restricted views |
| GET | /portfolio/dividends | Get dividend breakdown (grouped) | JWT | Supports grouping and date ranges |
| GET | /portfolio/holding/:dataSource/:symbol | Get specific holding details | JWT | Returns position breakdown by account |
| GET | /portfolio/holdings | Get all holdings with filtering | JWT | Supports filtering and date ranges |
| GET | /portfolio/investments | Get investment timeline (grouped) | JWT | Shows investment contributions over time |
| GET | /portfolio/performance | Get portfolio performance data | JWT v2 | Includes performance chart and metrics |
| GET | /portfolio/report | Get portfolio analysis report (xRay) | JWT | Shows portfolio allocation analysis |
| PUT | /portfolio/holding/:dataSource/:symbol/tags | Update tags for a holding | JWT | permission.updateOrder |

## User Management

| Method | Path | Description | Auth Required | Notes |
|--------|------|-------------|---------------|-------|
| DELETE | /user | Delete own account | JWT | Requires access token validation |
| DELETE | /user/:id | Delete any user | JWT | permission.deleteUser; Cannot delete self |
| GET | /user | Get current user profile | JWT | Includes settings, subscriptions, permissions |
| POST | /user | Sign up new user | None | Creates user if signup enabled via property |
| POST | /user/access-token | Rotate own access token | JWT | permission.updateOwnAccessToken |
| POST | /user/:id/access-token | Rotate user access token | JWT | permission.accessAdminControl |
| PUT | /user/setting | Update user settings | JWT | Supports benchmark, dateRange, baseCurrency, etc. |

## Access & Sharing

| Method | Path | Description | Auth Required | Notes |
|--------|------|-------------|---------------|-------|
| DELETE | /access/:id | Delete access/share | JWT | permission.deleteAccess |
| GET | /access | Get all access shares | JWT | Returns PRIVATE and PUBLIC shares |
| POST | /access | Create new access/share | JWT | permission.createAccess; Restricted for Basic subscription |
| PUT | /access/:id | Update access/share permissions | JWT | permission.updateAccess |

## Public/Shared Portfolios

| Method | Path | Description | Auth Required | Notes |
|--------|------|-------------|---------------|-------|
| GET | /public/:accessId/portfolio | Get public portfolio view | None | Restricted data based on access type |

## Admin Functions

| Method | Path | Description | Auth Required | Notes |
|--------|------|-------------|---------------|-------|
| GET | /admin | Get admin dashboard data | JWT | permission.accessAdminControl |
| GET | /admin/demo-user/sync | Sync demo user account | JWT | permission.syncDemoUserAccount |
| POST | /admin/gather | Trigger 7-day data gather | JWT | permission.accessAdminControl |
| POST | /admin/gather/max | Gather all symbol data (full history) | JWT | permission.accessAdminControl |
| POST | /admin/gather/profile-data | Gather asset profile data | JWT | permission.accessAdminControl |
| POST | /admin/gather/profile-data/:dataSource/:symbol | Gather profile for specific symbol | JWT | permission.accessAdminControl |
| POST | /admin/gather/:dataSource/:symbol | Gather data for symbol (date range) | JWT | permission.accessAdminControl |
| POST | /admin/gather/:dataSource/:symbol/:dateString | Gather data for specific date | JWT | permission.accessAdminControl |
| GET | /admin/market-data | Get market data list (with search/filter) | JWT | permission.accessAdminControl; Supports pagination |
| POST | /admin/market-data/:dataSource/:symbol/test | Test scraper configuration | JWT | permission.accessAdminControl |
| DELETE | /admin/profile-data/:dataSource/:symbol | Delete asset profile | JWT | permission.accessAdminControl |
| PATCH | /admin/profile-data/:dataSource/:symbol | Update asset profile | JWT | permission.accessAdminControl |
| POST | /admin/profile-data/:dataSource/:symbol | Add new asset profile | JWT | permission.accessAdminControl |
| PUT | /admin/settings/:key | Update system setting/property | JWT | permission.accessAdminControl |
| GET | /admin/user | Get all users (paginated) | JWT | permission.accessAdminControl |
| GET | /admin/user/:id | Get specific user | JWT | permission.accessAdminControl |

## Queue Management

| Method | Path | Description | Auth Required | Notes |
|--------|------|-------------|---------------|-------|
| DELETE | /admin/queue/job | Bulk delete jobs | JWT | permission.accessAdminControl; Filter by status |
| DELETE | /admin/queue/job/:id | Delete specific job | JWT | permission.accessAdminControl |
| GET | /admin/queue/job | Get all jobs (with status filter) | JWT | permission.accessAdminControl |
| GET | /admin/queue/job/:id/execute | Execute/retry job | JWT | permission.accessAdminControl |

## Cache Management

| Method | Path | Description | Auth Required | Notes |
|--------|------|-------------|---------------|-------|
| POST | /cache/flush | Flush Redis cache | JWT | permission.accessAdminControl |

## Data Access & Symbols

| Method | Path | Description | Auth Required | Notes |
|--------|------|-------------|---------------|-------|
| GET | /symbol/lookup | Search symbols by query | JWT | Supports includeIndices param |
| GET | /symbol/:dataSource/:symbol | Get symbol data with optional history | None | Returns profile and market data |
| GET | /symbol/:dataSource/:symbol/:dateString | Get historical data for date | JWT | Returns market price for date |

## Market Data

| Method | Path | Description | Auth Required | Notes |
|--------|------|-------------|---------------|-------|
| GET | /market-data/markets | Get fear/greed indices | JWT | permission.readMarketDataOfMarkets |
| GET | /market-data/:dataSource/:symbol | Get market data details | JWT | Auth may check permissions |
| POST | /market-data/:dataSource/:symbol | Bulk update market data | JWT | Accepts array of {date, price} |

## Asset/Symbol Management

| Method | Path | Description | Auth Required | Notes |
|--------|------|-------------|---------------|-------|
| GET | /asset/:dataSource/:symbol | Get asset profile and market data | None | Returns basic asset info |

## Exchange Rates

| Method | Path | Description | Auth Required | Notes |
|--------|------|-------------|---------------|-------|
| GET | /exchange-rate/:symbol/:dateString | Get exchange rate for date | JWT | e.g., EURUSD, GBPUSD |

## Benchmarks

| Method | Path | Description | Auth Required | Notes |
|--------|------|-------------|---------------|-------|
| POST | /benchmarks | Add benchmark symbol | JWT | permission.accessAdminControl |
| DELETE | /benchmarks/:dataSource/:symbol | Remove benchmark | JWT | permission.accessAdminControl |
| GET | /benchmarks | Get all benchmarks | None | Public endpoint |
| GET | /benchmarks/:dataSource/:symbol/:startDateString | Get benchmark comparison data | JWT | Full portfolio vs benchmark |

## Watchlists

| Method | Path | Description | Auth Required | Notes |
|--------|------|-------------|---------------|-------|
| GET | /watchlist | Get user watchlist items | JWT | permission.readWatchlist |
| POST | /watchlist | Add item to watchlist | JWT | permission.createWatchlistItem |
| DELETE | /watchlist/:dataSource/:symbol | Remove from watchlist | JWT | permission.deleteWatchlistItem |

## Tags

| Method | Path | Description | Auth Required | Notes |
|--------|------|-------------|---------------|-------|
| GET | /tags | Get all tags with activity counts | JWT | permission.readTags |
| POST | /tags | Create new tag | JWT | permission.createTag or createOwnTag |
| PUT | /tags/:id | Update tag | JWT | permission.updateTag |
| DELETE | /tags/:id | Delete tag | JWT | permission.deleteTag |

## Platforms

| Method | Path | Description | Auth Required | Notes |
|--------|------|-------------|---------------|-------|
| GET | /platform | Get all platforms with account counts | JWT | permission.readPlatformsWithAccountCount |
| GET | /platforms | Get all platforms (simpler) | JWT | permission.readPlatforms |
| POST | /platform | Create new platform | JWT | permission.createPlatform |
| PUT | /platform/:id | Update platform | JWT | permission.updatePlatform |
| DELETE | /platform/:id | Delete platform | JWT | permission.deletePlatform |

## Import/Export

| Method | Path | Description | Auth Required | Notes |
|--------|------|-------------|---------------|-------|
| GET | /export | Export portfolio data (JSON/CSV) | JWT | Supports filtering; Returns activities in export format |
| POST | /import | Import activities and accounts | JWT | permission.createOrder, createAccount; Supports dryRun mode |
| GET | /import/dividends/:dataSource/:symbol | Gather dividends for symbol | JWT | Auto-imports dividend activities |

## API Keys

| Method | Path | Description | Auth Required | Notes |
|--------|------|-------------|---------------|-------|
| POST | /api-keys | Create new API key | JWT | permission.createApiKey; Returns key once |

## Ghostfolio Data Provider (Internal API)

| Method | Path | Description | Auth Required | Notes |
|--------|------|-------------|---------------|-------|
| GET | /data-providers/ghostfolio/asset-profile/:symbol | Get asset profile | API Key | v1; Rate limited |
| GET | /data-providers/ghostfolio/dividends/:symbol | Get dividend history | API Key | v2; Query: from, to, granularity |
| GET | /data-providers/ghostfolio/historical/:symbol | Get historical prices | API Key | v2; Query: from, to, granularity |
| GET | /data-providers/ghostfolio/lookup | Symbol lookup | API Key | v2; Query: query, includeIndices |
| GET | /data-providers/ghostfolio/quotes | Get current quotes | API Key | v2; Query: symbols (comma-separated) |
| GET | /data-providers/ghostfolio/status | Get API usage status | API Key | v2 |

## AI Features

| Method | Path | Description | Auth Required | Notes |
|--------|------|-------------|---------------|-------|
| GET | /ai/prompt/:mode | Generate AI prompt context | JWT | permission.readAiPrompt; Supports filtering; Returns portfolio data for LLM |

## Agent Features

| Method | Path | Description | Auth Required | Notes |
|--------|------|-------------|---------------|-------|
| POST | /agent/chat | Send message to portfolio agent | Optional | Auth via header or body token |
| POST | /agent/feedback | Submit feedback on agent responses | Optional | Returns 200 (no-op endpoint) |
| GET | /agent/widget/:asset | Fetch widget asset (single) | None | Static asset serving |
| GET | /agent/widget/:folder/:asset | Fetch widget asset (nested) | None | Static asset serving |

## Subscription & Billing

| Method | Path | Description | Auth Required | Notes |
|--------|------|-------------|---------------|-------|
| POST | /subscription/redeem-coupon | Redeem subscription coupon | JWT | Creates Premium subscription |
| GET | /subscription/stripe/callback | Stripe checkout callback | None | Handles successful payment |
| POST | /subscription/stripe/checkout-session | Create Stripe checkout session | JWT | Returns session ID for payment |

## System/Meta

| Method | Path | Description | Auth Required | Notes |
|--------|------|-------------|---------------|-------|
| GET | /health | Health check (DB + Redis) | None | Returns OK or SERVICE_UNAVAILABLE |
| GET | /health/data-provider/:dataSource | Data provider health check | None | Checks if provider responding |
| GET | /health/data-enhancer/:name | Data enhancer health check | None | Checks enhancer service |
| GET | /info | Get API info (currencies, data sources) | None | Returns supported options |
| GET | /logo/:dataSource/:symbol | Get asset logo/icon | None | Returns image file |
| GET | /logo | Get logo by URL | None | Query: url |
| GET | /assets/:languageCode/site.webmanifest | Get web manifest | None | VERSION_NEUTRAL |
| GET | /sitemap.xml | Get XML sitemap | None | VERSION_NEUTRAL |

---

## Query Parameter Conventions

### Filtering Parameters
- `accounts` - comma-separated account IDs
- `assetClasses` - comma-separated asset classes (EQUITY, FIXED_INCOME, etc.)
- `dataSource` - data provider (YAHOO, COINGECKO, MANUAL, etc.)
- `symbol` - asset symbol
- `tags` - comma-separated tag IDs
- `query` - free-text search

### Pagination & Sorting
- `skip` - number of records to skip (default 0)
- `take` - number of records to return (default all)
- `sortColumn` - field to sort by
- `sortDirection` - asc or desc

### Date/Time Parameters
- `range` - date range preset: 1d, 7d, 1m, 3m, ytd, max
- `dateString` - ISO date string (YYYY-MM-DD)

### Special Parameters
- `dryRun` - true/false (import only)
- `includeHistoricalData` - 0 or number of days
- `withMarkets` - true/false (portfolio details)
- `withExcludedAccounts` - true/false (portfolio performance)
- `holdingType` - filter holding type
- `presetId` - market data preset

### Headers
- `Authorization` - Bearer {jwt_token} or Bearer {api_key}
- `impersonation-id` - Impersonate another user (admin only, usually)
- `Accept-Language` - User language preference

---

## Response Structures

### Standard Success Response
All successful endpoints return data in their respective DTOs/Interfaces (PortfolioDetails, AccountsResponse, etc.)

### Standard Error Response
```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": ["Error details"]
}
```

### Common Status Codes
- 200 OK - Success
- 201 Created - Resource created
- 204 No Content - Success with no body
- 400 Bad Request - Validation error
- 401 Unauthorized - No auth header
- 403 Forbidden - Auth failed or insufficient permissions
- 404 Not Found - Resource not found
- 429 Too Many Requests - Rate limit (Ghostfolio data provider)
- 500 Internal Server Error - Server error
- 503 Service Unavailable - Health check failed

---

## Authentication & Authorization

### JWT Authentication
Standard bearer token in Authorization header:
```
Authorization: Bearer <jwt_token>
```

### API Key Authentication
For data provider endpoints:
```
Authorization: Bearer <api_key>
```

### Permission-Based Access
Most endpoints require specific permissions. Check controller for @HasPermission decorator.

Common permissions:
- `accessAdminControl` - Admin panel access
- `createOrder`, `updateOrder`, `deleteOrder` - Activity management
- `createAccount`, `updateAccount`, `deleteAccount` - Account management
- `readWatchlist`, `createWatchlistItem` - Watchlist management
- `readTags`, `createTag`, `updateTag`, `deleteTag` - Tag management
- And many more specific to features

---

## Data Transformation & Interceptors

### Key Interceptors
1. **RedactValuesInResponseInterceptor** - Removes sensitive values for restricted views
2. **TransformDataSourceInRequestInterceptor** - Normalizes dataSource names in requests
3. **TransformDataSourceInResponseInterceptor** - Normalizes dataSource in responses
4. **PerformanceLoggingInterceptor** - Logs endpoint performance metrics

### Special Cases
- Restricted views (guest/read-only) return percentage allocations instead of absolute values
- Basic subscription users get limited data (nullified sensitive fields)
- Premium users get full data access

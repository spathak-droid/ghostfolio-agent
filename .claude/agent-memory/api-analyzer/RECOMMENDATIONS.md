# API Usage Recommendations & Caveats

## Essential APIs for Common Tasks

### User Authentication & Session Management
**Best Endpoints**:
- `POST /auth/anonymous` - Quick access with token
- `GET /auth/google` + `/auth/google/callback` - OAuth2 login
- `POST /auth/webauthn/*` - Passwordless login (modern)

**Caveat**: JWT tokens have expiry; implement refresh logic on client.

### Portfolio Overview
**Best Endpoint**: `GET /portfolio/details`
- Returns comprehensive portfolio snapshot
- Includes accounts, holdings, platforms, markets
- Performance data included in response
- Single request for most dashboard views

**Caveat**: Heavy calculation (may be slow for large portfolios). Cache response on client.

### Portfolio Performance Analysis
**Best Endpoint**: `GET /portfolio/performance` (v2)
- Returns performance chart data with timestamps
- Includes netPerformance percentage
- Supports date range filtering
- Use for performance graphs

**Caveat**: May be slow; uses PerformanceLoggingInterceptor. Consider pagination if very large.

### Activity/Order Management
**Common Tasks**:
- Create order: `POST /order` - Validates data, triggers background data gathering
- List orders: `GET /order` - Supports filtering, pagination, sorting
- Update order: `PUT /order/:id` - Edit existing order
- Delete order: `DELETE /order/:id` - Delete single; `DELETE /order?filters` bulk delete

**Best Practice**: Use bulk delete with filtering instead of multiple DELETE calls.

### Account Management
**Common Tasks**:
- List accounts: `GET /account` - With aggregations
- Get details: `GET /account/:id` - Single account detail
- Create: `POST /account` - Can link to platform
- Update: `PUT /account/:id` - Update name, currency, etc.
- Delete: `DELETE /account/:id` - Only if no activities

**Caveat**: Cannot delete account with existing activities (validation enforced server-side).

### Data Import/Export
**Import**: `POST /import`
- Bulk-load activities, accounts, and profiles
- Supports dry-run mode for validation
- Returns errors for invalid records
- Premium users: unlimited activities; basic: capped at MAX_ACTIVITIES_TO_IMPORT

**Export**: `GET /export`
- Returns portfolio data in standardized format
- Supports filtering by accounts, symbols, tags, asset classes
- Use for backups or third-party integration

**Best Practice**: Always use dryRun=true first to validate data.

### Watchlist Management
**Endpoints**:
- `GET /watchlist` - List user's watchlist
- `POST /watchlist` - Add symbol to watchlist
- `DELETE /watchlist/:dataSource/:symbol` - Remove from watchlist

**Caveat**: Requires dataSource transformation (use lowercase: 'YAHOO', not 'Yahoo Finance').

### Tag Management
**Endpoints**:
- `GET /tags` - List all tags with activity counts
- `POST /tags` - Create new tag
- `PUT /tags/:id` - Update tag
- `DELETE /tags/:id` - Delete tag (cascade behavior TBD)

**Best Practice**: Bulk-tag orders via `/order/:id` PUT, not individual tag operations.

---

## Authentication Best Practices

### JWT Token Handling
- **Store**: Never in localStorage alone; use httpOnly cookies if possible
- **Refresh**: Implement refresh token logic (expires field in token)
- **Revocation**: Access token rotation via `/user/access-token` or `/user/:id/access-token`

### API Key Usage (for data provider)
- **Creation**: `POST /api-keys` - Returns key once; save securely
- **Expiration**: Check rate limits; keys may have daily request limits
- **Security**: Treat like passwords; rotate periodically

### WebAuthn (Passwordless)
- **Registration**: 1-time setup via `/auth/webauthn/generate-registration-options` + verify
- **Login**: Use `/auth/webauthn/generate-authentication-options` to start, then verify
- **Device Management**: Delete unused devices via `/auth-device/:id`

---

## Permission Model Guidance

### Admin Tasks (require `accessAdminControl`)
- View all users
- Modify system settings
- Manage benchmarks
- Gather market data
- Manage queue jobs
- Flush cache

### User Tasks (require specific permissions)
- Create orders: `createOrder`
- Manage accounts: `createAccount`, `updateAccount`, `deleteAccount`
- Manage tags: `createTag`, `updateTag`, `deleteTag`
- Share portfolio: `createAccess`, `updateAccess`, `deleteAccess`

### Check Permission Before Calling
```typescript
if (!hasPermission(user.permissions, permissions.createOrder)) {
  // Show UI button as disabled or hide entirely
}
```

---

## API Response Handling

### Filtering & Pagination
**Pattern**: Most list endpoints support:
```
GET /resource?accounts=id1,id2&skip=0&take=20&sortColumn=name&sortDirection=asc
```

**Best Practice**: Always request specific fields needed; pagination defaults to all records.

### Data Transformation
**Input**: User-friendly names ('Yahoo Finance')
**Output**: Canonical names ('YAHOO')

The API handles this via interceptors, but be aware:
- Requests may transform your input
- Responses will be in canonical form
- Always use canonical form in subsequent requests

### Rate Limiting
Only applies to `/data-providers/ghostfolio/*` endpoints:
- **Limit**: Varies per user/subscription tier
- **Check**: Response will be 429 TOO_MANY_REQUESTS if exceeded
- **Reset**: Daily; check `/data-providers/ghostfolio/status` for usage

### Error Responses
Always handle both formats:
```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": ["Specific error details"]
}
```

---

## Performance Considerations

### Portfolio Details Calculation
- **Heavy**: Involves complex financial calculations
- **Solution**: Cache on client; revalidate on portfolio changes
- **Alternative**: If only needing summary, request specific endpoint instead of full details

### Large Portfolios (1000+ positions)
- **Issue**: Listing all holdings may timeout
- **Solution**: Use pagination, filtering, date ranges
- **Example**: `GET /portfolio/holdings?take=100&skip=0`

### Bulk Operations
- **Prefer**: Bulk delete/update vs. individual operations
- **Example**: `DELETE /order?symbol=AAPL` instead of `DELETE /order/:id1`, `DELETE /order/:id2`...

### Data Provider Rate Limiting
- **Avoid**: Calling `/symbol/:dataSource/:symbol` repeatedly
- **Solution**: Batch requests, cache results, use `/data-providers/ghostfolio/quotes` for multiple symbols

---

## Subscription-Aware Features

### Premium Features
- Unlimited activity import
- Full portfolio data visibility in shared views
- AI prompt generation (`/ai/prompt/:mode`)
- Advance portfolio analysis features

### Basic/Free Features
- Limited activity import (MAX_ACTIVITIES_TO_IMPORT)
- Restricted data visibility (values nullified)
- Percentage-based allocations only
- Limited access sharing

**Check Before Calling**:
```typescript
if (!user.subscription || user.subscription.type !== 'Premium') {
  // Disable premium-only features in UI
}
```

---

## Data Validation Rules

### Create/Update DTOs
All require validation; common patterns:

**Orders**:
- `type`: BUY, SELL, DIVIDEND, FEE, GIFT, INFLOW, INTEREST, OUTFLOW, REBALANCE, SPLIT, TAX
- `currency`: Valid ISO 4217 code
- `symbol`: Non-empty string
- `quantity`: Positive number
- `unitPrice`: Positive number
- `date`: ISO date string (YYYY-MM-DD)

**Accounts**:
- `name`: Non-empty string
- `currency`: Valid ISO 4217 code
- `balance`: Numeric value
- `platformId`: Optional, must exist if provided

**Tags**:
- `name`: Non-empty, unique per user
- `color`: Optional hex code

### Validation Errors
If validation fails, API returns:
```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": ["Field must not be empty", "Invalid date format"]
}
```

---

## Edge Cases & Gotchas

### 1. Composite Keys
Some entities use composite keys:
- `Account`: Identified by `{id, userId}` not just `id`
- May affect update/delete operations

### 2. Soft Deletes
Records often have `deletedAt` field:
- `deletedAt === null` means active
- Deletes are soft by default
- Hard delete may not be exposed

### 3. Currency Conversion
Values are stored in original currency:
- Conversion to base currency done at query time
- Use `userCurrency` param where available
- Exchange rates from `ExchangeRateService`

### 4. Date Handling
- All dates in ISO 8601 format
- No timezone info stored; assumes user timezone
- "Today" is relative to server time, not client time

### 5. Portfolio Calculations
- Include/exclude accounts/activities via filter
- Calculations recalculated each request (not cached)
- Large portfolios may be slow

### 6. DataSource Normalization
- Input: `'Yahoo Finance'`, `'yahoo'`, `'YAHOO'`
- Output: Always `'YAHOO'` (canonical)
- Case-insensitive in requests, always uppercase in responses

### 7. Market Data Updates
- Not real-time; updated by background jobs
- Check data timestamps; may be stale
- Use `/admin/gather/:dataSource/:symbol` to force refresh (admin only)

### 8. Impersonation
- Requires admin privilege
- Returns data as if impersonated user
- No audit logging visible in API (implement on client if needed)

---

## Testing Recommendations

### Unit Testing Endpoints
**Pattern**:
```typescript
it('should create order with valid data', async () => {
  const response = await controller.createOrder(createOrderDto, mockRequest);
  expect(response.id).toBeDefined();
  expect(orderService.createOrder).toHaveBeenCalled();
});
```

### Integration Testing
- Mock Prisma service to avoid DB dependency
- Use factory functions to create test data
- Test with multiple permission levels

### E2E Testing
- Use actual test database
- Clear data between tests
- Test full request/response cycle

### Mock Data Strategy
- Create user, account, orders in setup
- Use consistent IDs for predictability
- Reset state between test suites

---

## Security Best Practices

### 1. Input Validation
Always validate on both client and server:
- DTO validation catches malformed requests
- Never trust client-side validation alone

### 2. Authorization Checks
Every endpoint should verify:
- User authentication (JWT/API key valid)
- User owns the resource (account.userId === user.id)
- User has required permission (@HasPermission)

### 3. Sensitive Data
- Never log full credit card, API keys, passwords
- Use RedactValuesInResponseInterceptor for restricted views
- Implement audit logging for sensitive operations

### 4. Rate Limiting
- Implement client-side backoff for 429 responses
- Cache responses to reduce API calls
- Don't retry immediately on rate limit

### 5. HTTPS Only
- Never send JWT/API keys over HTTP
- Always use HTTPS in production
- Use secure httpOnly cookies if possible

### 6. CORS
- Restrict CORS to known origins
- Don't use `*` in production
- Validate Origin header on backend

---

## Deprecated Endpoints (Avoid)

### Authentication
- `GET /auth/anonymous/:accessToken` - Use `POST /auth/anonymous` instead

### Avoid if Possible
- Direct symbol data retrieval if possible; prefer data provider endpoints
- Mixing v1 and v2 responses in same app

---

## Common Patterns for Client Integration

### Portfolio Dashboard
```typescript
// 1. Load portfolio overview
const portfolio = await get('/portfolio/details');

// 2. Load performance chart
const performance = await get('/portfolio/performance?range=ytd');

// 3. Load recent activities
const orders = await get('/order?take=10&sortColumn=date&sortDirection=desc');

// 4. Cache all three; refresh on: order create/update/delete or manual refresh
```

### Order Management UI
```typescript
// 1. List orders with filtering
const { activities, count } = await get('/order?accounts=acc1&take=20&skip=0');

// 2. Create order with data gathering
const order = await post('/order', orderData);
// → Background job will fetch market data

// 3. Allow bulk delete
await delete('/order?symbol=AAPL&dataSource=YAHOO');
```

### Admin Panel
```typescript
// 1. Load admin data
const admin = await get('/admin');

// 2. Gather market data
await post('/admin/gather/7days');

// 3. Monitor queue
const jobs = await get('/admin/queue/job');

// 4. Manage users
const users = await get('/admin/user?take=50&skip=0');
```

---

## Logging & Debugging

### Enable Request Logging
- Check server logs for full request/response
- PerformanceLoggingInterceptor logs slow endpoints
- Implement client-side logging for API calls

### Performance Profiling
- Use `/portfolio/performance` for endpoint timing
- Monitor portfolio calculation time
- Check data provider response times

### Error Investigation
- Preserve full error response for debugging
- Include request context (user, filters, etc.)
- Log unusual response patterns

---

## Future API Changes to Monitor

### Potential Breaking Changes
- API versioning (v3 possible)
- New permission model
- Subscription tier restructuring
- DataSource/provider changes

### Deprecation Timeline
- Check JSDoc for `@deprecated` markers
- Old endpoints removed after grace period
- Monitor API changelog/release notes

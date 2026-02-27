# Ghostfolio API - Quick Reference Guide

## Directory Structure
```
/api → NestJS application
├── Controllers (34 total) → HTTP endpoints
├── Services → Business logic
├── Guards → Permission checks
├── Interceptors → Request/response processing
└── Modules → Feature grouping
```

---

## API Root Path
All endpoints under: `/api/v{version}/`

**Version Handling**:
- Most endpoints: implicit v1
- Some endpoints: explicit `@Version('2')`
- Public assets: `VERSION_NEUTRAL` (no versioning)

---

## Authentication Quick Start

### JWT (Default)
```
Authorization: Bearer <jwt_token>
```
Used by: Most endpoints

### API Key (Data Providers)
```
Authorization: Bearer <api_key>
```
Used by: `/data-providers/ghostfolio/*`

### OAuth
Redirect to `/auth/google` or `/auth/oidc`

### WebAuthn
POST → `/auth/webauthn/generate-authentication-options` → verify with credential

---

## Most-Used Endpoints

| Task | Endpoint | Method |
|------|----------|--------|
| Get current user | `/user` | GET |
| Get portfolio overview | `/portfolio/details` | GET |
| List orders | `/order` | GET |
| Create order | `/order` | POST |
| List accounts | `/account` | GET |
| Create account | `/account` | POST |
| List tags | `/tags` | GET |
| Create tag | `/tags` | POST |
| Get portfolio performance | `/portfolio/performance` | GET (v2) |
| Import data | `/import` | POST |
| Export data | `/export` | GET |

---

## Common Query Parameters

### Filtering
- `accounts=id1,id2` - Filter by account IDs
- `assetClasses=EQUITY,FIXED_INCOME` - Asset class filter
- `dataSource=YAHOO` - Data provider filter
- `symbol=AAPL` - Symbol filter
- `tags=tag1,tag2` - Tag filter
- `query=search` - Free-text search

### Pagination
- `skip=0` - Offset (default: 0)
- `take=20` - Limit (default: all)
- `sortColumn=name` - Sort field
- `sortDirection=asc` - asc or desc

### Date Ranges
- `range=1d` - Last 1 day
- `range=7d` - Last 7 days
- `range=1m` - Last 1 month
- `range=3m` - Last 3 months
- `range=ytd` - Year to date
- `range=max` - All time (default)

### Special
- `dryRun=true` - Validation only (import)
- `includeIndices=true` - Include indices in symbol lookup
- `withMarkets=true` - Include market data

---

## Standard Status Codes

| Code | Meaning |
|------|---------|
| 200 | OK - Success |
| 201 | Created - New resource |
| 204 | No Content - Success, empty body |
| 400 | Bad Request - Validation error |
| 401 | Unauthorized - No auth or invalid token |
| 403 | Forbidden - No permission |
| 404 | Not Found - Resource missing |
| 429 | Too Many Requests - Rate limit |
| 500 | Internal Server Error |
| 503 | Service Unavailable - Health check failed |

---

## Common Response Patterns

### Success (Array)
```json
{
  "accounts": [...],
  "count": 10
}
```

### Success (Object)
```json
{
  "id": "uuid",
  "name": "My Account",
  "currency": "USD"
}
```

### Error
```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": ["Field is required"]
}
```

---

## Permission Examples

### Public (No Auth)
- `GET /info` - API information
- `GET /symbol/:dataSource/:symbol` - Symbol data
- `GET /benchmarks` - Benchmark list
- `GET /health` - Health check

### User Auth Required
- Most endpoints require `AuthGuard('jwt')`
- Check `@HasPermission` for specific permissions
- Common: `createOrder`, `updateAccount`, `readWatchlist`

### Admin Only
- Prefix with `/admin` or explicit `accessAdminControl` permission
- Examples: `/admin`, `/admin/user`, `/cache/flush`

---

## Entity Relationships

```
User
├── Accounts
│   ├── Orders/Activities
│   └── Account Balances
├── Tags
├── Accesses (Shares)
├── Auth Devices (WebAuthn)
├── Subscription
└── Settings
```

---

## Data Models Quick Reference

### Account
```
{
  id: string,
  userId: string,
  name: string,
  currency: string,
  balance: number,
  platformId?: string,
  createdAt: Date,
  updatedAt: Date
}
```

### Order/Activity
```
{
  id: string,
  userId: string,
  accountId?: string,
  type: 'BUY' | 'SELL' | 'DIVIDEND' | 'FEE' | ...,
  symbol: string,
  dataSource: string,
  currency: string,
  date: Date,
  quantity: number,
  unitPrice: number,
  value: number,
  fee: number,
  tags: Tag[],
  isDraft: boolean,
  createdAt: Date,
  updatedAt: Date
}
```

### Tag
```
{
  id: string,
  userId: string,
  name: string,
  color?: string,
  createdAt: Date,
  updatedAt: Date
}
```

### Portfolio (Calculated)
```
{
  accounts: { [key]: Account },
  holdings: { [symbol]: Holding },
  platforms: { [name]: Platform },
  markets: { [market]: Market },
  summary: {
    totalInvestment: number,
    currentNetWorth: number,
    netPerformance: number,
    netPerformancePercentage: number,
    ...
  }
}
```

---

## Workflow Examples

### Create Portfolio Entry
1. Create Account: `POST /account`
2. Create Order: `POST /order` (references account)
3. (Automatic) Background data gathering starts
4. View in Portfolio: `GET /portfolio/details`

### Update Account
1. Get Account: `GET /account/:id`
2. Update: `PUT /account/:id`
3. If currency changed: Portfolio recalculates automatically

### Share Portfolio
1. Create Access: `POST /access` (with permissions)
2. Share link: `/public/{accessId}/portfolio`
3. Guest views restricted data (no values, percentages only)

### Admin Data Gathering
1. Check status: `GET /admin`
2. Trigger gather: `POST /admin/gather/7days`
3. Monitor jobs: `GET /admin/queue/job`

---

## Error Handling Checklist

- [ ] Always check HTTP status code
- [ ] Parse error message for user display
- [ ] Handle 429 (rate limit) with exponential backoff
- [ ] Handle 403 (permission) by disabling UI feature
- [ ] Handle 401 (auth) by redirecting to login
- [ ] Handle 4xx validation errors gracefully
- [ ] Handle 5xx server errors with retry logic

---

## Performance Tips

1. **Cache responses** locally to avoid repeated calls
2. **Batch requests** when possible (bulk delete, bulk import)
3. **Use pagination** for large datasets
4. **Filter at API** level, not client-side
5. **Avoid N+1 queries** - use include/select in Prisma
6. **Monitor rate limits** - check `/health/data-provider/:dataSource`
7. **Async operations** - orders trigger background data gathering

---

## Environment & Configuration

### Key Environment Variables
- `DATABASE_URL` - PostgreSQL connection
- `REDIS_URL` - Redis connection
- `JWT_SECRET` - JWT signing key
- `ADMIN_ID` - Quick admin access ID
- `ROOT_URL` - Base URL for redirects
- `ENABLE_FEATURE_SUBSCRIPTION` - Enable premium features
- `ENABLE_FEATURE_AUTH_OIDC` - Enable OIDC login

### Feature Flags
- `ENABLE_FEATURE_SUBSCRIPTION` - Subscription system
- `ENABLE_FEATURE_AUTH_OIDC` - OIDC authentication
- Check `ConfigurationService.get()` calls in controllers

---

## File Locations Reference

| Feature | Files |
|---------|-------|
| Controllers | `/app/*/\*.controller.ts` |
| Services | `/app/*/\*.service.ts` |
| Auth Guards | `/guards/\*.guard.ts` |
| Interceptors | `/interceptors/\*/\*.interceptor.ts` |
| DTOs | `@ghostfolio/common/dtos` |
| Interfaces | `@ghostfolio/common/interfaces` |
| Constants | `@ghostfolio/common/config` |
| Permissions | `@ghostfolio/common/permissions` |

---

## Testing Shortcuts

### JWT Test Token
Generate with `JwtService.sign({ id: userId })`

### Mock User
```typescript
const mockRequest = {
  user: {
    id: 'user-123',
    permissions: [permissions.createOrder],
    settings: { settings: { baseCurrency: 'USD' } }
  }
};
```

### Mock Prisma
```typescript
const prismaServiceMock = {
  order: { create: jest.fn(), findMany: jest.fn() },
  account: { create: jest.fn() },
  // ...
};
```

---

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| 401 Unauthorized | No JWT or invalid | Check Authorization header |
| 403 Forbidden | No permission | Check user.permissions array |
| 404 Not Found | Resource missing | Verify resource ID exists |
| 429 Rate Limited | Too many requests | Wait, check daily limits |
| Empty response | Data filtered out | Check filter parameters |
| Slow response | Large calculation | Use pagination, filters, date ranges |
| CORS error | Wrong origin | Check CORS configuration |

---

## Links & References

### Key Files
- Main controller: `/app.controller.ts` (initializes services)
- Auth config: `/auth/auth.service.ts` (strategies)
- Permission model: `@ghostfolio/common/permissions`
- Database schema: Prisma schema file (check project root)

### Documentation
- NestJS: https://docs.nestjs.com
- Prisma: https://www.prisma.io/docs
- Passport: http://www.passportjs.org

### API Docs
This catalog: See `API_ENDPOINTS.md` for full list
Performance notes: See `PATTERNS_AND_ARCHITECTURE.md`
Caveats: See `RECOMMENDATIONS.md`

---

## Version Info

- **Current Analysis Date**: 2026-02-26
- **Framework**: NestJS + Prisma
- **Database**: PostgreSQL
- **Cache**: Redis
- **Controllers**: 34 total
- **Endpoints**: 100+
- **Auth Methods**: 6 (JWT, API Key, Google, OIDC, WebAuthn, Anonymous)

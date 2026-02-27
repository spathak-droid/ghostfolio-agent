# Ghostfolio API - Patterns and Architecture

## Framework & Technology Stack

### Core Framework
- **NestJS** - TypeScript framework for building server-side applications
- **Prisma** - Database ORM for type-safe database access
- **Passport** - Authentication middleware
- **Bull** - Job queue for background processing
- **Redis** - Caching layer

### Project Structure
```
apps/api/src/app/
├── access/                    # Access/sharing management
├── account/                   # Account management
├── account-balance/           # Balance history tracking
├── admin/                     # Admin operations (users, profiling)
│   └── queue/                 # Job queue management
├── agent/                     # Portfolio AI agent
├── auth/                      # Authentication strategies
├── auth-device/               # WebAuthn device management
├── asset/                     # Asset/symbol information
├── cache/                     # Cache management
├── endpoints/                 # Public/specialized endpoints
│   ├── ai/                    # AI prompt generation
│   ├── api-keys/              # API key management
│   ├── assets/                # Static assets (manifest)
│   ├── benchmarks/            # Benchmark management
│   ├── data-providers/        # Data provider APIs
│   │   └── ghostfolio/        # Ghostfolio internal provider
│   ├── market-data/           # Market data queries
│   ├── platforms/             # Trading platforms
│   ├── public/                # Public portfolio shares
│   ├── sitemap/               # XML sitemap
│   ├── tags/                  # Tag management
│   └── watchlist/             # User watchlists
├── exchange-rate/             # Currency exchange rates
├── export/                    # Portfolio export
├── health/                    # Health check endpoints
├── import/                    # Portfolio import
├── info/                      # API information
├── logo/                      # Asset logos
├── order/                     # Orders/activities
├── platform/                  # Platform management
├── portfolio/                 # Portfolio analytics
├── subscription/              # Subscription/billing
├── symbol/                    # Symbol lookup & data
└── user/                      # User management
```

---

## Authentication Patterns

### 1. JWT-Based Authentication
**File**: `/auth/jwt.strategy.ts`
- Standard bearer token in Authorization header
- Payload contains user ID
- Used by most endpoints via `@UseGuards(AuthGuard('jwt'), HasPermissionGuard)`

### 2. API Key Authentication
**File**: `/auth/api-key.strategy.ts`
- Bearer token format same as JWT
- Used for data provider endpoints
- Tracked with daily request limits
- Endpoint: `/data-providers/ghostfolio/*`

### 3. Google OAuth
**File**: `/auth/google.strategy.ts`
- Endpoints: `/auth/google` → `/auth/google/callback`
- Callback redirects to `ROOT_URL/{language}/auth/{jwt}`

### 4. OIDC (OpenID Connect)
**File**: `/auth/oidc.strategy.ts`
- Endpoints: `/auth/oidc` → `/auth/oidc/callback`
- Feature flag: `ENABLE_FEATURE_AUTH_OIDC`
- Uses OIDCStateStore for state management

### 5. WebAuthn (Passwordless)
**File**: `/auth/web-auth.service.ts`
- Registration: `/auth/webauthn/generate-registration-options` + `/auth/webauthn/verify-attestation`
- Authentication: `/auth/webauthn/generate-authentication-options` + `/auth/webauthn/verify-authentication`
- Stores credentials in `AuthDevice` table

### 6. Anonymous/Access Token
**File**: `/auth/auth.service.ts`
- Method: `validateAnonymousLogin(accessToken)`
- Used for: Read-only access to shared portfolios, admin quick-access
- Returns: JWT token valid for session

---

## Authorization & Permissions

### Permission Model
**Location**: `@ghostfolio/common/permissions`

Key permission constants:
- `accessAdminControl` - Full admin access
- `createOrder`, `updateOrder`, `deleteOrder` - Activity management
- `createAccount`, `updateAccount`, `deleteAccount` - Account CRUD
- `readWatchlist`, `createWatchlistItem`, `deleteWatchlistItem` - Watchlist
- `readTags`, `createTag`, `updateTag`, `deleteTag` - Tag CRUD
- `createAccess`, `updateAccess`, `deleteAccess` - Share/access management
- `readAiPrompt` - AI prompt generation
- `enableDataProviderGhostfolio` - Ghostfolio data provider access
- And 30+ more...

### Permission Enforcement
```typescript
@HasPermission(permissions.createOrder)
@UseGuards(AuthGuard('jwt'), HasPermissionGuard)
public async createOrder(@Body() data: CreateOrderDto) { ... }
```

**Files**:
- Decorator: `/decorators/has-permission.decorator.ts`
- Guard: `/guards/has-permission.guard.ts`

### User Roles
- `ADMIN` - Full system access
- `USER` - Normal user (restricted features based on subscription)
- `DEMO` - Demo account (limited to benchmark/dateRange changes)

### Subscription Tiers
- **Free/Basic** - Limited features, reduced data visibility
- **Premium** - Full feature access, all data visible

---

## Common Endpoint Patterns

### 1. Resource CRUD Operations
Standard pattern for most resources (Accounts, Orders, Tags, Platforms):

```typescript
@Get()                              // List all
@Get(':id')                         // Get single
@Post()                             // Create
@Put(':id')                         // Update
@Delete(':id')                      // Delete
@Delete()                           // Bulk delete by filters
```

### 2. Filtering
All list endpoints support filtering via query parameters:

```typescript
@Get()
public async getItems(
  @Query('accounts') filterByAccounts?: string,      // ID list
  @Query('assetClasses') filterByAssetClasses?: string,
  @Query('dataSource') filterByDataSource?: string,
  @Query('symbol') filterBySymbol?: string,
  @Query('tags') filterByTags?: string,
  @Query('query') filterBySearchQuery?: string
)
```

**Processing**: Uses `ApiService.buildFiltersFromQueryParams()` to create filter objects.

### 3. Pagination
List endpoints typically support:
```typescript
@Query('skip') skip?: number,       // Offset
@Query('take') take?: number,       // Limit
@Query('sortColumn') sortColumn?: string,
@Query('sortDirection') sortDirection?: Prisma.SortOrder
```

Defaults: skip=0, take=all (unlimited)

### 4. Date Range Queries
Portfolio & performance endpoints use:
```typescript
@Query('range') dateRange: DateRange = 'max'
```

Valid values: `'1d' | '7d' | '1m' | '3m' | 'ytd' | 'max'`

**Processing**: `getIntervalFromDateRange(dateRange)` → `{startDate, endDate}`

### 5. Impersonation
Admin can view other users' data:
```typescript
@Headers(HEADER_KEY_IMPERSONATION.toLowerCase()) impersonationId?: string
```

**Validation**: `ImpersonationService.validateImpersonationId(impersonationId)`

### 6. DataSource Transformation
Converts user-friendly names to canonical form:
- Interceptor: `TransformDataSourceInRequestInterceptor`
- Interceptor: `TransformDataSourceInResponseInterceptor`
- Example: 'Yahoo Finance' → 'YAHOO'

---

## Response Handling & Interceptors

### 1. RedactValuesInResponseInterceptor
Removes or nullifies sensitive data for:
- Restricted view users (guest/read-only access)
- Basic subscription users (limited data)

Nullified fields:
- `currentNetWorth`, `currentValueInBaseCurrency`
- `grossPerformance`, `netPerformance`
- `cash`, `totalInvestment`, `fees`
- And more context-specific fields

### 2. TransformDataSourceInRequest/Response
Normalizes data source names for consistency across API boundaries.

### 3. PerformanceLoggingInterceptor
**File**: `/interceptors/performance-logging/performance-logging.interceptor.ts`

Used on expensive endpoints like:
- `GET /portfolio/performance` (v2)

Logs execution time for monitoring.

---

## Validation & Error Handling

### DTOs (Data Transfer Objects)
**Location**: `@ghostfolio/common/dtos`

Common DTOs:
- `CreateOrderDto`, `UpdateOrderDto` - Activity creation/update
- `CreateAccountDto`, `UpdateAccountDto` - Account management
- `CreateAccessDto`, `UpdateAccessDto` - Access sharing
- `CreateTagDto`, `UpdateTagDto` - Tag management
- `UpdateUserSettingDto` - User preferences
- And more...

**Validation**: NestJS class-validator decorators (@IsString, @IsNumber, etc.)

### Error Response Format
```typescript
throw new HttpException(
  getReasonPhrase(StatusCodes.BAD_REQUEST),
  StatusCodes.BAD_REQUEST
);

// OR with details:
throw new HttpException(
  {
    error: getReasonPhrase(StatusCodes.BAD_REQUEST),
    message: ['Detailed error message']
  },
  StatusCodes.BAD_REQUEST
);
```

**Status Codes**:
- 200 OK - Success
- 400 Bad Request - Validation error
- 401 Unauthorized - Missing auth
- 403 Forbidden - Permission denied
- 404 Not Found - Resource not found
- 429 Too Many Requests - Rate limit (data providers)
- 500 Internal Server Error - Server error
- 503 Service Unavailable - Service down

---

## Database Access Patterns

### Prisma Usage
All database queries go through Prisma ORM.

**Common patterns**:
```typescript
// Single record
const user = await this.prismaService.user.findUnique({
  where: { id: userId }
});

// Multiple records with relations
const accounts = await this.prismaService.account.findMany({
  where: { userId, deletedAt: null },
  include: { activities: true }
});

// Create with relations
const order = await this.prismaService.order.create({
  data: {
    ...orderData,
    user: { connect: { id: userId } },
    SymbolProfile: { connectOrCreate: { ... } }
  }
});

// Update nested data
await this.prismaService.order.update({
  where: { id: orderId },
  data: { tags: { set: tagIds.map(id => ({ id })) } }
});
```

**Composite Keys**: Some entities use composite primary keys:
- `Account`: `{id, userId}`
- `AccountBalance`: `{accountId, date}`

---

## Caching Strategy

### Redis Cache Service
**File**: `/redis-cache/redis-cache.service.ts`

Usage:
```typescript
public async reset(): Promise<void>
public async get<T>(key: string): Promise<T | null>
public async set(key: string, value: any, ttl?: number): Promise<void>
```

Endpoint to flush: `POST /cache/flush` (admin only)

### Cache Keys
Common patterns:
- Portfolio calculations
- Symbol lookups
- Exchange rates
- Data provider responses

---

## Background Job Processing

### Bull Job Queue
**Service**: `DataGatheringService`

Job types:
- `GATHER_ASSET_PROFILE_PROCESS_JOB_NAME` - Fetch asset profile data
- `GATHER_SYMBOL_DATA_JOB_NAME` - Fetch historical prices
- Custom symbol gathering jobs

**Priority Levels**:
- `DATA_GATHERING_QUEUE_PRIORITY_HIGH` (default 10) - User-initiated
- `DATA_GATHERING_QUEUE_PRIORITY_MEDIUM` (default 5) - Bulk operations
- `DATA_GATHERING_QUEUE_PRIORITY_LOW` (default 1) - Background tasks

**Management Endpoints**:
- `GET /admin/queue/job` - List jobs
- `DELETE /admin/queue/job/:id` - Delete job
- `GET /admin/queue/job/:id/execute` - Retry job

---

## Special Features

### 1. Portfolio Performance Calculation
**Files**:
- `/portfolio/portfolio.service.ts` - Main calculation engine
- `/portfolio/calculator/` - Calculator implementations
- Supports MWR (Money-Weighted Return) and ROAI calculations

Key metrics calculated:
- `netPerformance` - Return value
- `netPerformancePercentage` - Return percentage
- `netPerformanceWithCurrencyEffect` - Including FX changes
- `totalInvestment` - Sum of deposits
- `currentNetWorth` - Current value
- `currentValueInBaseCurrency` - Value in user's base currency

### 2. Dividend Tracking
Tracked via activities with type: `DIVIDEND`
- Can be imported via `/import/dividends/:dataSource/:symbol`
- Grouped and filtered in portfolio views

### 3. Data Provider Integration
**Files**: `/services/data-provider/`

Supported providers:
- YAHOO (Yahoo Finance)
- COINGECKO (CoinGecko for crypto)
- MANUAL (User-entered data)
- GHOSTFOLIO (Internal data provider)
- FINANCIAL_MODELING_PREP
- And more...

Each provider has:
- Quote fetching
- Historical data fetching
- Asset profile fetching
- Dividend data fetching

### 4. Public Portfolio Sharing
**Pattern**: Access-based sharing

- Private access: Share with specific user (requires grantee)
- Public access: Anyone with URL can view (no grantee)
- Read-only view with restricted data

**Data Restrictions**:
- No absolute values (only percentages)
- No individual account values
- Last 10 activities shown
- Performance percentages only

### 5. Impersonation
Admin can impersonate users for debugging:
- Header: `impersonation-id: {userId}`
- Returns data as if logged in as that user
- Audit logging should be implemented

---

## Configuration & Feature Flags

### Environment Variables
Key configs loaded via `ConfigurationService`:
- `ENABLE_FEATURE_AUTH_OIDC` - Enable OIDC login
- `ENABLE_FEATURE_SUBSCRIPTION` - Enable subscription features
- `ADMIN_ID` - Quick admin access ID
- `MAX_ACTIVITIES_TO_IMPORT` - Import limit
- `ROOT_URL` - Base URL for redirects
- And more...

### Property Service
Dynamic settings stored in database (`Property` table):
- `PROPERTY_COUPONS` - Subscription coupons
- System settings modifiable via `/admin/settings/{key}`

---

## Testing Patterns

### Unit Tests
Test files follow naming: `*.spec.ts`

**Example locations**:
- `account.controller.spec.ts` - Controller tests
- `account.service.spec.ts` - Service tests

**Patterns**:
- Mock Prisma service
- Mock services injected
- Test request/response handling
- Test permission guards
- Test data validation

---

## Important Implementation Notes

### 1. User Context
All endpoints that need user info use:
```typescript
@Inject(REQUEST) private readonly request: RequestWithUser
// Access: this.request.user.id, this.request.user.permissions, etc.
```

### 2. Deleted Records
Soft deletes are common:
```typescript
where: { userId, deletedAt: null }  // Only fetch non-deleted
```

### 3. Currency Handling
User's base currency determines:
- How values are displayed
- Exchange rate calculations
- Performance reporting

Accessed via: `this.request.user.settings.settings.baseCurrency`

### 4. Timezone Handling
Some endpoints accept/return dates:
- Format: ISO 8601 (YYYY-MM-DD or full timestamp)
- Parsing: `parseISO()` from date-fns

### 5. Bulk Operations
Many endpoints support bulk operations via filtering:
```
DELETE /order?symbol=AAPL&assetClasses=EQUITY
```
Returns count of deleted records.

### 6. Agent/LLM Integration
New feature for AI assistance:
- `POST /agent/chat` - Send portfolio questions
- `POST /agent/feedback` - Log user feedback
- `GET /ai/prompt/{mode}` - Get context for LLM
- Widget assets served via `/agent/widget/*`

---

## Security Considerations

### 1. Permission Guards
Always check `@HasPermission` decorator on sensitive endpoints.

### 2. User Isolation
Endpoints verify user ownership before operations:
```typescript
if (order.userId !== this.request.user.id) {
  throw new HttpException(...FORBIDDEN...);
}
```

### 3. Input Validation
All DTOs validated with class-validator before processing.

### 4. Rate Limiting
Data provider endpoints (Ghostfolio API) have daily request limits:
```typescript
if (this.request.user.dataProviderGhostfolioDailyRequests > maxDailyRequests) {
  throw new HttpException(...TOO_MANY_REQUESTS...);
}
```

### 5. Data Redaction
Sensitive data redacted for non-premium users and guest views.

### 6. CORS & Headers
Handled by NestJS (see main.ts or app configuration).

---

## Performance Optimizations

### 1. Selective Data Loading
Use Prisma `include`/`select` to avoid N+1 queries:
```typescript
const accounts = await this.prismaService.account.findMany({
  where: { userId },
  include: { activities: true, balances: true }
});
```

### 2. Pagination
Large result sets always paginated via skip/take.

### 3. Caching
Expensive calculations cached in Redis:
- Portfolio details
- Symbol lookups
- Exchange rates

### 4. Background Jobs
Data gathering offloaded to Bull queue:
- Triggered on order creation
- Doesn't block response
- Configurable priorities

### 5. View Restrictions
Performance data optimized for restricted views (percentages only).

---

## Versioning Strategy

### API Versioning
Using `@Version()` decorator:
- Most endpoints: default (v1 implicit)
- Some endpoints: `@Version('2')` for breaking changes
- Static content: `@Version(VERSION_NEUTRAL)` (no versioning)

**Example**:
```typescript
@Get('performance')
@Version('2')
public async getPerformanceV2(...) { }
```

### Deprecation
Old endpoints marked with JSDoc:
```typescript
/**
 * @deprecated
 */
@Get('anonymous/:accessToken')
public async accessTokenLoginGet(...) { }
```

---

## Deployment & DevOps Notes

### Health Checks
- `GET /health` - Overall system health (DB + Redis)
- `GET /health/data-provider/:dataSource` - Individual provider status
- `GET /health/data-enhancer/:name` - Enhancer service status

### Monitoring Points
- Portfolio calculation performance (PerformanceLoggingInterceptor)
- Data provider response times
- Queue processing latency
- Cache hit rates

### Configuration Secrets
Stored as environment variables (not in code):
- Database URL
- Redis URL
- OAuth credentials
- Stripe API keys
- Data provider API keys

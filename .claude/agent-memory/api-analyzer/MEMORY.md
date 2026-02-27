API Analyzer - Ghostfolio API Surface

KEY FINDINGS:
- Framework: NestJS with Passport authentication (JWT, Google OAuth, OIDC, WebAuthn, API Key)
- Database: Prisma with PostgreSQL (users, accounts, orders, portfolios, etc.)
- Caching: Redis via RedisCacheService
- Job Queue: Bull for data gathering tasks
- 34 main controller files organized by resource domain
- Versioning: Supports @Version decorator (v1, v2, VERSION_NEUTRAL)
- Global interceptors: RedactValuesInResponse, TransformDataSourceInRequest/Response

AUTHENTICATION STRATEGIES:
1. JWT (default) - via AuthGuard('jwt')
2. API Key - via AuthGuard('api-key')
3. Google OAuth - via AuthGuard('google')
4. OIDC - via AuthGuard('oidc')
5. WebAuthn - via POST endpoints with credential verification
6. Anonymous - via accessToken validation in body

PERMISSION SYSTEM:
- Uses @HasPermission decorator with permission.XXXX constants
- HasPermissionGuard validates permissions at runtime
- Permissions stored in user.permissions array
- Special roles: ADMIN, USER, DEMO

KEY RESOURCES & ENDPOINTS:
See API_ENDPOINTS.md for full catalog (34 controllers, 100+ endpoints)

COMMON PATTERNS:
1. Controllers use REQUEST injection to access current user
2. Impersonation via HEADER_KEY_IMPERSONATION header
3. Filters built via ApiService.buildFiltersFromQueryParams()
4. Response interceptors handle DataSource transformation and value redaction
5. Pagination via skip/take query params
6. Date ranges via "range" query param (1d, 7d, 1m, 3m, max, ytd)
7. Sorting via sortColumn & sortDirection params
8. Bulk operations via query parameter filtering

ARCHITECTURAL NOTES:
- Separated concerns: controllers, services, guards, interceptors
- Service layer handles business logic
- Admin endpoints restricted to permissions.accessAdminControl
- Subscription-aware (Premium vs Basic restrictions)
- Data validation via DTOs from @ghostfolio/common/dtos
- Error handling: HttpException with StatusCodes

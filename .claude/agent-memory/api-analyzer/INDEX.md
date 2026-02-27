# Ghostfolio API Analysis - Complete Index

## Document Overview

This directory contains a comprehensive analysis of the Ghostfolio API surface. All documentation was generated on 2026-02-26 by analyzing 34 controller files and 100+ endpoints.

### Files in This Analysis

1. **MEMORY.md** (Quick overview)
   - Key findings about the API framework
   - Authentication strategies
   - Permission system
   - Common patterns at a glance
   - **Start here for a 2-minute overview**

2. **QUICK_REFERENCE.md** (Developer cheat sheet)
   - Most-used endpoints
   - Common query parameters
   - Status codes and response patterns
   - Data models
   - Troubleshooting guide
   - **Use this for quick lookups during development**

3. **API_ENDPOINTS.md** (Full endpoint catalog)
   - All 34 controllers mapped to endpoints
   - 100+ endpoints organized by resource
   - Request/response patterns for each
   - Query parameters
   - Authentication requirements
   - Status codes and error handling
   - **Reference for understanding what endpoints exist**

4. **PATTERNS_AND_ARCHITECTURE.md** (Deep dive)
   - Framework and technology stack
   - Project structure and file organization
   - Authentication implementations
   - Authorization and permission model
   - Endpoint design patterns
   - Database access patterns
   - Caching strategy
   - Background job processing
   - Special features (portfolios, dividends, sharing)
   - Configuration and feature flags
   - Testing patterns
   - Security considerations
   - Performance optimizations
   - **Read this to understand HOW the API works**

5. **RECOMMENDATIONS.md** (Usage guide)
   - Best endpoints for common tasks
   - Authentication best practices
   - Permission model guidance
   - Performance considerations
   - Subscription-aware features
   - Data validation rules
   - Edge cases and gotchas
   - Security best practices
   - Common client integration patterns
   - **Follow this when building client applications**

---

## Quick Navigation

### I want to...

**Understand what the API does**
- Start with MEMORY.md
- Then read QUICK_REFERENCE.md sections 1-3

**Integrate with the API**
- Read QUICK_REFERENCE.md entirely
- Use API_ENDPOINTS.md as reference
- Follow patterns in PATTERNS_AND_ARCHITECTURE.md
- Check RECOMMENDATIONS.md for best practices

**Debug an issue**
- QUICK_REFERENCE.md "Troubleshooting" section
- RECOMMENDATIONS.md "Edge Cases & Gotchas"
- PATTERNS_AND_ARCHITECTURE.md matching your use case

**Understand authentication**
- PATTERNS_AND_ARCHITECTURE.md "Authentication Patterns"
- QUICK_REFERENCE.md "Authentication Quick Start"
- RECOMMENDATIONS.md "Authentication Best Practices"

**Check endpoint details**
- API_ENDPOINTS.md for the resource category
- PATTERNS_AND_ARCHITECTURE.md for pattern explanation
- QUICK_REFERENCE.md for quick reference

**Understand permissions**
- PATTERNS_AND_ARCHITECTURE.md "Authorization & Permissions"
- QUICK_REFERENCE.md "Permission Examples"
- RECOMMENDATIONS.md "Permission Model Guidance"

**Learn about caching**
- PATTERNS_AND_ARCHITECTURE.md "Caching Strategy"
- RECOMMENDATIONS.md "Performance Considerations"

**Implement background jobs**
- PATTERNS_AND_ARCHITECTURE.md "Background Job Processing"
- API_ENDPOINTS.md "Admin Functions" for queue endpoints

**Test the API**
- PATTERNS_AND_ARCHITECTURE.md "Testing Patterns"
- QUICK_REFERENCE.md "Testing Shortcuts"
- RECOMMENDATIONS.md "Testing Recommendations"

---

## Key Statistics

- **Framework**: NestJS with TypeScript
- **Database**: Prisma ORM with PostgreSQL
- **Cache**: Redis
- **Job Queue**: Bull
- **Controllers**: 34 total
- **Endpoints**: 100+ total
- **Authentication Methods**: 6 (JWT, API Key, Google OAuth, OIDC, WebAuthn, Anonymous)
- **Permission Types**: 30+ specific permissions
- **Feature Flags**: 2+ major feature toggles

---

## Architecture At a Glance

```
Ghostfolio API
├── Controllers (34)
│   ├── Account Management (7 endpoints)
│   ├── Portfolio Analysis (9 endpoints)
│   ├── Order/Activity Management (5 endpoints)
│   ├── User Management (7 endpoints)
│   ├── Access/Sharing (4 endpoints)
│   ├── Admin Functions (17 endpoints)
│   ├── Data Providers (6 endpoints)
│   ├── Symbol/Market Data (6 endpoints)
│   ├── Import/Export (3 endpoints)
│   ├── Tags (4 endpoints)
│   ├── Platforms (5 endpoints)
│   ├── Watchlist (3 endpoints)
│   ├── Authentication (7 endpoints)
│   ├── Subscription (3 endpoints)
│   ├── Agent/AI (4 endpoints)
│   ├── Health/Meta (4 endpoints)
│   └── Other (5 endpoints)
├── Services (Business Logic)
│   ├── Portfolio Calculation
│   ├── Data Provider Integration
│   ├── Permission Validation
│   ├── Authentication
│   ├── Caching
│   ├── Job Queue Management
│   └── More...
├── Guards (Authorization)
│   ├── JWT Auth
│   ├── API Key Auth
│   ├── Permission Validation
│   └── Custom Guards
├── Interceptors (Request/Response)
│   ├── Response Value Redaction
│   ├── DataSource Transformation
│   ├── Performance Logging
│   └── Custom Interceptors
└── Database (Prisma)
    ├── Users & Auth
    ├── Accounts & Balances
    ├── Orders & Activities
    ├── Portfolios & Holdings
    ├── Tags & Watchlists
    ├── Platforms
    ├── Market Data
    └── More Tables
```

---

## Security Model

### Authentication Layer
- **JWT**: Default method, carries user ID
- **API Key**: For data provider access, rate-limited
- **OAuth**: Google, OIDC for SSO
- **WebAuthn**: Passwordless modern auth
- **Anonymous**: Token-based quick access

### Authorization Layer
- **Permission-based**: @HasPermission decorator
- **Resource ownership**: Verify userId matches
- **Subscription-aware**: Premium vs Basic restrictions
- **Admin gates**: accessAdminControl permission

### Data Protection
- **Redaction**: Sensitive values removed for non-premium
- **Soft deletes**: Records not hard-deleted
- **Input validation**: DTOs with class-validator
- **Error masking**: Don't expose internal errors

---

## Common Workflows

### 1. New User Onboarding
1. Sign up: `POST /user`
2. Create account: `POST /account`
3. Create order: `POST /order`
4. View portfolio: `GET /portfolio/details`

### 2. Portfolio Analysis
1. Get overview: `GET /portfolio/details`
2. View performance: `GET /portfolio/performance`
3. Check holdings: `GET /portfolio/holdings`
4. Analyze dividends: `GET /portfolio/dividends`

### 3. Order Management
1. List orders: `GET /order`
2. Create order: `POST /order`
3. Update order: `PUT /order/:id`
4. Delete order: `DELETE /order/:id`

### 4. Data Import
1. Prepare CSV/JSON
2. Call: `POST /import?dryRun=true` (validate)
3. Call: `POST /import` (execute)
4. Check results for errors

### 5. Portfolio Sharing
1. Create access: `POST /access`
2. Get share URL: `/public/{accessId}/portfolio`
3. Guest views restricted data
4. Update permissions: `PUT /access/:id`

### 6. Admin Operations
1. View dashboard: `GET /admin`
2. Manage users: `GET /admin/user`
3. Gather data: `POST /admin/gather/7days`
4. Monitor queue: `GET /admin/queue/job`

---

## Feature Highlights

### Portfolio Analytics
- Real-time performance calculation (MWR, ROAI)
- Holdings breakdown by asset class, sector, market
- Dividend tracking and analysis
- Performance comparison vs benchmarks
- Multi-currency support with exchange rates

### Data Management
- Multiple data sources (Yahoo, CoinGecko, manual, internal)
- Historical data tracking
- Market data updates via background jobs
- Custom asset profile management
- Bulk import/export capabilities

### User Experience
- Public portfolio sharing (read-only, restricted)
- Impersonation for support/debugging
- WebAuthn passwordless auth
- Subscription tiers (free, premium)
- Watchlists and tagging system

### Developer Features
- API key generation for integrations
- Ghostfolio data provider (for other apps)
- Webhook-like agent/feedback system
- Comprehensive error responses
- Structured DTOs and interfaces

---

## Best Practices Summary

### Do's
- Always validate auth token on client
- Cache responses to reduce API calls
- Use bulk operations when possible
- Implement proper error handling
- Check permissions before showing UI
- Use appropriate query parameters
- Handle rate limiting gracefully
- Validate input before sending

### Don'ts
- Don't hardcode API keys in code
- Don't retry immediately on rate limit
- Don't call same endpoint repeatedly
- Don't ignore validation errors
- Don't assume data format stays constant
- Don't mix v1 and v2 responses
- Don't log sensitive data
- Don't trust client-side auth

---

## Testing Checklist

- [ ] Test with valid JWT token
- [ ] Test with invalid/expired token
- [ ] Test with missing permissions
- [ ] Test with invalid data (DTO validation)
- [ ] Test happy path (success case)
- [ ] Test error paths (404, 403, 400, 500)
- [ ] Test pagination (skip, take)
- [ ] Test filtering (multiple filter types)
- [ ] Test sorting (sortColumn, sortDirection)
- [ ] Test date ranges
- [ ] Test bulk operations
- [ ] Test with large datasets
- [ ] Test cache behavior
- [ ] Test rate limiting

---

## Version Information

- **Analysis Date**: 2026-02-26
- **Ghostfolio Version**: Latest dev branch
- **NestJS Version**: 10.x+
- **Prisma Version**: 5.x+
- **Node Version**: 18+ (based on LTS)

---

## Document Maintenance

### How to Update
1. Re-read controller files in `/apps/api/src/app/`
2. Update endpoint definitions in API_ENDPOINTS.md
3. Update patterns if architecture changes in PATTERNS_AND_ARCHITECTURE.md
4. Update recommendations if behavior changes in RECOMMENDATIONS.md
5. Keep MEMORY.md as executive summary
6. Keep QUICK_REFERENCE.md as developer guide

### What Changed Recently
See git history for latest API changes:
- Agent controller added (new AI features)
- Ghostfolio data provider endpoints (v2)
- WebAuthn authentication
- Subscription/billing system
- Public portfolio sharing

---

## Support & Questions

### Where to Find Information
- **Quick answers**: QUICK_REFERENCE.md
- **Technical details**: PATTERNS_AND_ARCHITECTURE.md
- **Specific endpoints**: API_ENDPOINTS.md
- **How to use API**: RECOMMENDATIONS.md
- **Key facts**: MEMORY.md

### Common Questions
**Q: How do I authenticate?**
A: See "Authentication Quick Start" in QUICK_REFERENCE.md

**Q: How do I create an order?**
A: See "Create Order" workflow in this INDEX or API_ENDPOINTS.md

**Q: How do I handle rate limiting?**
A: See RECOMMENDATIONS.md "Rate Limiting" section

**Q: How do I share a portfolio?**
A: See "Portfolio Sharing" workflow in this INDEX

**Q: How do I handle permissions?**
A: See PATTERNS_AND_ARCHITECTURE.md "Authorization & Permissions"

---

## File Reference Map

```
MEMORY.md ─────────────────────────────────┐
(1.9K)                                      │ Quick overview
                                            │ Links to detailed docs
                                            │ Key findings
                                            │
QUICK_REFERENCE.md ────────────────────────┤ Developer cheat sheet
(8.9K)                                      │ Most common use cases
                                            │ Quick lookups
                                            │ Troubleshooting
                                            │
API_ENDPOINTS.md ───────────────────────────┤ Complete endpoint listing
(18K)                                       │ Request/response details
                                            │ Auth requirements
                                            │
PATTERNS_AND_ARCHITECTURE.md ────────────────┤ Deep technical dive
(17K)                                        │ How things work
                                             │ Design patterns
                                             │ Best practices
                                             │
RECOMMENDATIONS.md ─────────────────────────┤ Integration guide
(13K)                                       │ Common patterns
                                            │ Edge cases
                                            │ Security guidance
                                            │
INDEX.md (this file) ───────────────────────┘ Navigation & summary
                      Total: ~59K of analysis
```

---

## Next Steps

### For API Integration
1. Read QUICK_REFERENCE.md sections 1-5
2. Browse API_ENDPOINTS.md for needed endpoints
3. Study PATTERNS_AND_ARCHITECTURE.md for your use case
4. Follow RECOMMENDATIONS.md patterns
5. Implement with proper error handling

### For API Development
1. Study PATTERNS_AND_ARCHITECTURE.md completely
2. Follow patterns in existing controllers
3. Add tests per PATTERNS_AND_ARCHITECTURE.md "Testing Patterns"
4. Update this documentation

### For Troubleshooting
1. Check QUICK_REFERENCE.md "Troubleshooting" table
2. Search RECOMMENDATIONS.md for your issue
3. Review PATTERNS_AND_ARCHITECTURE.md for context
4. Check error message in response body

---

## Summary

This analysis provides complete coverage of the Ghostfolio API surface:
- **Structure**: How the API is organized
- **Endpoints**: What endpoints exist and how to use them
- **Patterns**: How the codebase works
- **Guidance**: How to integrate effectively
- **Best Practices**: What to do and what to avoid

Use the documents together as:
- **MEMORY.md** = Executive summary
- **QUICK_REFERENCE.md** = Developer handbook
- **API_ENDPOINTS.md** = API reference
- **PATTERNS_AND_ARCHITECTURE.md** = Technical guide
- **RECOMMENDATIONS.md** = Integration guide
- **INDEX.md** = This navigation document

All analysis is current as of 2026-02-26. Check git history for recent changes.

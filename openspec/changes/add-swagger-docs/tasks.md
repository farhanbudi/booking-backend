## 1. Dependencies & Setup

- [x] 1.1 Add `@elysiajs/openapi` to package.json dependencies
- [x] 1.2 Run `bun install` to install the new dependency

## 2. Integration

- [x] 2.1 Import `openapi` from `@elysiajs/openapi` in `src/index.ts`
- [x] 2.2 Register the OpenAPI plugin with Elysia app (before route registration)
- [x] 2.3 Configure Swagger/OpenAPI path to `/openapi`

## 3. Verification

- [x] 3.1 Start dev server (`bun run dev`)
- [x] 3.2 Verify OpenAPI UI loads at `http://localhost:3000/openapi`
- [x] 3.3 Verify all endpoints are documented (auth, resources, bookings, payments)
- [x] 3.4 Verify OpenAPI spec is accessible at `/openapi/json` or similar
- [x] 3.5 Run existing tests to ensure no regressions (`bun test`)
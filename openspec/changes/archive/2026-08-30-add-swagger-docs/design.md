## Context

See proposal.md for motivation. The booking backend is built with ElysiaJS, uses TypeBox for schema validation, and has four route groups: `/auth`, `/resources`, `/bookings`, and `/payments`. All routes are defined with TypeBox schemas that can be used to generate OpenAPI 3.0 specifications automatically.

## Goals / Non-Goals

**Goals:**
- Add Swagger UI accessible at `/swagger` endpoint
- Auto-generate OpenAPI 3.0 spec from existing TypeBox schemas
- Minimal configuration - leverage Elysia's built-in schema extraction
- No changes to existing API behavior or response formats

**Non-Goals:**
- Custom OpenAPI extensions or manual schema overrides
- Authentication for Swagger UI (public documentation is acceptable for portfolio project)
- Multiple API versions in documentation
- ReDoc or other documentation UIs

## Decisions

### Use `@elysiajs/swagger` plugin
**Rationale**: Official Elysia plugin with zero-config OpenAPI generation from TypeBox schemas.
**Alternatives**: 
- Manual OpenAPI spec writing - rejected (high maintenance, error-prone)
- `@elysiajs/swagger` with custom config - rejected (unnecessary complexity for portfolio project)

### Swagger UI at `/swagger` path
**Rationale**: Standard convention, doesn't conflict with existing routes (`/auth`, `/resources`, `/bookings`, `/payments`)
**Alternatives**: `/docs`, `/api-docs` - rejected (`/swagger` is most recognizable)

### Auto-generate from TypeBox schemas
**Rationale**: Existing routes already use TypeBox (`t.Object`, `t.String`, etc.) for validation. The plugin extracts these automatically.
**No manual schema definitions needed** - the plugin reads schemas from route definitions.

## Risks / Trade-offs

- **Risk**: Swagger UI exposes all endpoints publicly → Mitigation: Acceptable for portfolio project; production would add auth guard
- **Risk**: Plugin version compatibility with Elysia 1.1.x → Mitigation: Use compatible version (`@elysiajs/swagger@^1.1.x`)
- **Trade-off**: No custom examples or descriptions in spec → Acceptable for portfolio scope; can enhance later if needed

## Migration Plan

1. Add `@elysiajs/swagger` dependency
2. Import and register plugin in `src/index.ts` before route registration
3. Configure path: `/swagger`
4. Verify Swagger UI loads and shows all endpoints
5. No database migrations or breaking changes needed

## Open Questions

None - design is straightforward with official plugin.
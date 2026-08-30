## Why

The booking backend currently lacks API documentation. Adding Swagger/OpenAPI documentation will provide an interactive UI for developers to explore and test the API endpoints, improving developer experience and making the API self-documenting.

## What Changes

- Add `@elysiajs/swagger` plugin to the Elysia application
- Configure Swagger UI at `/swagger` endpoint
- Generate OpenAPI 3.0 specification from existing TypeBox schemas in route definitions
- No breaking changes - this is purely additive documentation tooling

## Capabilities

### New Capabilities

- `api-docs/swagger`: Interactive Swagger UI for API documentation and testing

### Modified Capabilities

None - this change adds documentation tooling without modifying existing API behavior.

## Impact

- **Dependencies**: Add `@elysiajs/swagger` to `package.json`
- **Code**: Modify `src/index.ts` to register the Swagger plugin
- **Configuration**: No environment variables needed
- **API**: New `/swagger` endpoint for Swagger UI (non-breaking, additive)
- **Tests**: No test changes required (documentation only)
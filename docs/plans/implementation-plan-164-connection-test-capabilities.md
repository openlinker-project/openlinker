# Implementation Plan — #164 Connection Test + Capabilities Panel

## Goal
Enable users to verify a connection's credentials work, and see which capabilities the connection provides, directly on `/connections/:id`.

## Classification
CORE (new port) + Integration (adapters) + API (endpoint) + Frontend (button, panel).

## Non-goals
- Scheduled/periodic health checks
- Exposing test results in the Diagnostics sync-job list (kept separate intentionally)

## Design

### CORE — new port
`libs/core/src/integrations/domain/ports/connection-tester.port.ts`
```ts
export interface ConnectionTestResult {
  success: boolean;
  status?: number;        // HTTP status if applicable
  message: string;        // human-readable
  latencyMs: number;
}
export interface ConnectionTesterPort {
  test(connection: Connection): Promise<ConnectionTestResult>;
}
```
Registered per adapter key in a small registry (same shape as `AdapterRegistryService`), or attached to the platform-specific integration module via a multi-provider token keyed by `adapterKey`.

### Adapters
- `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-connection-tester.adapter.ts` — uses `PrestashopWebserviceClient.listResources('products', { limit: 1 })`.
- `libs/integrations/allegro/src/infrastructure/adapters/allegro-connection-tester.adapter.ts` — uses `AllegroHttpClient.get('/me')`.

Both: measure elapsed ms, catch errors and map to `{success:false, status, message}`. Never leak secrets.

### Persistence
Migration: add to `connections` table
- `last_tested_at timestamptz NULL`
- `last_test_success boolean NULL`
- `last_test_error text NULL`

Update `ConnectionOrmEntity` + domain `Connection` + mapper.

### Application
`ConnectionService.testConnection(connectionId)`:
1. Load connection; 404 if missing
2. Resolve `ConnectionTesterPort` for its adapter key; 400 if unsupported
3. Call `test(connection)`
4. Persist `lastTestedAt/Success/Error` via repository
5. Return result DTO

### API
`POST /connections/:id/test` → `ConnectionTestResultDto` (guarded by JWT).
Extend `ConnectionResponseDto` / diagnostics response with the three last-test fields.

### Frontend
- `connections.api.ts` — add `testConnection(id)`
- `use-test-connection.ts` — `useMutation`, invalidates `connection` and `diagnostics` queries
- `ConnectionActionsPanel.tsx` — add "Test connection" button; toast result
- `ConnectionCapabilitiesPanel.tsx` — render `supportedCapabilities` as `StatusBadge` pills above the enabled toggles
- `ConnectionDiagnosticsPanel.tsx` — add "Last tested" row (timestamp + success/failure badge + error tooltip)

## Steps
1. Migration + ORM/domain/mapper updates for last-test fields
2. Domain port `ConnectionTesterPort` + registry/multi-provider wiring
3. PrestaShop + Allegro tester adapters (unit tests mocking the HTTP client)
4. `ConnectionService.testConnection` + repository update method (unit tests)
5. `POST /connections/:id/test` controller + response DTO
6. Extend connection response / diagnostics with last-test fields
7. FE api + hook + button + capabilities pills + diagnostics row
8. Quality gate (lint, type-check, test)

## Acceptance mapping
- "Test connection" button returning pass/fail within ~2s → steps 3–7
- Capabilities visible as pills → step 7
- Result persisted and shown in Diagnostics → steps 1, 6, 7

## Risks
- Adapter HTTP errors bubbling as 500s — tester must always resolve with a structured result, never throw past the service boundary.
- Timing out slow stores — wrap tester calls in a short timeout (5s) to keep UX snappy.

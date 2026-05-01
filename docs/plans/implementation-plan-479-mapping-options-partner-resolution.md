# Implementation Plan — #479 MappingOptionsController partner resolution

## 1. Goal

The `/connections/{connectionId}/mappings` page is broken on every connection because `MappingOptionsController` resolves both source and destination capability adapters from the same URL connection id. In the Allegro→PrestaShop pipeline those capabilities live on different connections — Allegro implements `SourceOptionsReader`, PrestaShop implements `OrderProcessorManager`. So whichever connection the operator opens, exactly one half of the page always errors with `does not implement <capability>`.

Fix: the controller resolves the partner connection itself, using the existing pairing primitive `Connection.config.masterCatalogConnectionId`. The FE keeps calling the same endpoints unchanged.

**Layer**: Interface (controller). No core/domain/application changes; no new ports.

**Non-goals**:
- Multi-Allegro → single-PS UX (a partner picker). Today, ambiguous pairing returns 400 with a clear message.
- Storing the pairing in a dedicated column instead of `config.masterCatalogConnectionId`.
- Renaming `masterCatalogConnectionId` to a generic `partnerConnectionId`.

## 2. Research findings

**Affected files**:

- `apps/api/src/mappings/http/mapping-options.controller.ts:166-200` — `resolveDestinationOptions` / `resolveSourceOptions` both pass the URL `connectionId` straight to `IIntegrationsService.getCapabilityAdapter`. This is where the bug lives.
- `apps/api/src/mappings/mappings.module.ts` — currently imports `CoreMappingsModule`, `CoreIntegrationsModule`, `CategoriesModule`. Will need `IdentifierMappingModule` for `CONNECTION_PORT_TOKEN` (CoreIntegrationsModule does *not* re-export it).
- `apps/api/src/mappings/http/__tests__/mapping-options.controller.spec.ts` — the existing 14 tests for the controller; needs four new branches.

**Surface available for the fix**:

- `ConnectionPort.get(connectionId)` (`libs/core/src/identifier-mapping/domain/ports/connection.port.ts:24`) — fetches a single connection by id. Throws `ConnectionNotFoundException` if missing.
- `ConnectionPort.list(filters?)` — returns `Connection[]` filtered by `platformType` and/or `status`. We use this to enumerate Allegro connections when reverse-resolving from a PS URL connection.
- `Connection.config: ConnectionConfig` is `Record<string, unknown>`. `config.masterCatalogConnectionId` is read as `unknown` and narrowed at the call site.
- `Connection.platformType: PlatformType` is a `string` alias today. Allegro connections use `'allegro'`, PrestaShop uses `'prestashop'` (verified across the codebase, e.g., `apps/api/src/integrations/http/dto/allegro-oauth-connect.dto.ts:74` flow).
- `CONNECTION_PORT_TOKEN` (`libs/core/src/identifier-mapping/identifier-mapping.tokens.ts:15`) is exported from `IdentifierMappingModule` via that module's `exports`.

**Pairing semantics confirmed**:

- The Allegro connection writes its catalog partner as `config.masterCatalogConnectionId` — set during the Allegro OAuth callback (`apps/api/src/integrations/application/services/allegro-oauth.service.ts` flow).
- There is no field set the other way (PS does not store its Allegro partner). To resolve the partner from a PS URL connection, we list active Allegro connections and filter client-side for `config.masterCatalogConnectionId === <psId>`. Connection table size is small enough that listing is fine; if it grows, add a `configKeyEquals` filter to `ConnectionFilters` later.

## 3. Design

### Resolution rule

Given a URL connection id and a `side`:

| URL connection platform | side          | Resolved connection                                                       |
|------------------------:|---------------|---------------------------------------------------------------------------|
| `allegro`               | `source`      | URL connection                                                            |
| `allegro`               | `destination` | `connection.config.masterCatalogConnectionId` (must be a non-empty string)|
| `prestashop`            | `source`      | The single active Allegro connection whose `config.masterCatalogConnectionId === <urlId>` |
| `prestashop`            | `destination` | URL connection                                                            |
| anything else           | either        | 400 — the mappings page is Allegro→PS only today                          |

### Error mapping

All these become `BadRequestException` with operator-actionable messages — no leak of capability internals to the FE:

- Allegro URL connection with missing/empty `masterCatalogConnectionId` → `Connection {urlId} has no destination paired. Set the catalog connection on the connection-edit page and try again.`
- PS URL connection with zero paired Allegro connections → `Connection {urlId} has no source paired. Open the Allegro connection's edit page and set its catalog to this PrestaShop connection.`
- PS URL connection with two or more paired Allegro connections → `Connection {urlId} has multiple paired Allegro connections ({ids…}). Multi-source mapping is not yet supported.`
- URL connection's `platformType` is neither `allegro` nor `prestashop` → `Connection {urlId} has unsupported platform '{platformType}' for the mappings page.`

`ConnectionPort.get` already throws `ConnectionNotFoundException` for unknown ids — that propagates through to a 404 (existing behaviour, unchanged).

### Code shape

```ts
// In MappingOptionsController — new dep + helper
constructor(
  @Inject(INTEGRATIONS_SERVICE_TOKEN) private readonly integrationsService: IIntegrationsService,
  @Inject(CATEGORIES_CACHE_SERVICE_TOKEN) private readonly categoriesCacheService: ICategoriesCacheService,
  @Inject(CONNECTION_PORT_TOKEN) private readonly connectionPort: ConnectionPort,
) {}

private async resolvePartnerConnectionId(
  urlConnectionId: string,
  side: 'source' | 'destination',
): Promise<string> {
  const url = await this.connectionPort.get(urlConnectionId);
  // …branches per the table above…
}
```

`resolveDestinationOptions` and `resolveSourceOptions` get one new line each: replace the `connectionId` argument to `getCapabilityAdapter` with the resolved partner id.

### Module wiring

`apps/api/src/mappings/mappings.module.ts` adds `IdentifierMappingModule` to its `imports`. That module already exports `CONNECTION_PORT_TOKEN` and the underlying `ConnectionRepository` provider.

## 4. Step-by-step plan

### Step 1 — Add partner resolution helper

**File**: `apps/api/src/mappings/http/mapping-options.controller.ts`

- Inject `ConnectionPort` via `@Inject(CONNECTION_PORT_TOKEN)`.
- Add private `resolvePartnerConnectionId(urlConnectionId, side)` per §3.
- Update `resolveDestinationOptions` and `resolveSourceOptions` to call the helper, then pass the resolved id to `getCapabilityAdapter`.
- Update each handler's `@ApiResponse` to mention the 400 paths alongside the existing 501.

Acceptance: source/destination handlers each produce one DI of `connectionPort`, one resolution, then the existing capability-narrow flow.

### Step 2 — Wire `IdentifierMappingModule` into `MappingsApiModule`

**File**: `apps/api/src/mappings/mappings.module.ts`

- Add `IdentifierMappingModule` to `imports`.
- Add a comment noting the dependency is for partner-connection lookup (#479).

Acceptance: `nest build` succeeds, `getCapabilityAdapter` and `ConnectionPort` both resolve at runtime.

### Step 3 — Unit tests for the four resolution branches

**File**: `apps/api/src/mappings/http/__tests__/mapping-options.controller.spec.ts`

Mock the new `ConnectionPort` dep (`jest.Mocked<ConnectionPort>` with `get` and `list` jest.fn). Add a `describe('partner resolution', () => { … })` block:

1. **URL connection is Allegro, source side** — `connectionPort.get` returns Allegro connection; helper returns urlId; `getCapabilityAdapter` called with urlId + `'OrderSource'`.
2. **URL connection is Allegro, destination side** — `connectionPort.get` returns Allegro connection with `config.masterCatalogConnectionId = 'ps-1'`; helper returns `'ps-1'`; `getCapabilityAdapter` called with `'ps-1'` + `'OrderProcessorManager'`.
3. **URL connection is PrestaShop, source side** — `connectionPort.get` returns PS; `connectionPort.list({ platformType: 'allegro', status: 'active' })` returns one Allegro connection with `config.masterCatalogConnectionId === <urlId>`; helper returns that Allegro id; `getCapabilityAdapter` called with the Allegro id + `'OrderSource'`.
4. **URL connection is PrestaShop, destination side** — helper returns urlId; `getCapabilityAdapter` called with urlId + `'OrderProcessorManager'`.
5. **No pairing — Allegro url, missing `masterCatalogConnectionId`** — `BadRequestException` with the operator message.
6. **No pairing — PS url, zero matching Allegro** — `BadRequestException`.
7. **Ambiguous pairing — PS url, two matching Allegro** — `BadRequestException` naming the conflicting ids.
8. **Unsupported platform** — Connection with `platformType: 'shopify'` — `BadRequestException`.

Update existing happy-path tests to default `connectionPort.get` to return a sensible Allegro/PS connection so they continue to pass without rework — keep diff small.

Acceptance: all new branches green; existing 14 tests unchanged.

### Step 4 — Quality gate

```bash
pnpm lint && pnpm type-check && pnpm test
```

Must be zero red. No migration needed (no schema change).

### Step 5 — Self-review per `docs/code-review-guide.md`

Focus areas (per the doc):
- Architecture compliance — controller stays in interface layer, depends on ports only ✓ by design.
- Error handling — `BadRequestException` is a NestJS common exception, fine for interface-layer translations of "operator config issue". No domain-leak.
- Logging — surface a `this.logger.warn` (or skip — these are operator-input issues, not server problems; 400 alone suffices). Decision: log nothing; let the 400 body speak.
- Testability — `ConnectionPort` is a port, mocked via jest.

### Step 6 — Commit, push, open PR with `Closes #479`

Commit message:
```
fix(mappings): resolve partner connection for mapping options page

Closes #479.
```

## 5. Validation checklist

- [ ] No domain-layer changes.
- [ ] No new ports.
- [ ] FE hook untouched.
- [ ] Capability port contracts unchanged.
- [ ] Architecture: controller depends on `ConnectionPort` (port) and `IIntegrationsService` (port) — both interfaces. No infrastructure imports.
- [ ] Naming: no new files; existing controller name preserved.
- [ ] Tests: unit-only (controller logic with mocked port). No integration test needed — partner-resolution shape is fully covered by mocking `ConnectionPort.get` / `list`.
- [ ] Security: `@Roles('admin')` already on the controller class — no auth regression.

## 6. Open questions

None blocking. The platform-type strings (`'allegro'`, `'prestashop'`) are de-facto constants in the codebase; if a future PR introduces a `PlatformTypeValues` `as const`, swap the string literals for the enum.

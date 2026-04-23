# Implementation Plan — #359 — Split `@openlinker/core/listings` barrel

**Branch:** `359-split-listings-barrel`
**Layer:** CORE packaging (barrel reshape) + small edits to 3 consumer files
**Scope:** Structural fix for the runtime circular-require risk surfaced by #337 (PR #360).
**Risk:** Low — no runtime behaviour change, no DI graph change. Only import-surface rearrangement.

---

## 1. Understand the task

### Goal

Eliminate the latent runtime circular-require that #337 exposed when `auto-match-variant-offers.service.ts` added a value import of `isOfferLister` through the `@openlinker/core/listings` barrel. Replace the deep-path workaround (`.../capabilities/offer-lister.capability`) with a clean import from a split barrel.

### Why

The `listings/index.ts` barrel re-exports **two kinds of things together**:
1. Pure surface (ports, types, capability interfaces + guards, domain entities, exceptions, enumeration consts, Symbol tokens, service interfaces) — no side effects, no transitive cycles.
2. `ListingsModule` + 7 `@Injectable` service classes — their transitive imports reach `@openlinker/core/products`, `@openlinker/core/integrations`, etc.

Any package that `@openlinker/core/listings` transitively imports (e.g. `@openlinker/core/products`) cannot safely do a runtime value import from the barrel without risking `Cannot read properties of undefined` / "Nest can't resolve `Symbol(?)`" DI failures. Type-only imports are erased and hide the trap.

### Non-goals

- Breaking any runtime behaviour or DI wiring.
- Moving ports/types/guards/entities/exceptions — they stay in the main barrel so downstream consumers don't have to split imports for every small thing.
- Moving service *interfaces* (`I*Service`) — type-only, no cycle risk, keep them on the main barrel.
- Moving Symbol tokens — pure Symbols, no cycle risk, keep them on the main barrel.
- Touching `libs/core/src/listings/infrastructure/` repositories (none are re-exported from the main barrel today).

### Layer classification

CORE packaging. Zero architectural change. This PR is about *how the core module surfaces itself* to callers, not what lives inside.

---

## 2. Research — current state

### Main barrel `libs/core/src/listings/index.ts` today (136 lines)

**Poison exports** (runtime values that transitively reach sibling packages):
- `ListingsModule` (line 7)
- 7 `@Injectable` service classes:
  - `OfferLinkingService` (line 20)
  - `OfferMappingSyncService` (line 21)
  - `CategoryResolutionService` (line 22)
  - `OfferBuilderService` (line 62)
  - `OfferCreationExecutionService` (line 65)
  - `SellerPoliciesService` (line 78)
  - `OfferCreationEnqueueService` (line 84)

**Safe exports** — everything else:
- 10 Symbol tokens (lines 8-19)
- 3 repository ports (lines 35, 60, 81-83)
- All domain types (offer-mapping, offer-update, offer-creation-record, snapshot, offer-feed, offer-quantity, offer-fields, category, offer-create, seller-policies)
- All enumeration consts (`CategoryResolutionMethodValues`, `OfferCreationStatusValues`, `OFFER_CREATION_REQUEST_SNAPSHOT_SCHEMA_VERSION`, `CreateOfferResultStatusValues`)
- Domain entity: `OfferCreationRecord`
- 4 domain exceptions (`OfferCreationRecordNotFoundException`, `OfferBuilderValidationException`, `MasterCatalogConnectionNotConfiguredException`, `OfferCreateRejectedException`)
- `OfferManagerPort` + all capability interfaces + type guards (lines 91-136)
- 6 service interface types (`IOfferMappingSyncService`, `ICategoryResolutionService`, `IOfferBuilderService`, `IOfferCreationExecutionService`, `ISellerPoliciesService`, `IOfferCreationEnqueueService`)
- 3 execution input/output types (`BuildCreateOfferCommandInput`, `ExecuteOfferCreationInput`/`Result`, `EnqueueOfferCreationInput`/`Result`)

### External consumers of the "poison" exports

After grepping every `from '@openlinker/core/listings'` site across the repo (**56 matches**, filtered to non-`dist`/non-internal) — plus a confirming pass through `apps/web` (**0 matches**; the browser SPA doesn't import `@openlinker/core/*` at all, as documented in `docs/frontend-architecture.md`):

**Only 2 external files import `ListingsModule` as a value** (nothing imports any service class directly):
- `apps/api/src/listings/listings.module.ts:10`
- `apps/worker/src/sync/sync-worker.module.ts:17`

All other consumers use the services via token + interface injection — those tokens (pure Symbols) and interfaces (type-only) are safe to stay on the main barrel.

### The workaround to revert

`libs/core/src/products/application/services/auto-match-variant-offers.service.ts:14-16` — deep-path import of `isOfferLister`. Gets replaced by a normal barrel import once the split lands.

### Package plumbing

`libs/core/package.json` `exports` field already declares:
- `./listings` → `./dist/listings/index.{js,d.ts}`
- `./listings/*` → `./dist/listings/*.{js,d.ts}` (pattern match; used by the current #337 deep-path workaround)

The top-level-barrel+wildcard pattern mirrors every other bounded context (`./orders`, `./products`, etc.). Adding a dedicated `./listings/services` explicit entry matches that convention and resolves the subpath to a directory `index.{js,d.ts}` via a named entry rather than via the wildcard (the wildcard only matches flat files, not directories).

tsconfig `paths` (`@openlinker/core/*: libs/core/src/*`) and Jest `moduleNameMapper` (`^@openlinker/core/(.*)$: <rootDir>/$1`) both resolve directory imports via `index.ts` automatically — no config change needed there.

---

## 3. Design

### New file layout

```
libs/core/src/listings/
├── index.ts              ← pure barrel (trimmed)
├── listings.module.ts    ← unchanged location
├── services/
│   └── index.ts          ← NEW: ListingsModule + 7 @Injectable service classes
├── __tests__/
│   └── barrel-purity.spec.ts  ← NEW: regression guard
├── application/          ← unchanged
├── domain/               ← unchanged
└── infrastructure/       ← unchanged
```

**Directory form chosen** (`services/` + `index.ts`) over a single-file alternative (`services.ts`) to match the existing per-bounded-context subpath convention (`./orders` + `./orders/*`, `./products` + `./products/*`, etc. in `libs/core/package.json`). The single-file form would resolve via the existing `./listings/*` wildcard with zero `package.json` changes, but would be the only bounded context using the flat shape.

### New `services/index.ts` (8 value exports)

```typescript
/**
 * Listings Module — impure runtime exports
 *
 * NestJS module + Injectable service classes. Kept on a subpath so the main
 * @openlinker/core/listings barrel stays pure and safe to value-import from
 * sibling packages (issue #359; surfaced by #337/#360).
 *
 * @module libs/core/src/listings/services
 */

export { ListingsModule } from '../listings.module';
export { OfferLinkingService } from '../application/services/offer-linking.service';
export { OfferMappingSyncService } from '../application/services/offer-mapping-sync.service';
export { CategoryResolutionService } from '../application/services/category-resolution.service';
export { OfferBuilderService } from '../application/services/offer-builder.service';
export { OfferCreationExecutionService } from '../application/services/offer-creation-execution.service';
export { SellerPoliciesService } from '../application/services/seller-policies.service';
export { OfferCreationEnqueueService } from '../application/services/offer-creation-enqueue.service';
```

### Trimmed main `index.ts`

Same file as today, with the 8 poison exports removed. Everything else — tokens, ports, types, enum consts, entities, exceptions, capability interfaces + guards, service interfaces, execution-input types — stays as is. A header comment marks the boundary.

### `package.json` exports update

Add a dedicated entry alongside the existing `./listings` / `./listings/*` pair:

```json
    "./listings": { … },
    "./listings/services": {
      "types": "./dist/listings/services/index.d.ts",
      "require": "./dist/listings/services/index.js",
      "default": "./dist/listings/services/index.js"
    },
    "./listings/*": { … },
```

Order matters: the explicit `./listings/services` entry must precede the `./listings/*` wildcard so Node matches the explicit rule first. Verified by re-reading the existing entries for `./integrations`, `./orders`, etc. which follow the same ordering.

### Consumer updates (3 files)

1. `apps/api/src/listings/listings.module.ts:10`
   ```diff
   - import { ListingsModule as CoreListingsModule } from '@openlinker/core/listings';
   + import { ListingsModule as CoreListingsModule } from '@openlinker/core/listings/services';
   ```

2. `apps/worker/src/sync/sync-worker.module.ts:17`
   ```diff
   - import { ListingsModule } from '@openlinker/core/listings';
   + import { ListingsModule } from '@openlinker/core/listings/services';
   ```

3. `libs/core/src/products/application/services/auto-match-variant-offers.service.ts:12-16`
   ```diff
   - import type { OfferManagerPort, OfferFeedOutput } from '@openlinker/core/listings';
   - // Direct subpath import bypasses the `@openlinker/core/listings` barrel — the
   - // barrel re-exports services whose transitive imports loop back through
   - // `@openlinker/core/products`, creating a runtime circular require. Importing
   - // the guard from its capability file keeps the dependency graph acyclic.
   - import { isOfferLister } from '@openlinker/core/listings/domain/ports/capabilities/offer-lister.capability';
   + import { isOfferLister, type OfferManagerPort, type OfferFeedOutput } from '@openlinker/core/listings';
   ```

### Why the cycle is actually broken

After the split, `auto-match-variant-offers.service.ts` imports `isOfferLister` via the main barrel. The main barrel's transitive imports are all pure: it only references files under `./domain/*` and `./application/types/*.types.ts` and the capability files. None of those reach back into `@openlinker/core/products` or any other sibling package at runtime.

`ListingsModule` still wires all 7 services (those services *do* reach sibling packages), but `ListingsModule` now lives on `@openlinker/core/listings/services` and is consumed only from `apps/api/src/listings/listings.module.ts` and `apps/worker/src/sync/sync-worker.module.ts` — both leaves of the dependency graph. No cycle.

### Tests

- Existing unit tests import service classes via **relative** paths (e.g. `../offer-mapping-sync.service`) — not through the barrel. No edit needed.
- Existing integration tests consume services via DI (tokens + interface types from the main barrel). No edit needed.

**New regression-guard spec** — `libs/core/src/listings/__tests__/barrel-purity.spec.ts`. Imports `* as listings from '@openlinker/core/listings'` (the pure barrel) and asserts the 7 `@Injectable` service classes + `ListingsModule` are **not** properties on the namespace. Pins the architectural invariant so a future PR that silently re-adds `export { OfferMappingSyncService }` to `index.ts` breaks CI immediately, rather than hiding until the next time a sibling-package value-imports from the barrel.

### Docs

One-sentence addition to `docs/architecture-overview.md` §"6. Listings (Offers)" documenting the dual public surface (`@openlinker/core/listings` = pure contracts; `@openlinker/core/listings/services` = NestJS module + Injectable service classes). Rationale: the split is ad hoc for listings today, but a future bounded context that grows cross-package service imports may need the same pattern; a one-liner in the architecture doc means a maintainer can discover it without re-deriving the #337 incident.

No engineering-standards change — the packaging split is specific to how a bounded context exposes its public surface, not a universal file-layout rule.

---

## 4. Step-by-step implementation

Every step leaves the tree both type-checking **and runtime-clean**. The critical ordering: the main barrel must be trimmed **before** reverting the cycle-break workaround in `auto-match-variant-offers.service.ts` — otherwise the intermediate state reintroduces the exact runtime cycle that #337/#360 fixed, and `pnpm test` fails.

### Step 1 — Add `libs/core/src/listings/services/index.ts`

8 named re-exports (`ListingsModule` + 7 service classes), sourced from their existing files via relative paths.

**Acceptance:** `pnpm type-check` green. Main barrel still has the duplicate exports; both subpaths resolve.

### Step 2 — Add `./listings/services` entry to `libs/core/package.json`

Insert between `./listings` and `./listings/*` (explicit entries must precede the wildcard).

**Acceptance:** `pnpm install` resolves without warning. `@openlinker/core/listings/services` resolves at type-check time via tsconfig `paths` + `moduleResolution: Node16`.

### Step 3 — Repoint `apps/api/src/listings/listings.module.ts`

Change the `CoreListingsModule` import from `@openlinker/core/listings` to `@openlinker/core/listings/services`.

**Acceptance:** `pnpm --filter @openlinker/api type-check` green.

### Step 4 — Repoint `apps/worker/src/sync/sync-worker.module.ts`

Same change for `ListingsModule` import.

**Acceptance:** `pnpm --filter @openlinker/worker type-check` green.

### Step 5 — Trim `libs/core/src/listings/index.ts`

Remove the 8 poison re-exports (`ListingsModule` + 7 `@Injectable` service classes). Everything else stays. Keep a short comment above the first surviving export block explaining the "pure barrel; service implementations live on `./services`" contract.

**Acceptance:** Full-repo `pnpm type-check` green. The barrel is now pure: nothing it re-exports reaches back into sibling packages. If a consumer I missed still value-imports a service class from the main barrel, TS surfaces the error here; each fix is a mechanical repoint to `./services`.

### Step 6 — Revert the deep-path workaround in `auto-match-variant-offers.service.ts`

Now that the main barrel is pure (step 5), the value import of `isOfferLister` through `@openlinker/core/listings` is safe. Replace the two-statement workaround (type-only import + deep-path value import + the 4-line cycle-break comment block) with a single consolidated barrel import.

**Acceptance:** `pnpm --filter @openlinker/core type-check` green **and** `pnpm --filter @openlinker/core test` green. This is the step that exercises the fix end-to-end: before step 5 this would have failed with the `Symbol(?)` DI error; now it passes.

### Step 7 — Add `libs/core/src/listings/__tests__/barrel-purity.spec.ts`

Regression guard:

```ts
import * as listings from '@openlinker/core/listings';

const FORBIDDEN_EXPORTS = [
  'ListingsModule',
  'OfferLinkingService',
  'OfferMappingSyncService',
  'CategoryResolutionService',
  'OfferBuilderService',
  'OfferCreationExecutionService',
  'SellerPoliciesService',
  'OfferCreationEnqueueService',
] as const;

describe('@openlinker/core/listings barrel purity', () => {
  it.each(FORBIDDEN_EXPORTS)(
    'does not re-export %s (lives on @openlinker/core/listings/services — see #359)',
    (name) => {
      expect(listings).not.toHaveProperty(name);
    },
  );
});
```

**Acceptance:** `pnpm --filter @openlinker/core test` green. A future PR that re-adds any of these to the main barrel breaks this spec immediately.

### Step 8 — Update `docs/architecture-overview.md` §"6. Listings (Offers)"

Add one sentence documenting the dual public surface:

> **Public surface:** `@openlinker/core/listings` exposes pure contracts (ports, types, capability guards, entities, exceptions, service interfaces, Symbol tokens) safe to value-import from any sibling package. Runtime wiring (`ListingsModule` + the 7 `@Injectable` service classes) lives on the `@openlinker/core/listings/services` subpath — kept separate to prevent runtime circular requires when sibling packages value-import from the main barrel (#337/#359).

**Acceptance:** doc reads coherently in the existing section shape.

### Step 9 — Quality gate

```bash
pnpm lint
pnpm type-check
pnpm test
pnpm test:integration                       # api side
pnpm --filter @openlinker/worker test:integration
```

All must pass. The pre-existing `allegro-order-sync-e2e.int-spec.ts` flake (confirmed on main in #337's review) is expected and not blocking.

### Step 10 — Commit + push + PR

Single commit. Conventional message with `Closes #359`. Push, open PR against `main`.

---

## 5. Validation

### Architecture compliance

- ✅ No new DI token, no new service interface, no architectural shift. Pure packaging.
- ✅ Main barrel stays the single source for ports, types, guards, exceptions, entities — matches the established convention (consumers import ports via the module alias, no deep paths).
- ✅ Services subpath follows the same pattern: a dedicated `./services/index.ts` + matching `package.json` entry, mirroring every other top-level bounded context.

### Code quality

- ✅ No `any`. No new logging. No new comments explaining *what* (the removed comment block was explaining *why* a workaround existed — the workaround itself disappears).
- ✅ File headers on the new `services/index.ts`.

### Risks + mitigations

| Risk | Mitigation |
|---|---|
| Node `exports` pattern ordering wrong → subpath fails to resolve | Place the explicit `./listings/services` entry *before* `./listings/*` wildcard. Verified against the existing pattern for every other bounded context. |
| A consumer imports a service class as a value from the main barrel that I missed | Step 6 (main barrel trim) surfaces it as a TS error. Fix-forward is a mechanical re-point to `./services`. |
| Jest `moduleNameMapper` doesn't resolve the `/services` subpath | `^@openlinker/core/(.*)$: <rootDir>/$1` maps `@openlinker/core/listings/services` → `libs/core/src/listings/services` — Jest's directory resolution finds `index.ts` via `moduleFileExtensions`. No change needed. If it somehow fails, add the explicit subpath to the mapper. |
| ts-jest transpiling doesn't find the subpath | Same as above; tsconfig `paths` resolves directories. If not, add explicit path. |
| Cycle reappears because the main barrel still indirectly pulls `listings.module.ts` | Verified: nothing in the trimmed main barrel imports from `./listings.module.ts`. Every surviving export is either a port (domain-pure), a type (erased), an enum const (no imports), a domain entity/exception (no sibling imports), or a capability guard (only imports from `./domain/types/*` + the port). |

### Behaviour preservation

Every pre-existing runtime import still resolves:
- `@openlinker/core/listings` → same tokens, ports, types, guards, entities, exceptions as before.
- `@openlinker/core/listings/services` → `ListingsModule` + 7 service classes, freshly accessible.
- `@openlinker/core/listings/domain/ports/capabilities/offer-lister.capability` → still works via the wildcard (backwards-compat for anyone who happened to import the deep path).

No DI wiring change. No `ListingsModule` semantics change. No test shape change.

---

## 6. Estimate

~35 min end-to-end:
- 5 min — Step 1 (new `services/index.ts`)
- 2 min — Step 2 (`package.json` entry)
- 5 min — Steps 3–4 (two module repoints)
- 3 min — Step 5 (trim main barrel)
- 2 min — Step 6 (revert workaround)
- 5 min — Step 7 (barrel-purity spec)
- 3 min — Step 8 (architecture-overview doc update)
- 10 min — Steps 9–10 (quality gate incl. integration + commit + PR)

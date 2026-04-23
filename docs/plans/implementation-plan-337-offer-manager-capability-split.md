# Implementation Plan — #337 — OfferManagerPort capability split

**Branch:** `337-offer-manager-capability-split`
**Layer:** CORE (domain refactor) + Integration (adapter declaration) + Application (call-site migration) + Docs
**Scope:** Type-level refactor — no runtime behaviour change
**Risk:** Low — behaviour-preserving, boundaries clearly defined

---

## 1. Understand the task

### Goal

Replace the 8 optional methods on `OfferManagerPort` with distinct **capability interfaces** + co-located **type guards**. Call sites switch from `if (!adapter.method)` (presence check) to `if (!isCapability(adapter))` (type-narrowing guard). Purely a type-level / code-shape refactor.

### Why

Today an adapter "supports a capability" is expressed only by method presence. Consequences:

- A handler that forgets the `if (!adapter.method)` guard crashes at runtime.
- `OfferManagerPort` balloons as new optional capabilities accrete.
- Test doubles must carry every optional slot, even unused ones.
- No compile-time rejection of "passed an adapter to a handler that needs capability X".

Capability interfaces + type guards give us:
- Compile-time narrowing: after the guard, the method is guaranteed callable.
- Smaller, composable port — adding capabilities no longer edits the base interface.
- Minimal test doubles — only implement the capabilities needed.
- Mirrors the existing capability-registry model (`Capability` union) with a finer-grained layer suitable for future per-sub-capability routing.

### Non-goals

- Changing which adapters support which capabilities (Allegro still supports all eight).
- Changing the string `Capability` union (`'OfferManager'` stays) or the adapter registry (`supportedCapabilities`).
- Splitting `OrderSourcePort` (its methods are both required — not a target).
- Renaming `updateOfferQuantity` or otherwise touching the required base method.
- Any DB migration (none needed).
- PrestaShop: doesn't advertise `OfferManager` — nothing to change there.

### Layer classification

- Domain refactor in `libs/core/src/listings/domain/ports/` — primary work.
- Application service edits — mechanical replacement of null checks with guards.
- One integration adapter edit (`AllegroOfferManagerAdapter`) — add `implements` clauses.
- One API service + one worker handler touched (outside `libs/`). No infra changes.
- Doc updates: `docs/architecture-overview.md` §"OfferManagerPort" + one-line suffix registration in `docs/engineering-standards.md`.

---

## 2. Research — current state

**Port file:** `libs/core/src/listings/domain/ports/offer-manager.port.ts`
- 1 required: `updateOfferQuantity`
- 8 optional: `listOffers`, `listOfferEvents`, `updateOfferQuantitiesBatch`, `updateOfferFields`, `fetchCategories`, `matchCategoryByBarcode`, `createOffer`, `fetchSellerPolicies`

**Index re-export:** `libs/core/src/listings/index.ts:92` already re-exports `OfferManagerPort`. The new capability exports will join the same block.

**Adapters:**
- `libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts:89` — `implements OfferManagerPort` (implements all 9 methods).
- No other implementors.

**Null-check call sites — full inventory (9):**

| # | File | Line | Method |
|---|---|---|---|
| 1 | `libs/core/src/listings/application/services/offer-mapping-sync.service.ts` | 119 | `listOfferEvents` |
| 2 | `libs/core/src/listings/application/services/offer-mapping-sync.service.ts` | 128 | `listOffers` |
| 3 | `libs/core/src/listings/application/services/offer-creation-enqueue.service.ts` | 64 | `createOffer` |
| 4 | `libs/core/src/listings/application/services/offer-creation-execution.service.ts` | 100 | `createOffer` |
| 5 | `libs/core/src/listings/application/services/category-resolution.service.ts` | 73 | `matchCategoryByBarcode` |
| 6 | `libs/core/src/listings/application/services/seller-policies.service.ts` | 54 | `fetchSellerPolicies` |
| 7 | `libs/core/src/products/application/services/auto-match-variant-offers.service.ts` | 143 | `listOffers` |
| 8 | `apps/api/src/categories/categories-cache.service.ts` | 53 | `fetchCategories` |
| 9 | `apps/worker/src/sync/handlers/marketplace-offer-field-update.handler.ts` | 63 | `updateOfferFields` |

`updateOfferQuantitiesBatch` has **no consumer** today — still included in the split because the Allegro adapter implements it; removing it would be a behavioural loss.

**Unit tests that touch OfferManagerPort mocks:**
- `libs/core/src/listings/application/services/__tests__/offer-mapping-sync.service.spec.ts`
- `libs/core/src/listings/application/services/__tests__/offer-creation-enqueue.service.spec.ts`
- `libs/core/src/listings/application/services/__tests__/offer-creation-execution.service.spec.ts`
- `libs/core/src/listings/application/services/__tests__/category-resolution.service.spec.ts`
- `libs/core/src/listings/application/services/__tests__/seller-policies.service.spec.ts`

**Integration-test helper:** `apps/worker/test/integration/helpers/mock-allegro-adapters.helper.ts` — annotation updates required; consumed by `apps/worker/test/integration/marketplace-offers-sync-e2e.int-spec.ts`.

**Capability registry (string-level):** `libs/core/src/integrations/domain/types/adapter.types.ts:18-24` — `'OfferManager'` is in `CapabilityValues`. Untouched by this refactor.

**Existing docs to update:**
- `docs/architecture-overview.md` lines 441–454 — the `OfferManagerPort` interface sketch with 8 optional methods.
- `docs/engineering-standards.md` §"Domain Layer Files" — register the new `*.capability.ts` suffix.

---

## 3. Design

### Capability interfaces — one per optional method

Eight capabilities, one method each. Per-method interfaces give maximum composability (a future adapter that supports `listOffers` but not events declares only `OfferLister`).

| Capability interface | Method | File |
|---|---|---|
| `OfferLister` | `listOffers` | `offer-lister.capability.ts` |
| `OfferEventReader` | `listOfferEvents` | `offer-event-reader.capability.ts` |
| `OfferQuantityBatchUpdater` | `updateOfferQuantitiesBatch` | `offer-quantity-batch-updater.capability.ts` |
| `OfferFieldUpdater` | `updateOfferFields` | `offer-field-updater.capability.ts` |
| `CategoryBrowser` | `fetchCategories` | `category-browser.capability.ts` |
| `CategoryBarcodeMatcher` | `matchCategoryByBarcode` | `category-barcode-matcher.capability.ts` |
| `OfferCreator` | `createOffer` | `offer-creator.capability.ts` |
| `SellerPoliciesReader` | `fetchSellerPolicies` | `seller-policies-reader.capability.ts` |

### Naming decision — no `Port` suffix (conscious)

Engineering standards specify `{Capability}Port` for top-level ports. These interfaces are *sub-capabilities* layered onto `OfferManagerPort`, not independent top-level ports — the issue's own proposal drops the suffix (`isOfferFieldUpdater`, not `isOfferFieldUpdaterPort`). Reads naturally as a role (`OfferCreator`, `CategoryBrowser`). The capability files' header comments will call this out explicitly so a future contributor doesn't "fix" them by renaming.

### Directory

```
libs/core/src/listings/domain/ports/
├── offer-manager.port.ts          # base: only updateOfferQuantity
└── capabilities/
    ├── offer-lister.capability.ts
    ├── offer-event-reader.capability.ts
    ├── offer-quantity-batch-updater.capability.ts
    ├── offer-field-updater.capability.ts
    ├── category-browser.capability.ts
    ├── category-barcode-matcher.capability.ts
    ├── offer-creator.capability.ts
    ├── seller-policies-reader.capability.ts
    └── __tests__/
        └── offer-manager-capabilities.spec.ts
```

### File naming — `*.capability.ts`

Engineering standards reserve `*.port.ts` for "interface definition only". These capability files bundle an interface **and** a runtime type-guard function. I considered the stricter alternative — `*.port.ts` + companion `*.guard.ts` (16 files total, mirroring the service-interface/implementation split). Rejected: the guard is meaningless without its interface, and splitting would double the file count for zero architectural gain. The runtime+type co-location precedent already exists in `adapter.types.ts` (`CapabilityValues` runtime array + `Capability` type in one file).

To prevent this convention from looking like unannounced drift, Step 10 adds a one-line suffix registration to `docs/engineering-standards.md` "Domain Layer Files":

> - **Port sub-capabilities**: `*.capability.ts` (e.g. `offer-creator.capability.ts`) — optional capability interface + co-located `is{Capability}` type-guard. Used when a port has optional methods that can be extracted as distinct composable capabilities.

### Shape — each capability file

```typescript
/**
 * Offer Lister Capability
 *
 * Optional sub-capability of `OfferManagerPort` — adapters that can page
 * through the marketplace's current offer catalogue declare `implements OfferLister`.
 *
 * Call sites narrow support via `isOfferLister(adapter)`.
 *
 * Naming: sub-capabilities deliberately drop the `Port` suffix — they layer
 * onto `OfferManagerPort`, they are not independent top-level ports. Do not
 * rename to `OfferListerPort`.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */

import type { OfferFeedInput, OfferFeedOutput } from '../../types/offer-feed.types';
import type { OfferManagerPort } from '../offer-manager.port';

export interface OfferLister {
  listOffers(input: OfferFeedInput): Promise<OfferFeedOutput>;
}

export function isOfferLister(
  adapter: OfferManagerPort,
): adapter is OfferManagerPort & OfferLister {
  return typeof (adapter as Partial<OfferLister>).listOffers === 'function';
}
```

The guard uses `typeof X === 'function'` — matches the existing null-check behaviour semantically (`!adapter.x` was false for both `undefined` and non-function falsies, but in practice every consumer stored a function or nothing; the stronger check is safer and prevents accidental field-name collisions).

Only the first file (`offer-lister.capability.ts`) carries the long "Naming:" paragraph; subsequent files get a short one-liner that references it.

### Base port — trimmed (last code step)

After refactor, `offer-manager.port.ts` contains only:

```typescript
export interface OfferManagerPort {
  updateOfferQuantity(cmd: UpdateOfferQuantityCommand): Promise<void>;
}
```

The port's file-level doc comment is updated to point at `capabilities/` for optional sub-capabilities. All other method signatures + their JSDoc move to their capability files.

### Adapter — `AllegroOfferManagerAdapter`

Class declaration changes from:

```typescript
export class AllegroOfferManagerAdapter implements OfferManagerPort { ... }
```

to:

```typescript
export class AllegroOfferManagerAdapter
  implements
    OfferManagerPort,
    OfferLister,
    OfferEventReader,
    OfferQuantityBatchUpdater,
    OfferFieldUpdater,
    CategoryBrowser,
    CategoryBarcodeMatcher,
    OfferCreator,
    SellerPoliciesReader { ... }
```

Method bodies unchanged. The `?` modifiers on methods are irrelevant to an adapter that always implements them.

### Call-site migration — template

Before:
```typescript
if (!adapter.createOffer) {
  throw new UnprocessableEntityException('…');
}
await adapter.createOffer(command);
```

After:
```typescript
if (!isOfferCreator(adapter)) {
  throw new UnprocessableEntityException('…');
}
await adapter.createOffer(command); // now type-narrowed to OfferCreator
```

Same runtime behaviour. Every call site: swap the condition, keep the error/message, keep the subsequent method call.

One wrinkle — `offer-mapping-sync.service.ts` does **two** optional checks in the same function. Both migrate independently; the fallback logic (prefer events, fall back to lister) stays identical.

### Exports — `libs/core/src/listings/index.ts`

`OfferManagerPort` is already re-exported at line 92. Add the 8 capability interfaces + their type guards in the same block so application services can `import { isOfferCreator, OfferCreator } from '@openlinker/core/listings'`.

### Testing

**Unit tests — keep green without edits where possible.**
Existing service specs mock `OfferManagerPort` as `{ listOffers: jest.fn(), … }`. Since jest mocks are functions, the new `typeof X === 'function'` guards return `true` for the same mock shape → tests continue to pass unchanged.

Test shapes that mock a partial port (e.g. omit `createOffer` to assert the "not supported" branch) also continue to work — omitting the field returns `undefined`, guard returns `false`, same behaviour.

Only likely adjustment: the type of the mock variable (`Partial<OfferManagerPort>` or explicit object-literal) may need an updated annotation (e.g. `Partial<OfferManagerPort & OfferCreator>`) to keep TS happy. Localised fix per file.

**New test — `offer-manager-capabilities.spec.ts`** (one file covering all 8 guards):
- For each guard: asserts `true` when the relevant method is a function; `false` when absent; `false` when present but non-function.

**Integration tests — required, not conditional.**
Step 6 modifies `apps/worker/test/integration/helpers/mock-allegro-adapters.helper.ts`, consumed by `apps/worker/test/integration/marketplace-offers-sync-e2e.int-spec.ts`. Even if the mock change is annotation-only, the helper's consumers must exercise the new type shapes end-to-end against the Testcontainer stack before merge.

---

## 4. Step-by-step implementation

**Ordering principle:** every intermediate commit type-checks. The port is trimmed **last** (after all capability consumers exist and all call sites use guards) so the tree never enters a broken state.

### Step 1 — Add capability directory + eight capability files

**Files (new):**
- `libs/core/src/listings/domain/ports/capabilities/offer-lister.capability.ts`
- `.../capabilities/offer-event-reader.capability.ts`
- `.../capabilities/offer-quantity-batch-updater.capability.ts`
- `.../capabilities/offer-field-updater.capability.ts`
- `.../capabilities/category-browser.capability.ts`
- `.../capabilities/category-barcode-matcher.capability.ts`
- `.../capabilities/offer-creator.capability.ts`
- `.../capabilities/seller-policies-reader.capability.ts`

**Each file:** header comment (with naming rationale only on the first file; short one-liner on the rest), typed import of the domain types it references, `import type { OfferManagerPort } from '../offer-manager.port'`, the capability interface, the `is{Capability}` guard.

**Acceptance:** `pnpm type-check` passes — nothing else consumes these yet.

### Step 2 — Re-export capabilities from listings index

**File (edit):** `libs/core/src/listings/index.ts`

Confirmed: `OfferManagerPort` is already exported at line 92. Add an adjacent block re-exporting all 8 capability interfaces + guards.

**Acceptance:** `pnpm type-check` passes; `import { isOfferCreator } from '@openlinker/core/listings'` resolves.

### Step 3 — Update `AllegroOfferManagerAdapter` with capability declarations

**File (edit):** `libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts`

- Change `implements OfferManagerPort` to the 9-interface list (base + 8 capabilities).
- Add imports for the 8 capability interfaces from `@openlinker/core/listings`.
- No method-body changes.

Note: the base `OfferManagerPort` still carries all 8 optional methods at this point — the adapter satisfies both the old shape and the new capabilities simultaneously. The tree stays green.

**Acceptance:** Adapter type-checks. The `implements` list exercises every capability → compiler asserts each method signature matches the new interfaces.

### Step 4 — Migrate the 9 null-check call sites to type guards

**Files (edit):**

| File | Line | Guard |
|---|---|---|
| `libs/core/src/listings/application/services/offer-mapping-sync.service.ts` | 119 | `isOfferEventReader` |
| `libs/core/src/listings/application/services/offer-mapping-sync.service.ts` | 128 | `isOfferLister` |
| `libs/core/src/listings/application/services/offer-creation-enqueue.service.ts` | 64 | `isOfferCreator` |
| `libs/core/src/listings/application/services/offer-creation-execution.service.ts` | 100 | `isOfferCreator` |
| `libs/core/src/listings/application/services/category-resolution.service.ts` | 73 | `isCategoryBarcodeMatcher` |
| `libs/core/src/listings/application/services/seller-policies.service.ts` | 54 | `isSellerPoliciesReader` |
| `libs/core/src/products/application/services/auto-match-variant-offers.service.ts` | 143 | `isOfferLister` |
| `apps/api/src/categories/categories-cache.service.ts` | 53 | `isCategoryBrowser` |
| `apps/worker/src/sync/handlers/marketplace-offer-field-update.handler.ts` | 63 | `isOfferFieldUpdater` |

**For each:** add the guard import from `@openlinker/core/listings`; replace `if (!x.method)` with `if (!isCapability(x))`; leave error message and downstream call unchanged.

Special case — `offer-mapping-sync.service.ts`: the `loadOfferFeed` helper has the "prefer events, fall back to lister" branch. Both guards applied independently; logic preserved.

The port still has optional methods at this point, so both the old presence checks and the new guards type-check. Only after all 9 sites migrate does Step 6 tighten the base port.

**Acceptance:** Each service/handler type-checks. The code inside each `if`-branch now has a narrowed `adapter` type — TS rejects any call that doesn't match the guard.

### Step 5 — Update integration-test adapter mock

**File (edit):** `apps/worker/test/integration/helpers/mock-allegro-adapters.helper.ts`

Update the mock's type annotation (and any `as OfferManagerPort` casts) to reflect the new capability split. Expected: a simple annotation tweak or a small helper-class `implements` list update. Runtime shape unchanged.

**Acceptance:** `pnpm type-check` passes; the mock still provides the same methods at runtime.

### Step 6 — Trim `OfferManagerPort` to the required base method

**File (edit):** `libs/core/src/listings/domain/ports/offer-manager.port.ts`

- Remove the 8 optional methods.
- Remove now-unused type imports (only `UpdateOfferQuantityCommand` remains).
- Update header doc to point at `capabilities/` for optional sub-capabilities.

Because all call sites now use capability guards (Step 4) and the adapter declares all capabilities explicitly (Step 3), this step is type-safe: nothing still reads `adapter.createOffer` without first narrowing via a guard.

**Acceptance:** `pnpm type-check` passes for the whole repo. Fail-forward — if any call site was missed in Step 4, TS surfaces it here.

### Step 7 — Add `offer-manager-capabilities.spec.ts` for the 8 type guards

**File (new):** `libs/core/src/listings/domain/ports/capabilities/__tests__/offer-manager-capabilities.spec.ts`

Table-driven: for each `{guard, methodName}` pair, assert:
- `guard({ [methodName]: jest.fn() } as unknown as OfferManagerPort)` → `true`
- `guard({} as unknown as OfferManagerPort)` → `false` (and also `guard({ updateOfferQuantity: jest.fn() } as OfferManagerPort)` — a valid-but-minimal adapter → `false` for every sub-capability)
- `guard({ [methodName]: 'not a function' } as unknown as OfferManagerPort)` → `false`

**Acceptance:** `pnpm test` — new spec passes; 8 guards × 3 cases green.

### Step 8 — Update architecture-overview docs

**File (edit):** `docs/architecture-overview.md` §"OfferManagerPort" (lines 441–454)

- Replace the inline interface sketch with the trimmed base port (only `updateOfferQuantity`).
- Add a short paragraph (2–4 sentences) introducing the `capabilities/` sub-directory, listing the 8 capability interfaces, and noting the type-guard pattern (`is{Capability}(adapter)`).
- Keep the "Current Implementation" and "Future Implementations" lines as-is.

**Acceptance:** Docs describe the new shape accurately. A contributor reading only `architecture-overview.md` understands what lives on the base port vs what lives in `capabilities/`.

### Step 9 — Register the `*.capability.ts` suffix in engineering standards

**File (edit):** `docs/engineering-standards.md` §"Files and Folders → Domain Layer Files"

Add a single bullet after "Ports (Interfaces)":

> - **Port sub-capabilities**: `*.capability.ts` (e.g. `offer-creator.capability.ts`) — optional capability interface + co-located `is{Capability}` type-guard. Used when a port has optional methods that can be extracted as distinct composable capabilities.

**Acceptance:** The new file-suffix convention is registered so the next reviewer doesn't treat it as drift.

### Step 10 — Quality gate

```bash
pnpm lint
pnpm type-check
pnpm test
pnpm test:integration
```

All four are required. The integration run is non-negotiable because Step 5 touches an integration helper. Fix any fallout before commit.

### Step 11 — Review + commit

Self-review against `docs/code-review-guide.md`. Commit message:

```
refactor(listings): split OfferManagerPort optional methods into capability interfaces

Extract the 8 optional methods on OfferManagerPort into per-method
capability interfaces with co-located type guards under
libs/core/src/listings/domain/ports/capabilities/. Call sites switch
from presence checks (if (!adapter.method)) to type-narrowing guards
(if (!isCapability(adapter))) — same runtime behaviour, now the method
call inside the branch is type-checked.

Register the new *.capability.ts suffix in engineering-standards.md and
update the OfferManagerPort section in architecture-overview.md to
reflect the new shape.

Closes #337
```

---

## 5. Validation

### Architecture compliance

- ✅ Capability interfaces live in the domain layer — no framework imports.
- ✅ Each interface co-located with its guard — not scattered.
- ✅ No new DI wiring (pure type-level refactor at the boundary).
- ✅ `OfferManagerPort` stays as the single injection point (`integrationsService.getCapabilityAdapter<OfferManagerPort>(…)`); guards narrow the type locally.
- ✅ Docs updated to match code (architecture-overview + engineering-standards).

### Naming

- `OfferLister`, `OfferCreator`, `CategoryBrowser`, etc. — noun-phrase capability roles. Drops `Port` suffix deliberately (sub-capabilities, not independent top-level ports); rationale in each capability file's header.
- Guards: `is{Capability}` — idiomatic TS, matches project convention.
- Files: `*.capability.ts` — deviation from `*.port.ts` registered in engineering-standards in Step 9.

### Testing

- Behaviour preserved — every existing service spec stays green (jest mocks are functions → `typeof === 'function'` guards pass).
- New `offer-manager-capabilities.spec.ts` adds direct coverage for the 8 guards (24+ assertions).
- Integration tests mandatory because Step 5 touches an integration helper.

### Risks + mitigations

| Risk | Mitigation |
|---|---|
| A call site is missed in Step 4 | Step 6 surfaces it as a type error (port no longer has the method); `pnpm type-check` in the quality gate catches any remaining site. |
| Integration-test mock annotation needs more work than expected | Step 5 is isolated; `pnpm test:integration` in the quality gate validates before merge. |
| Guard strictness (`typeof === 'function'`) differs from the old `!method` | In practice the old `!method` already returned `false` only for function values; no behavioural regression expected. If any test fails unexpectedly, inspect the mock shape — that's the signal. |
| A fresh call site lands between plan and PR | Final-step re-grep: `grep -rn "if (!.*\.\(listOffers\|listOfferEvents\|updateOfferQuantitiesBatch\|updateOfferFields\|fetchCategories\|matchCategoryByBarcode\|createOffer\|fetchSellerPolicies\))" libs apps` should return zero hits. |

### Open questions — none

The plan deviates from the issue's proposal in one spot (splitting `listOffers` + `listOfferEvents` into two capabilities instead of bundling them into `OfferFeedReader`), because the call sites use them independently. Confirmed with user.

---

## 6. Estimate

~90 min end-to-end:
- 15 min — Steps 1–2 (capability files + re-exports)
- 10 min — Step 3 (adapter declarations)
- 20 min — Step 4 (9 call-site migrations + import plumbing)
- 10 min — Step 5 (integration-test mock annotation)
- 5 min — Step 6 (port trim, guarded by TS)
- 10 min — Step 7 (new guard spec)
- 10 min — Steps 8–9 (doc updates)
- 10 min — Steps 10–11 (quality gate incl. integration tests + commit + self-review)

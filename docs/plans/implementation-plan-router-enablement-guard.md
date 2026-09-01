# Implementation Plan: Router enablement guard + first-run location bootstrap (#2407)

**Date**: 2026-08-31
**Status**: Ready for Review
**Issue**: #2407 (`W3a-22`, stream **S3**, size M) — epic #2412 (Wave 3a)
**Branch**: `2407-router-enablement-guard` → PR into `oms-programme-wave-3a`
**Estimated Effort**: ~1 day

---

## 1. Task Summary

**Objective**: Refuse to enable the fulfilment router (authority **A2 / `sourcing`**) on a
connection while **zero `inventory_locations` rows exist**, with an actionable message; and give the
operator a **first-run bootstrap** that mints a starting location **idempotently**, so the refusal
names a remedy the operator can take in one click.

**Context** (REVIEW D3): routing needs locations, and **no install has any** — `inventory_locations`
(Wave 1b, #2313) ships empty and nothing seeds it. Enabling a router against zero locations makes
every line `unfulfillable`, which reads as a broken feature rather than as missing setup. The
router's own `country-served` / `nearest` filters (#2408) are unimplementable without location rows
at all.

**Classification**: DX + Interface + Application. No new bounded context, **no migration**, no new
capability.

---

## 2. Scope & Non-Goals

### In Scope
- A **read** on `ILocationService` answering "does at least one active location exist".
- An **enablement guard** in `ConnectionService.create` / `.update` that refuses the A2 claim
  (`config.sourcingAuthority`) with HTTP 400 and actionable copy when the answer is no.
- An **idempotent bootstrap** on `ILocationService` + a `POST` route, admin-gated.
- A frontend `inventory-locations` slice (API + hooks) and a **router-readiness panel** on the
  connection detail page, beside the Wave-2 authority surface.
- Unit tests for the guard, the bootstrap's idempotency and the FE panel; an int-spec proving the
  refusal and the two-enabled-routers case end to end.

### Out of Scope (with owners)
- **The `Connection.config.routing` filter/sort coercer and the closed rule vocabulary — #2408.**
  This plan authors **no** coercer. See §5.
- Attaching existing `inventory_items` positions to the minted location (`locationId` stays `NULL`).
  Routing's `in-stock` filter is #2408's; ADR-058 step (iii) owns the FK.
- Any routing UI (rule authoring, dry-run explanation) — #2408 / #2410 / #2411.
- Adding `FulfillmentRouter` to `CoreCapabilityValues`. **Explicitly forbidden** (#2403).
- **Maintaining the invariant after enablement.** The guard is **enable-time only**: it refuses the
  `false → true` transition, and does not stop an operator later deleting or deactivating the last
  active location. That residual state is *reported*, never silently tolerated — see **D7**.

### Constraints
- An install that never opts in must be **byte-identical** to today.
- A malformed config must **fail to match**, never throw (the #2161 / #2170 rule-engine shape).
- No new coercer for an existing config key.

---

## 3. Architecture Mapping

**Target layers**: `libs/core/src/inventory` (application + domain types), `apps/api`
(interface + the connection-management service), `apps/web` (features).

**How enablement is decided — without touching `CoreCapabilityValues`.**
A2 is `capability: 'config-only'` (`AUTHORITY_KIND_DESCRIPTORS.sourcing`,
`libs/core/src/fulfillment-authority/domain/types/authority-kind.types.ts`), and `FulfillmentRouter`
is deliberately absent from `CoreCapabilityValues` because a connection's `enabledCapabilities` is
stamped at create and never retro-filled (the #2085 trap; asserted by a live spec and by
`scripts/check-core-capability-mirror.mjs`). So the guard reads the **config claim**, through the
already-shipped pure coercer:

```ts
parseAuthorityConfig(config, 'sourcing').enabled   // key: `sourcingAuthority`
```

Nothing is added to any capability list, mirror or manifest.

**Existing services reused**
- `parseAuthorityConfig` — the A2 claim reader (already ships; #2352).
- `ILocationService.listLocations` — supplies the count via its existing `total`, so
  `LocationRepositoryPort` gains **no** method.
- `ILocationService.createLocation` + `DuplicateLocationCodeError` — the idempotency lever.
- `ConnectionService`'s existing validator dispatch (`validateRateLimitConfig`,
  `validateStockAndPricingConfig`) and its `enqueueInitialTaxonomySync` **transition** precedent.

**New components**
- `libs/core/src/inventory/domain/types/location-bootstrap.types.ts` — the bootstrap's declared set
  + result type (pure; qualifies under the `*.types.ts` pure-rule exception only if it stays
  data-only — it does; no functions).
- Two `ILocationService` methods (interface + impl + spec).
- `POST /inventory/locations/bootstrap` + response DTO.
- `ConnectionService.assertRouterEnablementPreconditions` (private).
- FE: `features/inventory-locations/**` (barrel) + `features/connections/components/router-readiness-panel.tsx`.

**Boundary check**: `ConnectionService` already injects a core service through a barrel + Symbol
token (`IDestinationTaxonomyService` / `DESTINATION_TAXONOMY_SERVICE_TOKEN`). `ILocationService` /
`LOCATION_SERVICE_TOKEN` is the identical shape and an allowed cross-context symbol (`I*Service`),
so `scripts/check-cross-context-imports.mjs` is satisfied. **ADR-053's no-injection invariant is not
touched** — this adds no dependency to the `fulfillment` context; it consumes the
`fulfillment-authority` leaf's pure function, which is exactly what that leaf is for.

---

## 4. Design decisions (the ones that carry risk)

### D1 — The bootstrap is an explicit operator action, not a create-time side effect

The `enqueueInitialCatalogSync` / `enqueueInitialTaxonomySync` precedent is a **best-effort side
effect fired on create and on the transition into `active`**. Copying it here would be wrong, and
not by a little: if enabling the router silently minted a location, **the zero-location refusal
could never fire**, and AC-1 ("an enable attempt with zero locations is refused") would describe a
branch nothing reaches — the dead-guard shape `docs/lessons.md` records at "A guard ordered behind a
broader one is dead".

The issue's own wording agrees: *"refuses to enable until ≥1 `inventory_location` exists, with a
first-run wizard **offering** to mint locations"*. Offering is a choice presented to an operator.

So: **the guard refuses; the refusal names the remedy; the operator takes it; the enable then
succeeds.** The bootstrap is a `POST` the wizard calls, admin-gated like every other location write.

**Consequence for re-enable after a disable**: the question does not arise for the bootstrap, because
the bootstrap is not attached to any connection transition at all. It is attached to an operator
click. Disabling and re-enabling a connection mints nothing, deletes nothing, and re-runs nothing.
The *guard*, by contrast, does have transition semantics — see D2.

### D2 — The guard fires on the **off → on transition**, tested against persisted state

- **`create`**: any incoming claim of `sourcingAuthority` with zero locations is refused. There is no
  prior state, so every claim is a transition.
- **`update`**: refused **only** when the claim moves `false → true`. A connection that already
  carries the claim must not have an unrelated patch (a rename, a status flip) refused because the
  location table happens to be empty — that would make an unrelated field un-editable, and would
  punish the operator for a state the guard already let through.

The comparison reads `existing.config` (the **persisted** row) against the effective new config,
mirroring `enqueueInitialTaxonomySync`'s `existing.status !== 'active' && connection.status === 'active'`
— the docblock there states the rule explicitly: *"Tested against the PERSISTED status, not
`patch.status`: a patch omitting status must not read as a transition."* Same rule, same reason.

`ConnectionRepository.update` assigns `existing.config = patch.config` **wholesale** when the key is
present (`libs/core/src/identifier-mapping/infrastructure/persistence/repositories/connection.repository.ts:109-111`)
— it does not merge. So the effective new config is exactly `patch.config ?? existing.config`, and a
patch that omits `config` **cannot** change the A2 claim, which makes the guard a no-op on that path
by construction rather than by an ordering accident. This is worth stating because a *merging* update
would make the same comparison wrong: the claim could then arrive from the persisted half while the
patch looked innocent.

The guard runs **before** `connectionPort.update` / `.create` persists, alongside the existing
config validators, so a refusal leaves no row and no credential behind.

### D3 — It is a server-side refusal, not a form-side one

**Verified that no earlier validator swallows the key.** The plan cites the dead-guard lesson, so the
ordering was checked rather than assumed: every registered `ConnectionConfigShapeValidator` in the
tree (Allegro, PrestaShop, WooCommerce, InPost, DPD, Subiekt) runs `class-validator` with
`whitelist: false, forbidNonWhitelisted: false`, so an unknown `sourcingAuthority` key cannot be
rejected ahead of this guard, and the guard is reachable on every path.

`validateRateLimitConfig` and `validateStockAndPricingConfig` are enforced in the service precisely
because the browser is not the only way in: the connection page carries a **raw JSON config editor**
that bypasses the form's own resolver, and curl and MCP bypass the browser entirely (the #2610
rule). The guard sits in the same place, for the same reason. The FE panel is an affordance, never
the gate.

### D4 — A malformed config fails to match rather than throwing

This falls out of reusing `parseAuthorityConfig` rather than writing anything new:
non-object config, a non-object / non-`true` `sourcingAuthority`, an unrecognised shape — all return
the frozen `UNHELD` claim (`enabled: false`), so the guard **does not fire** and behaviour is
byte-identical to an install that never opted in. The coercer's own docblock states the direction and
its reason ("A malformed config that granted an authority would hand physical control to a party on
the strength of a typo"). We inherit it; we do not restate it. A spec pins the three malformed shapes
against *the guard*, not only against the coercer, so the composition is what is proven.

### D5 — What the bootstrap mints: one location, `MAIN`

The issue says "mint locations from the Wave-1b **sentinel pool**". **There is no sentinel pool.**
Every `sentinel` in `libs/core/src/inventory` is the unrelated ADR-058 step-(ii) `'legacy'`
*provenance* sentinel on `inventory_items.sourceConnectionId`; no seeded or default location exists
anywhere in the tree. The phrase is not implementable as written, and is recorded here rather than
silently reinterpreted.

**Chosen**: mint exactly one row — `code: 'MAIN'`, `name: 'Main warehouse'`, `kind: 'warehouse'`,
`status: 'active'`, every geo column left `null` for the operator to fill in. It is the minimum that
satisfies the precondition, it is a real operator-owned row (editable, renameable, deletable), and it
invents no topology the operator has not declared.

**Rejected — one location per distinct `inventory_items.sourceConnectionId`**: needs a new repository
read, mints rows the operator never asked for, and still attaches no stock (`locationId` stays
`NULL`), so it buys no routing correctness over the single row while guessing at a warehouse
topology from a provenance column. It is a plausible follow-up once positions can be assigned.

**And it is honest about what it does not do.** `inventory-location.entity.ts:17-19` states that
`locationId IS NULL` on a position permanently means "the master declines to locate its stock"
(ADR-058 decision 2) and that **"no row here is ever a stand-in for that NULL"**. The minted `MAIN`
row therefore locates no existing stock, and the readiness panel must not imply routing will now
succeed — only that the precondition is met. Position assignment is ADR-058 step (iii).

**Rejected — seeding in a migration**: ADR-055 rejects exactly this shape for the OMS connection row,
and the reasoning transfers — a migration-seeded row enters every existing install's state with
nobody having chosen it.

### D7 — The guard is enable-time; the invariant is *reported*, not enforced

`ILocationService` has two doors back to zero active locations that the enable-time guard does not
cover: `deleteLocation` refuses only when `countPositionsAtLocation > 0` (positions, not router
claims), and `updateLocation({ status: 'inactive' })` flips the sole location out of the count with no
guard at all. Two clicks after a successful enable, an install can sit in exactly the state AC-1
exists to prevent.

**Enforcing it at those two writes was considered and rejected.** It would require reading connection
config from inside `libs/core/src/inventory` — a genuinely new cross-context edge, added so that the
*inventory* context can police a *routing* rule, which is precisely the placement ADR-053 forbids
("resolution lives in the context that owns each write"). It would also make an ordinary catalogue
operation fail for a reason belonging to another subsystem.

So the invariant is **surfaced instead of enforced**. `countActiveLocations() === 0` while the
connection claims A2 is a first-class state of the readiness panel (Phase 4).

**The copy must say the routing pass does nothing, in those terms.** "No locations" reads to an
operator as a setup detail they can get to later; the state it actually describes is that fulfilment
routing is switched on and **inert** — every pass decides nothing and orders fall through to the
ordinary all-destinations behaviour. A reported state earns its keep only by being legible, so the
panel says so plainly ("Fulfilment routing is on, but it is doing nothing: no active location can
receive work, so every order falls through to the normal destinations") and offers the bootstrap
action. This is a deliberate, stated limit rather than an oversight: the
degenerate case is safe — `selectPrimaryFulfillmentRouter` yields no holder and the worker handler
falls through to today's untouched all-destinations behaviour — so the cost is a routing pass that
does nothing, which the panel now says out loud.

Closing it for real belongs with position assignment (ADR-058 step (iii), whose FK makes "a location
in use" answerable properly). Filed as a follow-up rather than smuggled in here.

### D6 — Idempotency is enforced by the unique code, not by a read-then-write

`createLocation` normalises `code` and throws `DuplicateLocationCodeError` against a case-sensitive
unique index. The bootstrap **attempts the create and swallows that specific error**, reporting the
code as already present instead of created.

**It reports codes, not entities, and that is forced by the contract.** There is no code-keyed read
anywhere in the inventory context — no `findByCode` on the service or the port — and the only
reachable substitute, `listLocations({ codePrefix })`, is documented as a **case-insensitive prefix**
match, so looking up `'MAIN'` would also match an operator's `MAIN-2` or `main-warehouse-eu` and
report the wrong row. Rather than add a port method for a value the caller does not need,
`LocationBootstrapResult` is `{ created: InventoryLocation[]; existingCodes: readonly string[] }`:
the caller's only question is whether anything was minted. A `count === 0` check followed by a create would be a
read-then-write race between two operators clicking at once; catching the constraint is the same
insert-then-recover shape `IdentifierMappingRepository.insertMapping` already uses. Re-running
creates nothing (AC-2), and two concurrent runs both succeed with one row.

---

## 5. Dependency on #2408 — resolved, with a finding

My brief warned not to author a `Connection.config.routing` coercer because **#2408 owns it**. Three
independent facts settle the boundary:

1. **#2408 depends on #2407**, not the reverse (its own "Dependencies" list names #2407). There is no
   `2408-*` branch on origin. So its coercer is downstream of this work and cannot be a prerequisite.
2. The key this guard reads is **`sourcingAuthority`** (authority assignment), not `routing` (filter
   /sort rules). Different key, different question, different owner. `parseAuthorityConfig` already
   exists and already reads it.
3. **This plan adds no coercer at all.**

**Finding to route to #2408's owner (not actionable here — also posted as a comment on #2408 and
repeated in this PR's description, so it does not live only in a plan document):** `parseAuthorityConfig`'s docblock records
that **ADR-054's storage amendment** puts routing rules in **`oms_routing_rules` plugin-owned rows**
and states *"never in a `Connection.config.routing` jsonb blob, and nothing here should be extended to
reach them."* #2408's title and body still specify a `Connection.config.routing` coercer. One of the
two is stale; #2408 should be reconciled against ADR-054 before it starts.

---

## 6. Implementation Plan

### Phase 1 — Core: the precondition read and the bootstrap

1. **Declare the bootstrap set**
   - **File**: `libs/core/src/inventory/domain/types/location-bootstrap.types.ts` *(new)*
   - Export `BOOTSTRAP_LOCATION_SPECS: readonly CreateInventoryLocationInput[]` (the single `MAIN`
     row) and `LocationBootstrapResult { created: InventoryLocation[]; existingCodes: readonly string[] }`
     (see **D6** for why codes, not entities).
     Data + types only — no functions, so the `*.types.ts` convention is respected without invoking
     the pure-rule exception.
   - **Acceptance**: file header present; no import beyond `location.types` / the entity.

2. **Extend the service contract**
   - **File**: `libs/core/src/inventory/application/services/location.service.interface.ts`
   - Add `countActiveLocations(): Promise<number>` and
     `bootstrapDefaultLocations(): Promise<LocationBootstrapResult>`, each with a docblock stating
     *why* (the precondition; the idempotency lever).
   - **Acceptance**: `LocationRepositoryPort` is unchanged.

3. **Implement both**
   - **File**: `libs/core/src/inventory/application/services/location.service.ts`
   - `countActiveLocations` → `listLocations({ status: 'active' }, { page: 1, limit: 1 })` and return
     `total`. Reuses the existing read; no new SQL, no new port method. **Docblock must state that the
     `status: 'active'` filter is load-bearing and is coupled to the status the bootstrap mints** — if
     a future spec minted `'inactive'`, the bootstrap could not satisfy its own guard.
   - `bootstrapDefaultLocations` → for each spec, `createLocation`, catching **only**
     `DuplicateLocationCodeError` and recording that spec's `code` into `existingCodes`.
   - **Acceptance**: unit spec covers (a) first run creates, (b) **second run creates nothing**,
     (c) a non-duplicate error propagates rather than being swallowed.

4. **Barrel**
   - **File**: `libs/core/src/inventory/index.ts` — export the new types.

### Phase 2 — The guard

4b. **Wire the module edge** *(missing prerequisite — without it the injection cannot resolve at boot)*
   - **File**: `apps/api/src/integrations/integrations.module.ts`
   - Add `InventoryModule as CoreInventoryModule` (from `@openlinker/core/inventory`) to `imports`.
     `LOCATION_SERVICE_TOKEN` is provided **and exported** by the core `InventoryModule`
     (`libs/core/src/inventory/inventory.module.ts:143,233`), and this module currently imports
     `CoreListingsModule` but not it.
   - **Cycle safety**: core `InventoryModule` imports the **core** `IntegrationsModule`, a different
     class from this api-layer `IntegrationsModule` — the identical shape the existing
     `CoreListingsModule` import already relies on, and whose reasoning that file's own comment
     (lines 22-24) records. Proven by boot, not by assertion: the Phase 3 int-spec boots the app.
   - **Acceptance**: app boots; no `Nest can't resolve dependencies` and no circular-dependency warning.

5. **`assertRouterEnablementPreconditions`**
   - **File**: `apps/api/src/integrations/application/services/connection.service.ts`
   - Inject `ILocationService` via `LOCATION_SERVICE_TOKEN` (the `IDestinationTaxonomyService`
     precedent, same file).
   - Private async method: takes `{ nextConfig, previousConfig }`; returns immediately unless
     `parseAuthorityConfig(nextConfig,'sourcing').enabled === true` **and**
     `parseAuthorityConfig(previousConfig,'sourcing').enabled === false`; then, if
     `countActiveLocations() === 0`, throws `BadRequestException` with copy naming the remedy.
   - **Copy** (one string, asserted by test): *"Fulfilment routing cannot be enabled until at least
     one active inventory location exists. Create one first — the connection's routing panel offers a
     default, or POST /inventory/locations."*
   - **Call sites, pinned exactly** (not "beside the validators", which is ambiguous):
     - `create` — inside the existing `if (rest.config !== undefined)` block, after
       `validateConfigShape`, and therefore **above** the credential-persistence block, whose own
       comment requires that a 400 from validation must not leave an orphan credential row.
     - `update` — inside the existing `if (patch.config !== undefined && metadata)` block, before
       `connectionPort.update`. Placing it inside that branch is correct **only because config is a
       full replace** (D2): a patch omitting `config` cannot move the claim. If
       `ConnectionRepository.update` ever merges config instead, this placement becomes a hole — which
       is why the reason is written here and not left to be re-derived.
   - **Acceptance**: the short-circuit ordering means a connection with no A2 claim performs **no**
     location read at all — an untouched install pays nothing.

6. **Specs (red first)**
   - **File**: `apps/api/src/integrations/application/services/connection.service.spec.ts`
   - `create` refuses with zero locations; succeeds with one.
   - `update` refuses on `false → true`; **does not** refuse when the claim was already `true`
     (the unrelated-patch case); does not refuse when the patch does not claim A2.
   - Three malformed configs (`'sourcingAuthority': 'yes'`, `[]`, `42`) do **not** refuse and do
     **not** throw.

6b. **Fix the three fixtures the guard legitimately invalidates** *(declared regression, not a quiet edit)*
   - **File**: `apps/api/test/integration/authority-status.int-spec.ts` (`:114`, `:133-135`, `:166-167`)
   - Each creates a `sourcingAuthority`-claiming connection via `POST /v1/connections` while
     `inventory_locations` is truncated (`setup.ts:99`), so each becomes a **400** under this change.
   - **Remedy: seed one location in those fixtures**, not weaken the guard. Those tests are about the
     *authority-status projection*, not about enablement; after this change the state they construct
     is one the product no longer permits, so the fixture — not the guard — is what is stale. The
     alternative (guarding `update` only) would leave `POST /v1/connections` as an unguarded bypass,
     which is the #2610 "the form is not the only way in" failure.
   - Called out here, in the PR body, and in the commit message, because three unrelated specs
     changing colour is exactly the kind of edit that should never be discovered in a diff.
   - **Acceptance**: those three specs assert the same projection facts as before, with one added
     setup line each.

### Phase 3 — HTTP

7. **Bootstrap route**
   - **File**: `apps/api/src/inventory/http/inventory-locations.controller.ts`
   - `POST /inventory/locations/bootstrap`, `@Roles('admin')` (matching the other three writes),
     `@ApiOperation` describing idempotency. New `location-bootstrap-response.dto.ts`.

7b. **Permission mirror**
   - Check `scripts/check-permission-mirror.mjs` for whether the new admin-gated route must be
     declared, and update it if so. Run `pnpm check:invariants` to confirm rather than reasoning about it.

8. **Int-spec**
   - **File**: `apps/api/test/integration/router-enablement-guard.int-spec.ts` *(new)*
   - Enable A2 with an empty location table → **400** (not 500), message asserted.
   - `POST .../bootstrap` → 201; **re-POST → creates nothing** (row count still 1).
   - Enable A2 again → succeeds.
   - **The two-enabled-routers case** (see §7).
   - Add every touched table to the harness `tablesToTruncate` list if absent.

### Phase 4 — Frontend

9. **`features/inventory-locations`** *(new slice)*
   - `api/inventory-locations.api.ts` + `.types.ts`, `hooks/use-locations-count-query.ts`,
     `hooks/use-bootstrap-locations-mutation.ts`, `index.ts` barrel.
   - Register the slug in the **single** `no-restricted-imports` slug group in `.eslintrc.js`
     (`:203-314` — there is one group, not two) for every canonical subdirectory, per
     `docs/frontend-architecture.md` § Feature Public Surface.

10. **`router-readiness-panel.tsx`**
    - **File**: `apps/web/src/features/connections/components/router-readiness-panel.tsx`
    - Three states, all explicit:
      1. **claim + zero active locations** — the D7 degraded state. Says routing is on and **doing
         nothing**, in those terms (see D7), and offers **"Create default location"**.
      2. **no claim + zero active locations** — the pre-enable precondition: enabling will be refused
         until a location exists; same action offered.
      3. **≥1 active location** — ready. Must **not** imply routing will now succeed: the minted row
         locates no existing stock (D5, `inventory-location.entity.ts:17-19`).
    - The action is gated by `useWriteAccess` per the access-control table. On success, invalidates
      the count query.
    - Mounted on the connection detail page's **Health** tab beside `ConnectionSyncStatusPanel` /
      `CatalogTrustPanel` — the Wave-2 authority surface's neighbourhood, and the tab that already
      answers "is this connection able to do its job".
    - **UI vocabulary**: the words *authority*, *posture* and *FulfillmentWork* must not appear
      (epic #2412's binding P9 rule). **Note the gate does not cover this code** —
      `check-ui-vocabulary.mjs` `SCAN_ROOTS:151-184` includes neither `features/connections` nor a new
      slice, so the rule is honoured by discipline and review here, not by CI. Stated rather than
      assumed, because "the gate would have caught it" is false for these files. **`SCAN_ROOTS` is
      deliberately NOT widened in this body** — a wider scanner would surface pre-existing violations
      across surfaces this change does not own and turn a scoped fix into an unbounded diff. The gap
      is filed as its own issue and cited in the PR body. The same script also
      bans *phase*, *Gateway* and *holder* — all easy to reach for in routing copy. Copy says
      "fulfilment routing" and "location".
    - Tests: zero-count renders the blocker + action; non-zero renders ready; the action is absent
      without write access.

### Phase 5 — Docs

11. `docs/architecture-overview.md` — one paragraph under **Inventory** recording the precondition,
    the transition semantics and D5's finding about the absent sentinel pool.
12. `docs/lessons.md` — an entry only if the work surfaces a genuine repeat-risk (candidate: *"an
    'offer to fix' bootstrap wired as an automatic side effect makes its own guard unreachable"*).

**No ADR.** This adds no cross-context edge, no port, no capability and no new pattern — it composes
two shipped seams (`parseAuthorityConfig`, `ILocationService`) at an existing validation site.
ADR-052/053/055 already own the decisions; per `engineering-standards.md` § ADRs this is a "routine
feature addition without architectural impact".

**No migration.** Nothing changes schema. The migration-timestamp collision hazard does not apply.

---

## 7. Red-first evidence — and what the two-router case can and cannot prove

**The two-enabled-routers property is already shipped and already tested, and re-testing it here
would be evidence of nothing.** `authority-status.int-spec.ts:164-185` already drives two claiming
connections end to end and asserts both `state === 'ambiguous'` and the derived
`attention.counted[0].reason === 'sourcing-ambiguous'`; `fulfillment-router-selection.spec.ts` covers
the selection unit; and `authority-attention-reason.types.spec.ts:384` pins derived-not-persisted with
a `@ts-expect-error`.

An earlier draft of this plan proposed asserting the two-router case by calling
`selectPrimaryFulfillmentRouter` inside a new int-spec. That is a **test that cannot distinguish the
defect from its absence**: the function is pure and total over an in-memory array
(`authority-resolution.types.ts:624`), so the assertion passes identically with this entire change
reverted. It has been removed rather than kept as reassurance.

What this change owes evidence for is therefore split in two:

**(a) The existing two-router coverage must still hold.** It is a *regression check*, and it is named
as one: the guard adds a precondition on the path those tests use, so they are run and must stay
green (with the Phase 6b fixture fix). Both sides of the property are already asserted there — two
claimants ⇒ `ambiguous`, one claimant ⇒ `resolved` (`:132` asserts exactly that control) — so the
"both sides" requirement is met by coverage that exists, not by coverage duplicated here.

**(b) The guard itself gets red-first evidence, against its own behaviour.** Each of these is written
and **observed failing for the right reason** before the implementation lands — a `TS6133`/compile red
with `Tests: 0 total` is a false pass and is not accepted as red:

1. `POST /v1/connections` claiming `sourcingAuthority`, zero locations ⇒ **400**, message asserted.
   *Red before*: 201.
2. The same request after `POST /inventory/locations/bootstrap` ⇒ **201**. This is the control that
   proves (1) was caused by the location count and not by the request being malformed.
3. `POST .../bootstrap` twice ⇒ row count is 1 both times, second response reports `existingCodes`.
   *Red before*: the route 404s.
4. `PATCH` a connection whose claim is **already** `true`, zero locations, changing only `name` ⇒
   **200**. Distinguishes the transition guard from a standing invariant (D7), and would fail against
   a naive implementation that checks the claim without comparing to persisted state.
5. Three malformed configs (`'yes'`, `[]`, `42`) ⇒ no refusal **and** no throw.

## 8. Risks & edge cases

| Risk | Handling |
|---|---|
| Guard makes an unrelated patch un-editable | D2 — fires only on `false → true`, against persisted state. |
| Guard adds a DB read to every connection write | Short-circuits on the claim **before** reading; no claim ⇒ no read. |
| Bootstrap races two operators | D6 — insert-then-recover on the unique code. |
| Bootstrap silently disables the guard | D1 — it is an explicit action, never a transition side effect. |
| Minted location has no stock ⇒ still unfulfillable | Out of scope and stated: `in-stock` is #2408's filter; position assignment is ADR-058 step (iii). The panel says the location needs stock assigned rather than implying routing will now succeed. |
| `check-ui-vocabulary` / mirror scripts fire | Copy avoids the three banned words; no capability, attention-reason or authority-kind list is edited, so those three mirrors are untouched. |
| Sibling conflicts (#2396/#2406/#2408/#2409) | Expected in `libs/oms`, `fulfillment.tokens.ts`, the context `index.ts` — **this plan touches none of them**. Contact points are `libs/core/src/inventory/index.ts` and `.eslintrc.js`. |

**Backward compatibility**: an install with no `sourcingAuthority` claim is byte-identical. An install
that somehow already carries the claim keeps it (the guard does not retroactively refuse).

---

## 9. Acceptance Criteria

- [ ] An enable attempt with zero locations is refused with an actionable message, **400 not 500** (AC-1).
- [ ] The guard is **enable-time only** — it does not claim, and is not tested as claiming, that an
      enabled router always has a location. Deleting/deactivating the last location afterwards is
      **reported by the readiness panel**, per D7. (Stated so the AC is not read as an invariant.)
- [ ] The bootstrap mints idempotently — re-run creates nothing (AC-2).
- [ ] The guard decides enablement from **config**, adding nothing to `CoreCapabilityValues`.
- [ ] A malformed config **fails to match** rather than throwing; an unset one is inert.
- [ ] `false → true` refuses; an unrelated patch on an already-claiming connection does not.
- [ ] Two enabled routers demonstrably disable routing, with the one-router control passing.
- [ ] `'sourcing-ambiguous'` is not persisted by this change.
- [ ] Tests added for all non-trivial logic (AC-3); no boundary violation (AC-4).
- [ ] `pnpm lint` 0 errors · `type-check` 0 · `test` green · `test:integration` (known: #2638 under
      local TZ, #2639, PS container contention) · `check:invariants` all green, count **derived from
      the run**, never quoted.

---

## 10. Alignment Checklist

- [x] Hexagonal layering respected (service contract in application, types in domain, route in interface)
- [x] CORE ↔ Integration boundary untouched; no adapter involved
- [x] Reuses shipped abstractions (`parseAuthorityConfig`, `listLocations`, `createLocation`); adds no port method
- [x] Idempotency designed in (D6), not asserted
- [x] Error handling: domain error caught specifically; HTTP 400 with actionable copy
- [x] Naming + file structure per `engineering-standards.md`
- [x] Testing strategy complete, including the red-first two-router control
- [x] Execution-ready

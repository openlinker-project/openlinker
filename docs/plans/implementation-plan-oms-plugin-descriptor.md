# Implementation Plan: `createOmsPlugin` descriptor + credential-less connection, created-on-enable

**Issue**: #2405 (`W3a-16`) · **Epic**: #2412 (Wave 3a, stream S2, size L)
**Base**: `origin/oms-programme-wave-3a` @ `c7ee984f1` · **Branch**: `2405-oms-plugin-descriptor`
**Date**: 2026-08-31
**Status**: Ready for Review
**Design of record**: ADR-055, ADR-062, `DESIGN-oms-authority-model.md` §9

---

## 1. Task Summary

**Objective**: give `@openlinker/oms` a real `AdapterPlugin` descriptor and a manifest, add the
`AdapterMetadata.requiresCredentials` field that relaxes the connection create-guard
**capability-wise**, and make a credential-less OMS connection creatable end-to-end (API + form)
— while proving that **no migration ever seeds one**.

**Context**: `getCapabilityAdapter(connectionId, capability)` is the codebase's only resolution
path, so the OL-OMS must be reachable through a real `Connection` row (ADR-055). It holds no
credentials because it crosses no network boundary. The row must be **created on enable, never
seeded**: a migration-seeded row enters every existing install's candidate sets and flips
previously-single-candidate authority selections to `ambiguous`, silently stopping working
behaviour on upgrade. ADR-055 calls that "the single highest-risk mechanical detail in this
design and the zero-config non-negotiable".

**Classification**: Integration (first-party product package) + Infrastructure + Interface + Frontend.

---

## 2. Scope & Non-Goals

### In scope

1. `AdapterMetadata.requiresCredentials?: boolean` (core) + its resolver.
2. `libs/oms`: `oms.constants.ts`, `oms.plugin.ts` (manifest + `createOmsPlugin`), `OmsPluginDeps`,
   barrel exports, `OmsModule` wired to the descriptor.
3. `ConnectionService.create` guard relaxed capability-wise; `credentialsRef` defaults to `''`.
4. `CreateConnectionDto` relaxed to match (verified empirically, see §5).
5. FE: `AdapterSummary.requiresCredentials`, a schema factory, and the create form keyed on it.
6. FE plugin contribution for `platformType: 'openlinker'` (the item #2390 deferred here).
7. **The AC-2 test against the real migration chain** + a harness-based test of the *guard*.
8. `architecture-overview.md` ADR-055/ADR-062 pointer lines under § Module Organization.

### Out of scope (with reasons)

- **Plugin-migration wiring** (`plugin-migrations.ts` + `scripts/plugin-migration-dirs.json`).
  #2390 deferred this item here **on the premise that #2405 would ship a table**. That premise
  has expired: #2408 stores routing on `Connection.config.routing`, #2409 reads core
  `fulfillment_works`, and no AC here mentions a migration. Registering a directory that does
  not exist is precisely the "declaration with nothing behind it" #2390 itself rejected. The
  first `libs/oms` migration registers both lists in its own PR.
- **Any capability**: the manifest ships `supportedCapabilities: []`. Precedent is exact — Erli
  (#980) shipped `[]` and #984/#993 added `OfferManager`/`OrderSource` *together with the
  adapters that deliver them*. `FulfillmentExecutor` arrives with #2409.
- **DI of the five factory deps** — see §5, decision D3.
- The guided first-run enable flow (#2407) and the router/executor (#2408/#2409).

---

## 3. Architecture Mapping

| Layer | Change |
|---|---|
| CORE (`libs/core/src/integrations`) | `AdapterMetadata.requiresCredentials` + `adapterRequiresCredentials()` resolver |
| Product package (`libs/oms`) | descriptor, manifest, constants, deps type, module |
| Interface (`apps/api`) | `ConnectionService.create` guard; `CreateConnectionDto`; `AdapterResponseDto` |
| Frontend (`apps/web`) | adapter type, schema factory, create form, plugin contribution |

**No new capability port, no new core context, no migration, no schema change.** The credential-less
row is expressible today: `credentialsRef` is `character varying NOT NULL`, and `''` is a legal value.

---

## 4. Verified findings (re-derived; three correct the handoff)

Everything below was checked against the tree at `c7ee984f1`, not assumed.

### F1 — the "exactly one credential" rule has TWO live enforcement points, not three

`CredentialsXorConstraint` (`apps/api/src/integrations/http/dto/create-connection.dto.ts:34-45`)
is attached via `@Validate(...)` to the **`credentials`** property, which also carries
`@IsOptional()`. class-validator skips *all* of a property's validators when its value is
`undefined`/`null` — so on a credential-less body **the XOR never executes**. The DTO's live
gate is `@Matches(/^db:/)` on `credentialsRef` (`:91-97`), which fires only when the field is
present. Net effect today:

| body | DTO | service |
|---|---|---|
| `credentialsRef: ''` | **400** (`@IsNotEmpty` + `@Matches`) | not reached |
| both fields omitted | **passes** | **400** at `connection.service.ts:333` |

So the omit-the-field path is gated only by the service. **This is verified by a red-first test,
not by reading decorators** (step 2.1).

### F2 — of the four claimed `null` breakages, three hold and one is misattributed

| claim | verdict |
|---|---|
| NOT NULL column | ✅ `credentialsRef character varying NOT NULL` (migration `1766246163229:17`); ORM `@Column() credentialsRef!: string` |
| unguarded `.startsWith('db:')` "on every list render" | ✅ real, but it is the **backend** `connection-response.dto.ts:113`, per row server-side — the FE never receives `credentialsRef` at all, only the derived `credentialsBacked: boolean`. **Plus a second unguarded site the list omitted: `connection.service.ts:664`** (`updateCredentials`) |
| the create guard | ⚠️ does **not** discriminate — `:333` tests `!credentialsRef`, and `''` and `null` are both falsy. What actually breaks is `:413`'s `credentialsRef: resolvedCredentialsRef!` non-null assertion writing `undefined` into the NOT NULL column |
| the FE wizard | ⚠️ real but a *different kind* — the create schema's cross-field XOR refine blocks a credential-less submit. A creation-path blocker, not a null-safety fault |

`''` is therefore correct, and for a sharper reason than "null breaks four things": **`''` is
falsy exactly where `null` is, and truthy-safe exactly where `null` throws.** Every resolution
site is already `if (credentialsRef)` (the Subiekt precedent,
`subiekt-adapter.factory.ts:44-52` — *"Never call credentialsResolver.get('')"*).

### F3 — `createNestAdapterModule` returns a `DynamicModule`, and TWO specs assert a class

`libs/plugin-sdk/src/create-nest-adapter-module.ts:99` returns `DynamicModule`. It registers the
manifest + factory and calls `plugin.register?.(host)` optional-chained, so a descriptor with no
`register` is fully supported. But:

- `libs/oms/src/index.spec.ts:14` — `expect(typeof OmsModule).toBe('function')`
- `apps/worker/test/integration/oms-module-boot.int-spec.ts:65-80` — the same assertion **plus**
  `expect(OmsModule.name).toBe('OmsModule')` **plus** `expect(workerPlugins).toContain(OmsModule)`

The int-spec is the one the handoff missed, and it is the more dangerous of the two: `apps/worker/test/**`
is excluded from `pnpm lint` and `pnpm type-check` (#786), so it fails **only at integration time**.

### F4 — Erli was converted *away* from the helper, and the reason applies here

`erli-plugin.ts:18-22`: *"Erli's module was converted from `createNestAdapterModule` to a custom
`@Module` class to inject this dep from the DI container."* The helper cannot supply
plugin-specific injected deps.

### F5 — injecting the five deps would breach ADR-051's role guarantee

`ShippingModule` and `MappingsModule` are **absent from the worker's shared spine** — they enter
only under the `jobs` role (`sync-worker.module.ts:85,88`). Nest imports are non-transitive, so an
`OmsIntegrationModule` that `@Inject`s all five tokens must import those modules itself, dragging
orders/shipping/mappings providers into `events`, `scheduler` and `maintenance` too. ADR-051's
whole point is that *"a role that is off contributes no providers"*.

### F6 — `pnpm check:invariants` = **35 distinct scripts** (61 invocations; 26 run twice for `--self-check`)

Four are OMS-aware and re-run against this change: `check-cross-context-imports`,
`check-outbound-http`, `check-jest-integration-mappers`, `check-no-injection-contracts`.

### F7 — `check-no-injection-contracts.mjs:121-123` already quotes this issue's contract

It exempts `libs/oms` from the no-injection prohibition by **quoting**
`createOmsPlugin({inventoryQuery, orderRecords, products, shipping, mappingConfig})` as the reason.

---

## 5. Decisions

### D1 — `requiresCredentials` is a manifest field with a resolver, defaulting to `true`

```ts
// libs/core/src/integrations/domain/types/adapter.types.ts
requiresCredentials?: boolean;

export function adapterRequiresCredentials(
  metadata: Pick<AdapterMetadata, 'requiresCredentials'> | undefined | null
): boolean {
  return metadata?.requiresCredentials ?? true;
}
```

Absent ⇒ `true` (every existing adapter is unchanged). The resolver mirrors the
`resolveVariantGroupingModel` precedent **in the same file** — a runtime function exported from a
`*.types.ts`, which `docs/engineering-standards.md` § *the pure-rule exception (#2231)* permits
because it is pure, it *is* the coercion rule for the field it sits beside, and both halves change
together. Existing callers read `variantGrouping` through exactly such a helper. Cited so a
reviewer does not read it as an unjustified deviation.

**Never a `platformType === 'openlinker'` check.** That would privilege one plugin by name and be
unavailable to a third-party OMS adapter — the design ADR-055 explicitly rejects.

**Known, accepted**: `GET /adapters` returns raw `AdapterMetadata[]`, so a new manifest field
becomes public API surface with no DTO edit. That is pre-existing for `variantGrouping` and
`defaultRateLimit`, so it is not a regression — but it is worth stating rather than treating the
freeness as a design property. The FE needs the field, so this is convenient here; a future field
that should *not* be public will need a real projection.

### D2 — the manifest advertises no capabilities

`supportedCapabilities: []`. Advertising `FulfillmentExecutor` (which #2403 put in
`CoreCapabilityValues`) with no dispatch entry would make `listCapabilityAdapters` treat a factory
error as fatal for the **whole listing** — architecture-overview § Advertised-without-dispatch is
explicit that this aborts the listing rather than skipping the connection. Erli #980 is the exact
precedent.

### D3 — `createOmsPlugin(deps?: OmsPluginDeps)` declares the seam and injects nothing

The signature mirrors `createErliPlugin(deps?: ErliPluginDeps)`. `OmsPluginDeps` is **declared**
with all five `I*Service` members; the parameter is optional and unread while the dispatch table
is empty.

*Why this is not the same as the deferred migration registration*: that would be a host-side
registration pointing at a directory that does not exist, whose premise expired. `OmsPluginDeps`
is the typed seam this issue exists to establish, it is what makes AC-5 ("`HostServices` is
unchanged") a *choice* rather than an omission, and a shipped invariant script (F7) already cites
it by name — declaring it makes that carve-out true rather than aspirational.

*Why nothing is injected now*: F5. #2408/#2409 make the Erli #1198 conversion when they have a
consumer and can weigh the ADR-051 role cost against a real need.

### D4 — `OmsModule` keeps its class identity via `.register()`

```ts
export class OmsModule {
  static register(): DynamicModule {
    return createNestAdapterModule({ plugin: createOmsPlugin() });
  }
}
```

The shipped `AiIntegrationModule.register()` shape. `PluginEntry = Type<unknown> | DynamicModule`
(`plugin-registry.types.ts:18`), so `plugins.ts` type-checks either way.

Consequences for F3's two specs:
- `index.spec.ts` — **stays green untouched** (`OmsModule` is still a class).
- `oms-module-boot.int-spec.ts` — `typeof`/`.name` stay green; `toContain(OmsModule)` must change,
  because the array now holds the produced `DynamicModule`. It is replaced with a **stronger**
  assertion: that after boot the adapter registry actually holds `openlinker.oms.v1`.
  `toContain` was only ever a proxy for "the wiring is exercised"; once a manifest exists, the
  registry read is the honest test of the same property.

A bare `export const OmsModule = createNestAdapterModule(...)` was rejected: it breaks three
assertions across two specs and discards a stable class name for nothing.

### D5 — FE keys on `requiresCredentials`, never on `platformType`

`.eslintrc.js:646-695` bans `no-restricted-syntax` `BinaryExpression` where one side is a
**member access** named `platformType` and the other is a **`Literal`**. Variable-to-variable
(`adapter.platformType === values.platformType`) is permitted and is what the lookup uses.
`create-connection.schema.ts` stays where it is — relocating it would need an `.eslintrc.js`
pattern edit for no benefit.

### D6 — `HostServices` is not widened, and the AC asks for a diff assertion

Five OMS-specific services fail the bag's stated *"every plausible future plugin needs this"* test
(`host-services.ts:25-28`), and its docblock at `:17-23` already names `IMappingConfigService` as
a port deliberately kept out and passed through a descriptor closure. The assertion is
`git diff --exit-code origin/oms-programme-wave-3a -- libs/plugin-sdk/src/host-services.ts`,
reported in the PR.

---

## 6. Implementation plan

### Phase 1 — core field

**1.1** `libs/core/src/integrations/domain/types/adapter.types.ts`: add `requiresCredentials?:
boolean` with a docblock stating it relaxes the create guard capability-wise and never by
platform name; add `adapterRequiresCredentials()` beside `resolveVariantGroupingModel`, citing the
#2231 exception.
*Acceptance*: unit spec — absent ⇒ `true`; `false` ⇒ `false`; `true` ⇒ `true`; `null`/`undefined`
metadata ⇒ `true`.

### Phase 2 — the AC-2 test, RED FIRST

**2.1 (red-first, blocking)** New `apps/api/test/integration/oms-connection-never-seeded.int-spec.ts`,
copied from `fulfillment-work-migration-parity.int-spec.ts` (#2392):

- second database on the same Testcontainers Postgres, `synchronize: false`, `migrationsRun: false`
- `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"` (the #2684 workaround that spec documents), then
  `await migrated.runMigrations()`
- assert `SELECT COUNT(*) FROM connections` is `0`
- assert the same for `identifier_mappings` scoped to `platformType = 'openlinker'`
- **non-vacuity**: first assert the migration chain actually built `connections`, so two empty
  result sets cannot pass by building nothing
- `beforeAll` budget 180 000 ms; teardown order `migrated.destroy()` → `DROP DATABASE` → harness

**Why the harness cannot serve this**: `libs/shared/src/database/database.module.ts` sets
`synchronize: NODE_ENV !== 'production'` and `migrationsRun: false`, and `docs/testing-guide.md`
§ Testcontainers Lifecycle says it outright — *"the schema is created by TypeORM `synchronize` …
No migration runs in this path."* A harness-based zero-rows assertion passes identically whether
a seeding migration exists or not, i.e. it is a check that cannot fail. `docs/lessons.md:288`
records the same root cause.

**Red-first proof (reported in the PR)**: add a temporary migration that inserts an
`openlinker` connection row, run the spec, observe it RED **and confirm the red is the assertion**
(`Expected: 0, Received: 1`, `Tests: 1 failed` — not a `TS6133` with `Tests: 0 total`), then
delete the temporary migration and observe green.

**2.2** Note in the PR that `fulfillment-work-migration-parity.int-spec.ts` — still *the only
automated check of a migration anywhere in this repository* — is now **load-bearing for a second
issue**, so the next person adding a migration finds the pattern rather than rediscovering why it
exists.

### Phase 3 — `libs/oms` descriptor

**3.1** `oms.constants.ts` — `OMS_ADAPTER_KEY = 'openlinker.oms.v1'`,
`OMS_PLATFORM_TYPE = 'openlinker'`, `OMS_BRAND = 'OpenLinker OMS'` (the brand feeds
`dispatchCapability`'s error message). Docblock warns that `'openlinker'` is *also* an unrelated
`AuthorityAnswerKind` discriminant meaning "OpenLinker decides this" — two different unions in two
contexts, neither gating the other, and they must not be unified.

**3.2** `oms.plugin.ts` — `omsAdapterManifest` (`supportedCapabilities: []`, `isDefault: true`,
`requiresCredentials: false`, no `defaultRateLimit` since the plugin issues no HTTP),
`OmsPluginDeps`, `createOmsPlugin(deps?)` returning `{ manifest, createCapabilityAdapter }` with
an empty `dispatchCapability` table. No `register()` — nothing to register yet, and a connection
test correctly answers *"not supported for adapter openlinker.oms.v1"*.
Imports are **top-level core barrels only** (the ESLint deep-import ban covers `libs/oms/**`).

**3.3** `index.ts` — export `createOmsPlugin`, `omsAdapterManifest`, `OmsPluginDeps`, the three
constants, alongside `OmsModule`.

**3.4** `oms.module.ts` — the D4 `.register()` shape; update the "empty by design" docblock.

**3.5** `apps/{api,worker}/src/plugins.ts` — `OmsModule.register()`; update both now-stale comments.

**3.6** `README.md` — replace the "Scaffold" status block.

*Acceptance*: unit specs for manifest identity (`createOmsPlugin().manifest` is the **same
reference** as `omsAdapterManifest`), `requiresCredentials === false`, empty capabilities,
`register` undefined, and a dispatch rejecting with `/does not support capability/` and `/OpenLinker OMS/`.

### Phase 4 — backend create path

**4.1** `ConnectionService.create` — resolve metadata (already resolved for validators), then:
- if `adapterRequiresCredentials(metadata)` ⇒ the existing XOR guard, unchanged
- else ⇒ **both** credentials supplied *and* neither supplied are legal; a credential-less create
  resolves `credentialsRef` to `''`
- `:413` — replace the `resolvedCredentialsRef!` non-null assertion with `?? ''`, so `undefined`
  can never reach the NOT NULL column (F2)

**4.2** `CreateConnectionDto` — allow an omitted pair. Shape driven by 2.1's empirical result, not
by decorator reading.

**4.3** **Pin `updateCredentials`.** The handoff correctly flagged that noting it as "unchanged and
correct" is a stated rule with no mechanism. Add an int-spec: `PUT /connections/:id/credentials`
against a credential-less OMS connection answers **400**, with the existing
*"does not have a db-backed credentials reference"* message — proving `''` takes the guarded
branch at `:664` rather than throwing.

**4.4** Int-spec of the guard itself (harness-based, correctly scoped — **separate** from 2.1):
create an OMS connection with no credentials ⇒ 201, `credentialsRef === ''` in the DB;
`GET /connections` renders it (exercising `connection-response.dto.ts:113`) with
`credentialsBacked: false`; creating a *credential-requiring* platform with no credentials still
⇒ 400.

### Phase 5 — frontend

**5.1** `adapters.types.ts` — `requiresCredentials?: boolean`.
**5.2** `create-connection.schema.ts` — `buildCreateConnectionSchema({ requiresCredentials })`;
the cross-field XOR refine applies only when `requiresCredentials !== false`. Keep the existing
`createConnectionSchema` export as the `true` case so no other consumer changes.
**5.3** `create-connection-form.tsx` — `useAdaptersQuery`, resolve the selected platform's adapter
by variable-to-variable `platformType` comparison (D5), pass `requiresCredentials` into the schema
factory, and hide the two credential fields when it is `false` with a one-line explanation.
**5.4** `apps/web/src/plugins/oms/index.ts` — a `definePlugin` contribution with
`platformType: 'openlinker'` and a `displayName`, appended to `plugins/index.ts`. Without it the
platform never appears in the dropdown and the form change is unreachable. This is the FE
contribution #2390 deferred here.
*Acceptance*: component tests for both branches; a schema unit test that `requiresCredentials:
false` accepts an empty submission and `true` still refuses it.

### Phase 6 — docs

**6.1** `docs/architecture-overview.md` § Module Organization — prose pointer lines for **ADR-055**
(credential-less connection-backed plugin, created-on-enable-never-seeded, `requiresCredentials`
capability-wise relaxation, `credentialsRef: ''`) and **ADR-062** (`HostServices` not widened;
first-party-only trust target in v1).
**6.2** `docs/lessons.md` — an entry for the check-that-cannot-fail class: *a zero-rows assertion
about migration effects is vacuous under a `synchronize`-built harness.*

---

## 7. Alternatives considered

| Alternative | Rejected because |
|---|---|
| `credentialsRef: null` | NOT NULL column; two unguarded `.startsWith` sites; needs a migration, a domain-type change and guard rewrites. `''` is falsy where `null` is and safe where `null` throws |
| `platformType === 'openlinker'` in the guard | privileges one plugin by name; unavailable to a third-party OMS; ADR-055 rejects it explicitly |
| `export const OmsModule = createNestAdapterModule(...)` | breaks 3 assertions across 2 specs, one of which escapes lint/type-check (#786); discards the class name for nothing |
| Inject the five deps now | drags orders/shipping/mappings into every worker role, breaching ADR-051's structural guarantee, to serve an empty dispatch table |
| Advertise `FulfillmentExecutor` now | `listCapabilityAdapters` treats a factory error as fatal for the whole listing; Erli #980 is the precedent for `[]` |
| Harness-based AC-2 assertion | cannot fail — the harness never runs migrations |
| Backend-only (no FE) | a row only `curl` can create is not a shipped feature; AC-4 says "render" |

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| The 180 s migration-chain spec is slow and could be flaky | Copies a shipped, green spec verbatim, including its `uuid-ossp` workaround and teardown order |
| A future migration seeds a connection row | That is exactly what 2.1 now catches — proven by making it fail |
| `check-jest-integration-mappers` / `check-no-injection-contracts` regressions | Both already cover `libs/oms`; `pnpm check:invariants` (35) runs them |
| Cold build order changes with a real `libs/oms` dependency graph | A cold `pnpm -r build` is an explicit gate |
| The FE adapters query adds a request to the create page | One cached TanStack query; the page already gates on plugin registry data |

---

## 9. Acceptance criteria (mapped to the issue)

- [ ] AC-1 — `architecture-overview.md` gains ADR-055 + ADR-062 pointer lines (6.1)
- [ ] AC-2 — **no migration seeds an OMS connection row**, asserted against the real migration
      chain, and **proven able to fail** (2.1)
- [ ] AC-3 — the create guard accepts an empty `credentialsRef` **only** when
      `requiresCredentials === false` (4.1, 4.4)
- [ ] AC-4 — connections list, wizard and health render the credential-less row with no null-guard
      sweep (4.4, 5.x)
- [ ] AC-5 — `HostServices` unchanged, by diff assertion (D6)
- [ ] AC-6 — tests for all non-trivial logic
- [ ] AC-7 — no CORE ↔ Integration boundary violation (barrel-only imports; `check:invariants`)

## 10. Gates

`pnpm lint` (0 errors) · `pnpm type-check` · `pnpm test` · `pnpm test:integration` ·
`pnpm check:invariants` (35) · cold `pnpm -r build`.
Known pre-existing, named and never chased: **#2638**, **#2639**.
Never run unit concurrently with integration. Node 22 on the hook's PATH.

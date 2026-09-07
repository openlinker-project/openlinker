# Implementation Plan: OMS routing rules — HTTP surface for authoring the router's ruleset

**Date**: 2026-09-07
**Status**: Ready for Review
**Issue**: [#2953](https://github.com/openlinker-project/openlinker/issues/2953)
**Estimated Effort**: ~1 day

---

## 1. Task Summary

**Objective**: give an operator a way to create, order, edit and delete the OL router's
`oms_routing_rules` ruleset without inserting rows into the database by hand.

**Context**: `OlFulfillmentRouter` reads its ordered ruleset through
`RoutingRuleSourcePort.listActiveRules(connectionId, now)`. The storage half is fully shipped
(`OmsRoutingRuleOrmEntity`, `OmsRoutingRuleRepository`, migration `1869000000200`, and the
`OmsModule` binding to `ROUTING_RULE_SOURCE_TOKEN`) but **there is no controller**. With the
router wired (#2408) and no ruleset, `listActiveRules` returns `[]`, the router treats that as
"not configured", every line resolves unfulfillable, and `RoutingCommitService.refusalFor`
refuses the plan with `plan-carries-unfulfillable`. Wave 3a's exit criterion (#2412) — "authors
an ordered filter/sort list" — is unreachable.

**Classification**: Interface (HTTP) + a narrow Infrastructure widening of the existing
`@openlinker/oms` repository.

---

## 2. Scope & Non-Goals

### In Scope

- CRUD for `oms_routing_rules`, scoped to an OMS connection, admin-gated.
- **Order expressed explicitly in the write surface** — `position` is a required field on create,
  plus a dedicated exhaustive reorder endpoint. Never left to insertion time.
- Reuse of the closed vocabularies **verbatim**: `RoutingFilterNameValues`, `RoutingSortNameValues`,
  `RoutingRuleKindValues`, `RoutingAfterActionValues`, `coerceRoutingRule` / `isRoutingRule`.
- Effective dating (`effectiveFrom` / `effectiveTo`) on create and patch, since the table already
  carries it and the read path already filters on it.

### Out of Scope

- The dry-run / explanation endpoint (#2954 — `FulfillmentRouterPort.evaluate()` has no caller).
- Any change to `evaluateRouting`, the rule vocabulary, or the router itself.
- A frontend authoring surface (separate follow-up).
- Wiring anything into `mappings`' `fulfillment-routing.controller.ts` — that surface answers
  "which processor or carrier DISPATCHES this?" (#832, ADR-012) and is deliberately separate.

### Constraints

- `libs/oms` is barrel-only (`ERR_PACKAGE_PATH_NOT_EXPORTED` on a deep path).
- The repository class stays package-private; consumers code against a `*Port` + Symbol token
  (`engineering-standards.md § Repository Ports Pattern`, and the existing `oms.module.ts` comment
  saying exactly this about `ROUTING_RULE_SOURCE_TOKEN`).
- `libs/oms` must acquire no HTTP client (two `check:invariants` guards + a dependency-graph spec).
- Every route declares its audience with exactly one of `@Public()` / `@Roles(...)` / `@AnyRole()`.

---

## 3. Architecture Mapping

**Target layers**: `libs/oms` (port + repository write methods) and `apps/api` (controller, DTOs,
app-layer composition service).

**Why the write methods live in `libs/oms`, not `apps/api`**: `OmsRoutingRuleOrmEntity` is
registered by `OmsModule.register()`'s `TypeOrmModule.forFeature` and is not exported from the
barrel. An api-side repository would need a second `forFeature` over an entity it cannot import —
and would give the table two writers with two mapping bodies.

**Why the connection validation lives in `apps/api`, not `libs/oms`**: validating that the target
connection exists and is an OMS connection needs `IConnectionService`. `libs/oms` reaching for a
host application service would invert the composition direction the plugin descriptor establishes
(core services are handed to `createOmsPlugin` as a factory closure). This is the shipped
`SalesDocumentCapabilityGuardService` shape (#2170) — the connection check happens at the API
layer, *before* delegating to the owning context's service.

**Existing services reused**: `IConnectionService.get` (404/`ConnectionNotFoundException`),
`ILocationService.getLocation` (priority-list validation), `coerceRoutingRule` (write-path
validation — see §6 step 4).

**New components**:

| Layer | File | Purpose |
|---|---|---|
| `libs/oms` port | `routing/routing-rule-admin.port.ts` | `RoutingRuleAdminPort` + `RoutingRuleRecord` + input types |
| `libs/oms` infra | `routing/oms-routing-rule.repository.ts` (extended) | implements the new port beside `RoutingRuleSourcePort` |
| `libs/oms` tokens | `oms.tokens.ts` (extended) | `ROUTING_RULE_ADMIN_TOKEN` |
| `apps/api` app svc | `oms/application/services/routing-rule-admin.service.ts` (+ `.interface.ts`) | connection + vocabulary + location validation, delegation |
| `apps/api` http | `oms/http/oms-routing-rules.controller.ts` | the 6 routes |
| `apps/api` http | `oms/http/dto/*.dto.ts` | request/response DTOs |
| `apps/api` module | `oms/oms-routing-api.module.ts` | composition; imports `IntegrationsModule` + core `InventoryModule` |

---

## 4. Domain Research

### The shipped storage contract (read before changing anything)

- `UQ_oms_routing_rules_live_name` — `UNIQUE (connectionId, kind, name) WHERE "effectiveTo" IS NULL`.
  The vocabulary is CLOSED, so `(kind, name)` **is** a rule's identity; the partial predicate is
  what lets a superseded row coexist with its replacement.
- `IDX_oms_routing_rules_connection_position` — `(connectionId, position)`.
- `position` carries no uniqueness. `coerceRoutingRules` sorts by `position` then breaks ties on
  `id`, so duplicate positions are legal and deterministic — but they are not what an operator
  means by "ordered", which is why the reorder endpoint assigns `1..N`.
- `coerceRoutingRule` **drops** a row it cannot understand. That is correct on the read path and
  wrong on an admin LIST: an operator must be able to see and delete a row this build cannot route
  on. See §6 step 2.

### Precedents followed

- `InventoryLocationsController` (#2316) — admin-gated CRUD shape, DTO/response split.
- `SalesDocumentRulesController` (#2170) — class-level `@Roles('admin')`, a connection guard at the
  API layer, `toHttpException` mapping of domain errors.
- `FulfillmentRouterBindingModule` (#2408) — how to reach an `OmsModule` export from an api module
  (import the HOST `IntegrationsModule`, never the bare `PluginRegistryModule`).

---

## 5. Questions & Assumptions

### Assumptions

1. **`DELETE` is a hard delete.** A routing rule is configuration, not a fiscal record; an operator
   who mistyped a rule wants it gone. A deliberate *retirement* that preserves history is available
   through `PATCH { effectiveTo }`, which is exactly what the partial unique index was built for.
   Both are offered and documented; neither is a hidden alias for the other.
2. **The reorder endpoint is EXHAUSTIVE.** It refuses a body that does not name every live rule for
   the connection. A partial reorder would silently leave un-named rules at stale positions while
   the operator believes they ordered the whole list.
3. **"Live" for the reorder and the default list means NOT RETIRED — `effectiveTo IS NULL OR
   effectiveTo > now`** — matching the upper bound `listActiveRules` itself applies, **not** the
   `effectiveTo IS NULL` predicate of the unique index. Those are different questions and
   conflating them is a real defect: a rule with `effectiveTo` set in the FUTURE is evaluated by
   the router right now, but under an `IS NULL` reorder set it would be silently unreorderable —
   the operator could not order a rule that is actively routing. "Superseded" therefore means
   `effectiveTo <= now` (genuinely retired), and those rows keep their positions and are reachable
   via `?includeSuperseded=true`.

   The narrower `effectiveTo IS NULL` predicate stays where it belongs — the duplicate-detection
   index — and is never reused as the reorder or list scope.
4. **`GET`/list is admin too.** The issue says "admin-gated"; this is a configuration-authoring
   surface end to end, and `SalesDocumentRulesController` is class-level `@Roles('admin')` for the
   same reason.

### Open questions (recorded, not blocking)

- Should `priorityLocationIds` be re-validated when a location is later deleted? Out of scope —
  `LocationService.deleteLocation` refuses while positions reference it, and a rule reference is a
  different relation. Recorded as a limitation.

---

## 6. Implementation Plan

### Phase 1 — `libs/oms`: the admin port and its implementation

**1. `libs/oms/src/routing/routing-rule-admin.port.ts`** (new)

```ts
export interface RoutingRuleRecord {
  readonly id: string;
  readonly connectionId: string;
  readonly position: number;
  readonly kind: string;          // persisted verbatim
  readonly name: string;          // persisted verbatim
  readonly afterAction: string;   // persisted verbatim
  readonly priorityLocationIds: readonly string[];
  readonly effectiveFrom: Date | null;
  readonly effectiveTo: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Whether THIS build can route on the row (`coerceRoutingRule` narrowed it). */
  readonly recognised: boolean;
}
```

- **Acceptance**: the three vocabulary fields are `string`, not the narrowed unions, and
  `recognised` reports the coercion. The read path drops an unrecognised row; the admin surface
  must SHOW it, or an operator cannot delete the row that is silently not routing.

Port methods: `listRules`, `getRule`, `createRule`, `updateRule`, `deleteRule`, `reorderRules`.
Named `*AdminPort`, never `*RepositoryPort` — the latter is a deny-shape for cross-package imports
(`check-cross-context-imports.mjs`) and an intra-context contract by convention.

**2. `libs/oms/src/routing/oms-routing-rule.repository.ts`** (extended)

- `implements RoutingRuleSourcePort, RoutingRuleAdminPort`.
- One private `toRecord(row)` mapper that runs `coerceRoutingRule` purely to set `recognised`.
- `listRules(connectionId, {includeSuperseded, now})` — ordered `position ASC, id ASC` (the
  coercer's own tie-break, so the list order IS the evaluation order for the live set). Default
  scope is NOT-RETIRED (`effectiveTo IS NULL OR effectiveTo > now`) per assumption 3.
- `reorderRules(connectionId, orderedIds, now)` — one `manager.transaction`: re-read the
  not-retired set inside the transaction, refuse on any set mismatch, then assign `1..N`. Refusing
  inside the transaction is what makes the exhaustiveness check race-free against a concurrent
  delete or a concurrent `effectiveTo` patch.
- **Every by-id method predicates on `connectionId` AND `ruleId`.** A rule belonging to another
  connection answers `RoutingRuleNotFoundError` → **404, never 403**: a 403 confirms that the
  guessed id names a real rule on some other connection, which is information the caller did not
  have. (Both routes are `@Roles('admin')`, so this is defence in depth rather than the only line —
  but the response body must not leak existence either way.)
- `createRule` / `updateRule` translate the `23505` unique violation into a domain
  `DuplicateLiveRoutingRuleError`, matching on SQLSTATE **and** constraint name
  (`UQ_oms_routing_rules_live_name`) — the #2392 rule; this table carries a PK too, and catching
  every `23505` would report a PK collision as a duplicate live rule.
- **Acceptance**: `pnpm --filter @openlinker/oms test` green; a repository unit spec covers the
  `recognised: false` mapping.

**3. `libs/oms/src/oms.tokens.ts` + `index.ts`**

- Add `ROUTING_RULE_ADMIN_TOKEN`; the barrel already does `export * from './oms.tokens'`.
- Export the port type, `RoutingRuleRecord`, the input types and the domain errors from the barrel.
  The repository CLASS and the ORM entity stay unexported.
- **Acceptance**: `pnpm check:invariants` green (no deep-path import introduced).

**4. `libs/oms/src/oms.module.ts`**

- Bind `{ provide: ROUTING_RULE_ADMIN_TOKEN, useExisting: OmsRoutingRuleRepository }` and export it,
  beside the existing source-port binding. No new imports — `OmsModule` stays narrow.

### Phase 2 — `apps/api`: validation and the HTTP surface

**5. `RoutingRuleAdminService`** (`apps/api/src/oms/application/services/`)

Owns four validations, in this order:

1. **Connection exists** — `IConnectionService.get` (throws `ConnectionNotFoundException` → 404).
2. **Connection is an OMS connection** — `platformType === OMS_PLATFORM_TYPE`, else 400. Authoring a
   rule against a non-OMS connection persists rows nothing ever reads: the router resolver
   discriminates on `platformType`, so the rules would be silently inert. This mirrors #2407's rule
   that a configuration which would decide nothing is refused with a named remedy rather than
   accepted.
3. **The rule is one this build can route on** — build the candidate row and run
   `coerceRoutingRule` on it; `null` ⇒ 400. This is the load-bearing choice: `@IsIn([...filters,
   ...sorts])` alone would accept `{kind:'filter', name:'nearest'}`, which the coercer rejects, so
   the row would persist and never route. Round-tripping through the SAME function the read path
   narrows with makes "authorable" and "routable" impossible to diverge. `priorityLocationIds` is
   refused on a non-`priority` rule for the same reason — it would persist a value nothing reads.
4. **Every `priorityLocationIds` entry names a real location** — `ILocationService.getLocation`,
   else 400 naming the unknown ids. A `priority` sort listing a phantom location ranks nothing for
   that entry, silently.

**Two consequences of validating the MERGED candidate, both operator-facing and both stated in the
endpoint descriptions.** A `PATCH` is validated as `{...existingRow, ...patch}`, so (a) an
**unrecognised row cannot be patched at all** — even a `position`-only patch is refused 400,
because the merged candidate still fails coercion — and its remedy is `DELETE`; and (b) patching
`name` on a recognised row to a member of the wrong kind's vocabulary is refused rather than
persisted. (a) is fail-closed and correct — a row this build cannot route on must not be silently
repositioned as though it were routing — but it is a genuine constraint rather than an oversight.

**`position` semantics differ by route, deliberately**: create takes an operator-chosen value
(duplicates are legal and tie-broken by `id`, matching `coerceRoutingRules`), while `PUT /order`
assigns a dense `1..N`. Reorder is the authority; create's value is a placement hint.

Both refusals that an operator can act on — a non-OMS connection and a reorder set mismatch — are
`warn`-logged through the shared `Logger` from `@openlinker/shared/logging`.

**6. DTOs** (`apps/api/src/oms/http/dto/`)

**Every class is named `*SourcingRule*`, never `*RoutingRule*`** (pre-implement Critical 2).
`apps/api/src/mappings/http/dto/routing-rule-response.dto.ts` already exports
`RoutingRuleResponseDto`, and `@nestjs/swagger` registers schema definitions under the **class
name** — a second class of that name silently overwrites the first in the generated OpenAPI
document, publishing a contract that describes one surface with the other's fields. No compiler,
lint rule or test in this repo detects it.

- `CreateSourcingRuleDto` — `position` **required** (`@IsInt() @Min(0)`), `kind` `@IsIn(RoutingRuleKindValues)`,
  `name` `@IsIn([...RoutingFilterNameValues, ...RoutingSortNameValues])`, `afterAction`
  `@IsIn(RoutingAfterActionValues)`, optional `priorityLocationIds`, optional ISO effective dates.
  Every `@IsIn` reads the exported `as const` tuple — no member is re-spelled.
- `UpdateSourcingRuleDto` — every field optional; `kind` is **absent** (a rule's kind is half its
  identity under the unique index, so changing it is delete-and-recreate, not a patch).
- `ReorderSourcingRulesDto` — `ruleIds: string[]`, `@ArrayNotEmpty()`, `@IsUUID('4', {each: true})`.
- `SourcingRuleResponseDto` with a static `fromDomain`.
- `ListSourcingRulesQueryDto` — `includeSuperseded?: boolean` (`@Type(() => Boolean)`-style query
  coercion, since every query value arrives as a string).

**7. `OmsRoutingRulesController`** (`apps/api/src/oms/http/`)

Class-level `@Roles('admin')` + `@ApiBearerAuth()` + `@ApiTags('oms')`, mounted at
**`connections/:connectionId/sourcing-rules`** (the nested-prefix shape `CatalogTrustController`
uses — the bare `connections` prefix is owned by the integrations module).

**The prefix is `sourcing-rules`, NOT `routing-rules`, and that is load-bearing** (pre-implement
Critical 1). `apps/api/src/mappings/http/fulfillment-routing.controller.ts:40` already mounts
`@Controller('connections/:connectionId/routing-rules')` with `GET /`, `GET /candidates` and
`PUT /` — the ADR-012 *dispatch* surface (#836/#832), backed by
`FULFILLMENT_ROUTING_SERVICE_TOKEN` from `@openlinker/core/mappings`. Reusing that prefix would
declare `GET /connections/:id/routing-rules` twice; NestJS registers both and the
first-registered wins **silently**, so depending on module order either the dispatch rules or the
OMS sourcing rules become unreachable — with no boot error, and invisible to
`route-authorization-coverage.spec.ts`, which checks decorators rather than path uniqueness.
`sourcing-rules` names the question this surface answers ("which location and holder SOURCES
it?") and cannot be misread as a versioned successor to the other path. Each controller's docblock
points at the other, since the two now sit adjacent in the published document.

| Route | Purpose |
|---|---|
| `GET /` | list (`?includeSuperseded=true` for history) |
| `POST /` | create (explicit `position`) |
| `GET /:ruleId` | read one |
| `PATCH /:ruleId` | edit |
| `DELETE /:ruleId` | hard delete (204) |
| `PUT /order` | exhaustive reorder → the reordered list |

A private `toHttpException` maps the domain errors (the `SalesDocumentRulesController` shape):
`RoutingRuleNotFoundError` → 404, `DuplicateLiveRoutingRuleError` → 409,
`RoutingRuleReorderMismatchError` → 409 naming the missing/extra ids, `InvalidRoutingRuleError` /
`ConnectionNotRoutableError` / `UnknownPriorityLocationError` → 400.

**These error classes live in `libs/oms` and their names must stay distinct from
`@openlinker/core/mappings`**, which already exports `DuplicateRoutingRuleException`
(`fulfillment-routing.controller.ts:31`). Two same-named classes fail `instanceof` against each
other silently, and the filter then answers 500 for a refusal the service raised deliberately —
the #2332/#2333 precedent recorded in `architecture-overview.md § Returns`.

**8. `OmsRoutingApiModule`** — imports the host `IntegrationsModule` (which re-exports
`PluginRegistryModule`, and thus `OmsModule`'s exports) plus core `InventoryModule` for
`LOCATION_SERVICE_TOKEN`. Registered in `AppModule`.

- **Acceptance**: importing the host wrapper rather than the bare `PluginRegistryModule` (a
  `@Module({})` shell whose static `forRoot` is the only thing that composes plugins) — the trap
  `docs/lessons.md` records at the top of the file.

### Phase 3 — Tests

- **Unit**: repository mapping + reorder mismatch; service validation matrix (non-OMS connection,
  kind/name mismatch, `priorityLocationIds` on a filter rule, unknown location id); controller
  error mapping.
- **Integration** (`apps/api/test/integration/oms-routing-rules-api.int-spec.ts`): create → list →
  reorder → patch → delete against real Postgres; the duplicate-live-name 409; that a reorder
  naming a subset is refused and writes nothing; that the reordered positions are what
  `listActiveRules` then returns in order — i.e. the authored order really is the evaluation order;
  that a rule with a FUTURE `effectiveTo` **is** included in the reorder set (the assumption-3
  regression — an `effectiveTo IS NULL` implementation passes every other test in this list and
  fails only this one); and that a by-id read for a rule owned by another connection answers 404.
- **Route authorization**: `route-authorization-coverage.spec.ts` discovers controllers, so the new
  one is covered automatically once every route carries `@Roles`.

---

## 7. Alternatives Considered

**A. Put the write repository in `apps/api`.** Rejected: the ORM entity is not exported from the
`libs/oms` barrel and is registered by `OmsModule`'s own `forFeature`; a second writer would need a
second `forFeature` and a second mapping body over one table.

**B. Validate the vocabulary with DTO decorators only.** Rejected: a flat `@IsIn` over the union of
filter and sort names cannot express the kind↔name pairing, so `{kind:'filter', name:'nearest'}`
would save and never route — the "saves and never fires" defect class the repo's docs name
repeatedly. Round-tripping through `coerceRoutingRule` makes the two agree structurally.

**C. Derive `position` from insertion order.** Rejected by the issue itself: "ordering is part of
the contract, so the write surface has to express order explicitly rather than leaving it to
insertion time."

**D. Allow a partial reorder.** Rejected: it silently leaves un-named rules at stale positions.

**E. Make `DELETE` a soft retirement (`effectiveTo = now`).** Rejected as the *only* removal: an
operator who mistyped a rule cannot then re-create it under the same `(kind, name)` — that works
(the index is partial) but leaves a permanent misleading row. Both are offered, distinctly.

---

## 8. Validation & Risks

- ✅ Hexagonal: the API layer depends on a `*Port` + Symbol token; the repository class stays private.
- ✅ No new cross-context edge — `libs/oms` gains no import; `apps/api` composes.
- ✅ No schema change, therefore **no migration** (the table, both indexes and the entity ship already).
- ✅ Naming: `*.port.ts` / `*.service.ts` + `*.service.interface.ts` / `*.dto.ts` / `*.controller.ts`.

**Risks**

| Risk | Mitigation |
|---|---|
| Reorder races a concurrent delete | The exhaustiveness check runs INSIDE the transaction, over a re-read set. |
| Duplicate-live-name 409 masks a PK collision | Match SQLSTATE **and** constraint name (#2392 rule). |
| An operator authors rules on a non-OMS connection | Refused at the service with a named remedy. |
| A referenced location is deleted later | Not closed; recorded as a limitation (the rule then ranks nothing for that entry). |

**Backward compatibility**: additive throughout. `listActiveRules` and the router are untouched; an
install that authors no rules behaves exactly as it does today.

---

## 9. Acceptance Criteria

- [ ] An operator can create, read, update, delete and **reorder** routing rules for an OMS
      connection over HTTP, admin-gated.
- [ ] `position` is explicit on create and a dedicated exhaustive reorder endpoint exists.
- [ ] Every closed vocabulary is reused verbatim from `@openlinker/oms`; none is restated.
- [ ] A rule that `coerceRoutingRule` would reject cannot be persisted.
- [ ] A rule authored through the API is returned by `listActiveRules` in the authored order
      (asserted by an int-spec).
- [ ] `pnpm lint`, `pnpm type-check`, `pnpm check:invariants`, `pnpm test` all green.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs plugin boundaries (no `libs/oms` → host import)
- [x] Uses existing patterns (`SalesDocumentRulesController`, `InventoryLocationsController`)
- [x] Idempotency considered (reorder is idempotent; create is guarded by the unique index)
- [x] Error handling comprehensive (domain errors → mapped statuses)
- [x] Testing strategy complete (unit + integration + route-authorization coverage)
- [x] Naming conventions followed
- [x] Plan is execution-ready

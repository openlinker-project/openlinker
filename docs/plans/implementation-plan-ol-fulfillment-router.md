# Implementation Plan: OL fulfilment router — closed named filters/sorts + rule coercer

**Date**: 2026-08-31
**Status**: Implemented — the two plan-stage findings are adjudicated (§5); the two code-review
BLOCKING findings are recorded and resolved in §5b
**Issue**: #2408 (`W3a-17`, Wave 3a epic #2412, stream S2, size L)
**Estimated Effort**: 2–3 days

---

## 1. Task Summary

**Objective**: Ship the first real implementer of `FulfillmentRouterPort` — OpenLinker's own
router, living in `@openlinker/oms`, driven by a **closed, named** vocabulary of filters and
sorts, plus the coercer that narrows the untrusted persisted rule rows into that vocabulary.

**Context**: `FulfillmentRouterPort` (#2393), the `routing_decisions` intent row (#2394) and the
selection/commit gate (#2395) are merged, but `FulfillmentWorkRouteHandler.resolveRouter()` is
hardcoded to `return null` — nothing can route. This issue supplies the argument #2395 takes.

**Classification**: Integration (plugin-owned), Application layer, with one small CORE read
addition (§6 Phase 0) and one plugin-owned migration.

---

## 2. Scope & Non-Goals

### In scope
- Closed `RoutingFilterName` / `RoutingSortName` / `RoutingAfterAction` vocabularies.
- The pure coercer narrowing persisted rule rows into that vocabulary (never throws).
- `oms_routing_rules` table + plugin-owned migration + repository.
- One pure evaluation pipeline shared by `evaluate()` and `route()`.
- `OlFulfillmentRouter implements FulfillmentRouterPort`, exported as a factory.
- Passing `runFulfillmentRouterContract` (#2404, 9 cases).

### Out of scope (with owners)
- **FE rule composer.** No Wave-3a child funds it (#2410/#2411 are the worklist and the
  order-detail panel). Filed as a follow-up. Until it exists rules are authored by SQL/seed.
- **Wiring `resolveRouter()`** — router *reachability* is #2407 (enablement guard). This issue
  exports the factory; #2407 decides when it is reachable. Boundary confirmed with orchestrator.
- **Holds / unfulfillable plans** — #2395's `refusalFor` refuses both unconditionally (#2730).
  This router never emits them; §8 records why that is honest rather than a workaround.
- **`pending` routing plans** — refused by `assertRoutingPlanResolved`; consuming it is W4-3.

### Constraints
- `RoutingInput` is an allowlist; it carries no PII beyond the `shipTo` arms. Do not widen.
- `FulfillmentRouter` must NOT enter `CoreCapabilityValues`, any manifest, or the plugin's
  `dispatchCapability` table (#2403 + the shipped port docblock). Hence a **factory export**.
- `libs/oms` may not make outbound HTTP (`check-outbound-http.mjs` scans it).

---

## 3. Architecture Mapping

**Target layer**: `libs/oms/src/routing/**` (plugin). Core is touched only to add one read.

**Storage — rows, not `Connection.config.routing`.** ADR-054's **adopted** amendment
(2026-08-23, #2298) and DESIGN §5.3's matching DECISION supersede the `Connection.config.routing`
sentence that #2408's title still repeats. This is not merely a doc position: the merged
`libs/core/src/fulfillment-authority/domain/types/authority-config.types.ts` already states the
prohibition in code — routing rules "live as `oms_routing_rules` rows owned by the OMS plugin,
**never in a `Connection.config.routing` jsonb blob**". The epic records the demand gate as
**FIRED**, so the amendment binds. The coercer survives the move: it narrows an untrusted
persisted column instead of a config blob, exactly as `isSalesDocumentCondition` does.

**Naming hazard.** `libs/core/src/mappings` already ships `fulfillment_routing_rules`
(ADR-012 *dispatch resolution* — "which processor ships this?"). Ours is *sourcing* — "which
location sources this?". The shipped `fulfillment-router.port.ts` docblock forbids wiring or
renaming either. The `oms_` prefix keeps them apart; no code path may join them.

**Reused**: `IInventoryQueryService` (per-location stock), `ILocationService` (candidate
locations), `IFulfillmentWorkQueryService` (blocking rejections, after Phase 0).

---

## 4. The closed vocabulary — and what each member can actually select

A member earns its place only if a **fact source exists** to make it select. Verified against the
merged tree:

| Member | Kind | Fact source | Status |
|---|---|---|---|
| `in-stock` | filter | `listInventoryItems({locationId, productVariantId})` | ✅ implementable |
| `country-served` | filter | `InventoryLocation.countryIso2` vs `shipTo.countryIso2` | ✅ implementable, both `shipTo` arms |
| `not-blocked-by-reject` | filter | rejection model shipped; needs one read (Phase 0) | ⚠️ needs a small CORE addition |
| `method-capable` | filter | **none — no per-location delivery-method model exists anywhere** | ❌ NOT DECLARED — owned by #2736 |
| `priority` | sort | operator-authored ordered location list in the rule's `config` | ✅ |
| `most-complete` | sort | derived from the `in-stock` facts | ✅ |
| `least-splits` | sort | plan-level: prefer a single location covering every line | ✅ |
| `nearest` | sort | postcode-proximity **proxy**, not geodesic — see below | ⚠️ honest but narrower than the name |

**`country-served` semantics, stated precisely**: a location serves the country it sits in — and **the filter's own
documentation and config surface must say so**, never implying the stronger serve-list claim.
`InventoryLocation.countryIso2` is where the location *is*, not a list of countries it *serves*;
no serve-list column exists. Epic #2412's entry criteria assert this column is what makes
`country-served` implementable, so this reading is the intended one — but it is recorded here
because the two are not the same claim.

**`nearest` semantics**: `RoutingShipTo` carries no coordinates on either arm, and OL cannot
geocode a postcode. True distance is therefore uncomputable today even though
`InventoryLocation` has `latitude`/`longitude`. `nearest` orders by a documented proximity
proxy — exact postcode match, then shared postcode-prefix length, then same country. On the
**hashed** arm there is no postcode at all, so it degrades to the country term only. That
degradation MUST be **visible in the emitted `RoutingExplanationStep.detail`**, not merely true:
a ranking that quietly stops ranking is unfalsifiable from the outside, and that visibility is the
only reason a proxy is allowed to ship under the name `nearest`.

---

## 5. Adjudicated findings (both resolved 2026-08-31)

**B1 — `method-capable` is NOT declared. RULED: dropped; follow-up #2736 owns it.** There is no per-location delivery-method model in the
merged tree: `InventoryLocation` has no methods column, `InventoryFilters` has no method axis, and
`mappings`' `FulfillmentRoutingQuery` answers the *dispatch* question the port docblock forbids
wiring in. Declaring `method-capable` would ship a filter that can never eliminate a candidate —
precisely the dishonest declaration the wave's rules forbid. The asymmetry is the point: a *prohibition* is honest with no subject, a *declaration* is not.
An operator authoring a `method-capable` rule would believe they had constrained routing by
delivery method and would be wrong, silently, with no error anywhere. Building the model here is
unfunded scope for a Wave-3a child. **#2736** owns it and records its open questions
(per-location vs per-`(location, carrier)`, core vs plugin-local, and what "unset" means).

**B2 — `not-blocked-by-reject` needs one CORE read.** `IFulfillmentWorkQueryService` exposes only
`resolveLinkForOrder`. The rejection model itself is shipped
(`fulfillment-work-rejection.types.ts`, blocking concept included), so this is one additive method
on an existing `I*Service` the plugin already consumes — no new context edge, no ADR-053 breach.
**RULED: approved**, under two conditions. (1) It stays a **read**, named as one, returning only
what `not-blocked-by-reject` needs — it must not widen into a general work query that a later
caller mistakes for the worklist read model, which **#2406** owns and is live. (2) This filter is
the rejection model's first consumer, so the spec must **prove it can eliminate**: red-first, and
failing when the filter is removed. A rejection filter that silently never matches is B1's defect
class, just further from the surface.

## 5b. Code-review findings (both resolved)

**B3 — the `afterAction` ladder was one rung, not three.** `line-split` was declared in the closed
vocabulary and read by nothing: the pipeline derived a single boolean
(`allowQuantitySplit = !rules.some(r => r.afterAction === 'no-split')`), so `line-split` and
`quantity-split` were the same computation and `line-split` was a declared-but-inert vocabulary
member — B1's defect class, inside the very file whose docblock argues against it. The same
boolean also made `no-split` too weak: it forbade splitting a *line's quantity* while still
placing line A at one location and line B at another, which is exactly the two-pick, two-parcel
outcome an operator authoring `no-split` is asking not to happen. Resolved by making the three
rungs a real ladder (`mostRestrictiveAfterAction`, most restrictive wins, empty answers
`quantity-split` so an unconfigured install is unchanged) and branching the assignment on it. Five
of the eight new specs fail against the previous semantics; the other three guard behaviour the two
builds share.

**B4 — the new CORE read had no spec of its own.** §5's B2 approval was conditional on proving the
`not-blocked-by-reject` filter can eliminate, "red-first, and failing when the filter is removed".
The router spec proves the *filter*, but it feeds it a fake blocked-connection set — so
`FulfillmentWorkQueryService.listBlockingRejectionConnectionIds`, the only thing that turns
rejection ROWS into those ids, could have returned `[]` for every order with the whole tree still
green. Resolved with a direct unit spec covering the union across several works, de-duplication of
a repeated rejecter, the no-work short-circuit and the no-blocking-rejection case.

---

## 6. Implementation plan

### Phase 0 — CORE read seam (only if B2 approved)
1. Add `listBlockingRejectionsForOrder(orderId)` to `IFulfillmentWorkQueryService` + its service,
   returning the location/connection ids whose rejection was `blocking`.
   *Acceptance*: unit spec; no new cross-context import; `check-no-injection-contracts` green.

### Phase 1 — vocabulary + coercer (`libs/oms/src/routing/`)
2. `routing-vocabulary.types.ts` — `as const` value arrays + derived unions for filter names,
   sort names and `afterAction`.
3. `routing-rule.types.ts` — `RoutingRule` shape + `coerceRoutingRules(value: unknown)` and
   `isRoutingRule`. Invokes the **pure-rule exception** (`engineering-standards.md` §"The
   pure-rule exception to 'types only' (#2231)"): pure, IS the rule for the type it sits with,
   and both halves change together. A malformed rule **fails to match** — it is dropped, never
   thrown on — and a wholly malformed collection yields `[]`, which the router reports as
   "no rules configured" rather than routing on a guess.
   *Acceptance*: spec covering null/undefined/non-array/unknown name/wrong types/duplicate.

### Phase 2 — persistence
4. `oms_routing_rules` ORM entity + plugin migration under `libs/oms/src/migrations/`, registered
   in **both** `apps/api/src/plugin-migrations.ts` and `scripts/plugin-migration-dirs.json`
   (they are equality-checked). Timestamp: next free synthetic prefix after `1869000000000`,
   re-verified immediately before push (three collided in one day this wave).
   Columns: `id`, `connectionId`, `position`, `kind`, `name`, `afterAction`, `config` jsonb,
   `effectiveFrom`/`effectiveTo`, timestamps. Partial-unique on `(connectionId, kind, name)`
   where `effectiveTo IS NULL` — the duplicate detection the amendment's reason (2) asks for;
   a `conditionsHash` is not copied because the vocabulary is closed, so `(kind, name)` *is* the
   rule's identity and hashing an unbounded condition blob has no analogue here.
5. Repository + port; add its table to the int-test `tablesToTruncate` list.

### Phase 3 — the pure pipeline
6. `evaluate-routing.ts` — one pure function `(input, rules, facts) => {candidates,
   unfulfillable, explanation}`. No I/O; every fact is caller-loaded (the `sales-documents`
   evaluator precedent). Emits one `RoutingExplanationStep` per rule with eliminations and, for
   sorts, scores.
7. A facts loader service assembling locations + per-location stock + blocking rejections.

### Phase 4 — the router
8. `OlFulfillmentRouter implements FulfillmentRouterPort`. `evaluate()` returns the pipeline
   output verbatim; `route()` runs the **same** pipeline, then assigns quantities and mints
   nothing committing beyond the caller-supplied `options.idempotencyKey`. Conservation is
   asserted against `checkRoutingPlanConservesQuantities` before returning.
9. `createOlFulfillmentRouter(deps)` exported from the package barrel — **not** via
   `dispatchCapability`, which would require a manifest capability the port forbids.
   `OmsPluginDeps` gains `locations` (and the work-query read); note the likely conflict with
   #2409 in `oms.plugin.ts`.

### Phase 5 — tests
10. `runFulfillmentRouterContract(() => createOlFulfillmentRouter(fakes))` — all 9 cases.
11. Property test: `evaluate()` and `route()` produce an identical explanation for the same
    input (issue AC).
12. Unit specs per filter and per sort, each written to **fail first** for the right reason —
    a suite that cannot distinguish the defect from its absence is not evidence.

---

## 7. Alternatives considered

- **`Connection.config.routing` jsonb**, as #2408's title says — rejected: superseded by ADR-054's
  adopted amendment and contradicted by a merged in-code prohibition (§3).
- **A rules engine with arbitrary predicates** — rejected by ANALYSIS-1032 and DESIGN §5.3(c);
  filters+sorts is the smaller true shape, and a closed vocabulary is what keeps a routing rule
  reviewable.
- **Registering `FulfillmentRouter` as a dispatched capability** — rejected: the port docblock
  forbids it, and `enabledCapabilities` is stamped at connection create and never retro-filled,
  so a gate on it would drain nothing for every existing connection (the #2085 shape).

---

## 8. Risks

- **#2730 refusal**: any plan carrying holds or unfulfillable lines is refused by
  `RoutingCommitService.refusalFor`. This router emits neither. A line it cannot source is
  reported through the explanation and left unassigned only where conservation still holds;
  where it cannot, the run reports no plan rather than emitting an arm the caller must refuse.
- **Merge conflicts** in `libs/oms`, `fulfillment.tokens.ts` and the context `index.ts` with
  #2407/#2409 — a prior merge here produced two `exports:` keys, valid TS that silently drops the
  first. Re-fetch and re-read before both the PR and any merge.
- **Migration timestamp collision** — siblings are in flight and the checker cannot see them.

---

## 9. Acceptance criteria

- [ ] Passes `describeFulfillmentRouterContract` / `runFulfillmentRouterContract`
- [ ] Absent/malformed rules are inert and never throw
- [ ] `evaluate()` and `route()` share one pipeline (property test)
- [ ] `country-served` reads the Wave-1b `inventory_locations` country column; `nearest`'s proxy
      semantics are documented and degrade honestly on the hashed arm
- [ ] Every declared vocabulary member can actually select (§5 resolved)
- [ ] `pnpm lint` / `type-check` / `test` / `test:integration` / `check:invariants` green

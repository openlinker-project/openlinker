# Implementation Plan: `FulfillmentRouterPort` + routing I/O types + `RoutingInput` PII allowlist

**Issue**: [#2393](https://github.com/openlinker-project/openlinker/issues/2393) (`W3a-4`, Wave 3a stream S1)
**Epic**: [#2412](https://github.com/openlinker-project/openlinker/issues/2412)
**Date**: 2026-08-30
**Status**: Ready for Review
**Estimated Effort**: ~0.5–1 day
**Design of record**: `docs/plans/analysis/DESIGN-oms-authority-model.md` §5.3; [ADR-062](../architecture/adrs/062-trust-posture-for-authority-holding-capabilities.md) Decision 2; [ADR-054](../architecture/adrs/054-fulfillment-work-unit-of-assignment.md); [ADR-053](../architecture/adrs/053-fulfillment-authority-vocabulary-leaf.md); [ADR-055](../architecture/adrs/055-first-party-oms-product-package.md); REVIEW G5, H7.

---

## 1. Task Summary

**Objective**: ship the neutral contract a fulfilment router is called through — `FulfillmentRouterPort` (`evaluate` non-committing, `route` committing) — together with the routing I/O types that cross it, and make `RoutingInput`'s PII exposure an **explicit allowlist projection** rather than a spread of an order.

**Context**: ADR-055 makes the router a connection-backed plugin, so `RoutingInput` is a projection handed to third-party code. ADR-062 Decision 2 bounds that exposure *by construction*: `shipTo` is limited to what routing can actually filter on, `OL_STORE_PII`-aware, with a degraded hash-only shape — the same discipline the MCP tools' explicit-allowlist projections already apply (`get_order` enumerates its line-item fields rather than spreading them, so a field added to the underlying shape later cannot silently start leaking).

**Classification**: CORE / Domain. Types, one port interface, one domain exception, two pure functions. No adapter, no service, no persistence, no HTTP.

---

## 2. Scope & Non-Goals

### In scope
- `libs/core/src/fulfillment/domain/types/routing.types.ts` — `RoutingInput`, `RoutingInputLine`, `RoutingShipTo`, `RoutingPlan` (+ its `pending` arm), `RoutingEvaluation`, `RoutingAssignment`, `RoutingUnfulfillableLine`, `RoutingHold`, `RoutingExplanationStep`, `RoutingRuleRef`.
- `libs/core/src/fulfillment/domain/ports/fulfillment-router.port.ts` — the two-method port, with a pointer line to the Wave-4 hardening issues.
- `libs/core/src/fulfillment/domain/types/routing-ship-to.ts` — the pure `buildRoutingShipTo` projector + the exported `ROUTING_SHIP_TO_ALLOWED_KEYS` allowlist.
- `libs/core/src/fulfillment/domain/exceptions/pending-routing-plan-not-supported.exception.ts` + the pure `assertRoutingPlanResolved` narrowing helper.
- Specs: the structural PII allowlist test, the `OL_STORE_PII=false` degraded shape, the `pending`-arm rejection, and the `evaluate()`-is-non-committing structural test.
- Barrel export from `libs/core/src/fulfillment/index.ts`.

### Out of scope (owned elsewhere, named)
- **The named filter/sort vocabulary and its coercer** — REVIEW H7 moves them to `@openlinker/oms`; core keeps only what crosses the port, with rule names as **opaque strings + display labels** so a vendor's own rule names render.
- **The `pending` arm's *consumption*** — Wave 4 (`W4-3`). 3a **declares** the arm and rejects it with a named error.
- **Per-method error unions and wall-clock budgets** — Wave-4 hardening (`W4-1`, `W4-2`); the port file carries a pointer line (issue's own Assumptions).
- **Persistence** — `fulfillment_works` / `_lines` / `_holds`, their migration, the repository and `FULFILLMENT_WORK_REPOSITORY_TOKEN` are **#2392**'s (concurrent sibling). No ORM entity, no migration, no repository, no NestJS module here.
- **The routing decision row, the per-order lock, `selectPrimaryFulfillmentRouter`** — design §5.3's "exactly one router per order" four-part copy is #2395's.
- **`maxBatchSize` / freshness declaration** (REVIEW G5's other half) — not in this issue's Proposed Solution; deferred with the Wave-4 hardening.

### Constraints
- **`FulfillmentRouter` must NOT enter `CoreCapabilityValues`** (#2403 ruled A2 `config-only`): nothing can dispatch the name, and an advertised name invites a gate that silently does nothing because `enabledCapabilities` is stamped at create and never retro-filled (the #2085 shape). Discovery, if ever needed, is guard-narrowing — the `ModifiedProductLister` precedent.
- **ADR-053 no-injection invariant** — the `fulfillment` context injects no `orders` / `inventory` service; order data enters as **arguments**. `scripts/check-no-injection-contracts.mjs` scans source text and cannot see `ModuleRef.get(TOKEN, { strict: false })`, so that idiom must not be used to route around the rule.
- **Zero-sibling-edge leaf** — `libs/core/src/__tests__/barrel-purity.spec.ts` fails on any non-relative `@openlinker/core/<ctx>` import under `libs/core/src/fulfillment`. The allow-set holds exactly one entry today (`@openlinker/core/fulfillment-authority`, type-only).

---

## 3. Architecture Mapping

**Target layer**: CORE → `libs/core/src/fulfillment/domain/` (ports + types + exceptions).

**Why CORE, not an integration**: the port is the abstraction a router *implements*. ADR-055 puts the first-party router in `@openlinker/oms` and ADR-062 Decision 1 makes third-party the *contract* target; both need the contract to live in core, exactly as `OfferManagerPort` / `InventoryMasterPort` do.

**New components**: 1 port interface, 10 types, 1 domain exception, 2 pure functions. **Existing reused**: `@openlinker/shared/config`'s `hashAddress` (the one salted address-hash rule in the tree) and `getEnvBoolean`.

### Decision: `RoutingInput` carries only self-contained primitives — **zero new allow-set entries**

`orderId` is a plain internal-id string (the shape `FulfillmentWork.orderId` already holds, and the reason ADR-053's no-injection invariant is cheap here), lines carry `orderLineId` / `productVariantId` / `quantity`, and `shipTo` is the allowlisted projection. Nothing needs the `Order` shape, so **no `@openlinker/core/orders/types` entry is added to `ZERO_SIBLING_EDGE_LEAVES`**. That route exists and is sanctioned, but it is a per-leaf registration and therefore a deliberate decision — this slice does not need to spend it.

### Decision: the degraded shape is ONE `locationHash`, not per-field hashes

| `OL_STORE_PII` | `RoutingShipTo` |
|---|---|
| `true` (default) | `{ mode: 'plain', countryIso2, postcode: string \| null, city: string \| null }` |
| `false` | `{ mode: 'hashed', countryIso2, locationHash }` |

Three reasons. (1) **`countryIso2` survives in both arms**: a country code is not PII — `order-address-redaction.ts` already keeps `country` in the clear under redaction — and `country-served` is the primary routing filter, so degrading it would make hash-only mode unable to route at all rather than merely less precise. (2) **A hashed postcode supports neither prefix nor range matching**, so per-field hashes would *look* like they preserved zone routing while preserving nothing; one `locationHash` is honest about what hash-only mode really costs (equality grouping survives, zone routing does not). (3) It reuses `hashAddress` — the tree's single salted address-hash rule — instead of minting a second hashing convention inside a leaf.

**Never crosses the port, in either arm**: buyer name, email, phone, `address1`, `address2`, buyer tax id, prices/totals (routing is a sourcing decision, not a pricing one), and the `Order` entity itself.

---

## 4. Questions & Assumptions

### Assumptions
- `hashAddress` throwing `PiiConfigurationError` when `OL_PII_HASH_SALT` is unset is **acceptable and correct here**: the throw is reachable only on the `storePii === false` branch, and such a deployment already requires the salt for `customer_projections`. Assumed rather than defended around — a silent unsalted fallback would be worse.
- Rule names crossing the port are **opaque strings with display labels** (REVIEW H7). `RoutingRuleRef = { ruleId, name, displayLabel }` with no core-side validation of `name`, so a vendor's own rule names render.
- `evaluate()` returns candidates + explanation and **mints no `decisionId`**; the design's "it never mints an internal id (operates on ingested orders only)" is read as forbidding a committing identifier on that path.

### Open questions (recorded, not blocking)
- Whether `RoutingHold` should reference `HoldReason` from `@openlinker/core/order-lifecycle` (design adjudication #4 keeps one hold vocabulary for both grains). **Deferred**: holds are first-class rows landing with #2392, and importing the union would spend a second allow-set entry for a field with no writer. `RoutingHold.reason` is an opaque string in this slice, with the tension recorded in its docblock so #2392/#2395 resolve it deliberately.
- `maxBatchSize` / freshness (REVIEW G5) — not in this issue's Proposed Solution; flagged so Wave 4 does not assume 3a shipped it.

---

## 5. Implementation Plan

### Phase 1 — the projection and its allowlist (the point of the issue)
1. **`domain/types/routing-ship-to.ts`** — `RoutingShipTo` union, `ROUTING_SHIP_TO_ALLOWED_KEYS` (`as const`), and the pure `buildRoutingShipTo(source, { storePii })`.
   - `storePii` is an **explicit argument**, not read from env inside the function, so the function stays pure and testable; one thin resolver reads `getEnvBoolean('OL_STORE_PII', true)` at the single call site the builders will use.
   - **Acceptance**: `buildRoutingShipTo` never returns a key outside the allowlist for either arm.
2. **`routing-ship-to.spec.ts`** — the structural allowlist test (§9), the degraded-shape test, and a test that a source object carrying `name` / `email` / `phone` / `address1` produces a projection containing none of them.

### Phase 2 — routing I/O types
3. **`domain/types/routing.types.ts`** — `RoutingInput` (+`RoutingInputLine`), `RoutingAssignment`, `RoutingUnfulfillableLine`, `RoutingHold`, `RoutingExplanationStep`, `RoutingRuleRef`, `ResolvedRoutingPlan`, `PendingRoutingPlan`, `RoutingPlan`, `RoutingEvaluation`.
   - Every member `readonly`; arrays `readonly T[]`. No `as const` value unions are introduced except where a closed vocabulary genuinely exists (`RoutingUnfulfillableResolution = 'refund' | 'return'`, per §5.3(a): "`unfulfillable` lines resolve as line-scoped refund/return, never an invented partial-cancel state no source can express").
   - **Acceptance**: `pnpm type-check` clean; no import of any `@openlinker/core/<ctx>` specifier.

### Phase 3 — the `pending` arm's named rejection
4. **`domain/exceptions/pending-routing-plan-not-supported.exception.ts`** + `assertRoutingPlanResolved(plan): asserts plan is ResolvedRoutingPlan`.
   - The arm is **declared** so a DOMS that sources asynchronously (R1) has a shape to answer in; 3a **rejects** it with a named error rather than silently treating it as resolved, which would proceed with no assignments and look like a successful empty routing.
   - **Acceptance**: a spec asserts a `pending` plan throws the named error carrying its `decisionId`, and that a resolved plan narrows and returns.

### Phase 4 — the port
5. **`domain/ports/fulfillment-router.port.ts`** — the two methods, the header stating (a) return-type-can-say-no, (b) dry-run is first-class, (c) rules are opaque across the port, plus the pointer line to `W4-1` / `W4-2` for per-method error unions and wall-clock budgets.
   - **No `is*` guard, no manifest entry, no `CoreCapabilityValues` member** — A2 is `config-only` (#2403). The file says so, so the next reader does not add one.
6. **`fulfillment-router.port.spec.ts`** — the `evaluate()`-is-non-committing structural test (§9).

### Phase 5 — barrel + gates
7. Export from `libs/core/src/fulfillment/index.ts` and extend its docblock table with the two new rows.
8. Run the full gate (§10).

**No token is added**, so `fulfillment.tokens.ts` is untouched and the expected conflict with #2392 does not arise.

---

## 6. Alternatives Considered

| Alternative | Rejected because |
|---|---|
| `RoutingInput.order: Order` (or the `orders/types` sub-barrel) | Spends a second allow-set entry for no need, and hands a plugin the whole order — the exact spread ADR-062 Decision 2 forbids. Primitives cover every documented filter. |
| Per-field hashes (`postcodeHash`, `cityHash`) | Looks like it preserves zone routing and does not; a hashed postcode admits neither prefix nor range matching. One `locationHash` states the real cost. |
| Drop `shipTo` entirely under `OL_STORE_PII=false` | `country-served` is the primary filter; hash-only mode would stop routing rather than degrade. |
| Add `FulfillmentRouter` to `CoreCapabilityValues` | #2403 ruled A2 `config-only`. Nothing can dispatch it, and an advertised name invites a gate that drains nothing for every existing connection. |
| Closed filter/sort union in core | REVIEW H7 assigns the names + coercer to `@openlinker/oms`; a closed union here would bind every vendor to OL's own rule vocabulary. |
| Treat `pending` as resolved-with-no-assignments in 3a | Indistinguishable from a successful empty routing. A named error is the honest 3a answer. |

---

## 7. Validation & Risks

| Check | Status |
|---|---|
| Hexagonal layering (domain only, no framework import) | ✅ |
| CORE ↔ Integration boundary | ✅ — port in core, implementers outside |
| Zero-sibling-edge leaf preserved (no new allow-set entry) | ✅ |
| ADR-053 no-injection invariant | ✅ — no injection, no `ModuleRef` |
| Naming (`*.port.ts` → `{Capability}Port`, `*.types.ts`, `*.exception.ts`) | ✅ |
| Pure-rule exception to "types only" | ✅ — `buildRoutingShipTo` / `assertRoutingPlanResolved` are pure, are the rule for the type they sit with, and change with it |
| `as const` + union (never `enum`) | ✅ |
| Idempotency / retries / rate limits | n/a — no I/O in this slice |

**Risks**
- *A later field is added to `RoutingShipTo` without the allowlist* → the structural spec fails; adding a field is a deliberate two-place edit (type + `ROUTING_SHIP_TO_ALLOWED_KEYS`).
- *`hashAddress` throws on an unsalted hash-only deployment* → accepted and documented (§4); such a deployment is already misconfigured for `customer_projections`.
- *Merge conflict with #2392* → confined to `index.ts` (append-only). No token added, so `fulfillment.tokens.ts` is untouched.

**Backward compatibility**: additive only. Nothing imports these types yet — the #2304/#2391 "vocabulary ships first" posture.

---

## 8. Testing Strategy & Acceptance Criteria

Unit only (`*.spec.ts`, colocated). No integration test: this slice has no persistence, no wiring and no boot-graph change — #2392 owns the provider-graph assertion in `fulfillment-no-injection-boot.int-spec.ts`.

**Every test is verified red-first**, and a red for the *wrong* reason (an unused-import `TS6133` with `Tests: 0 total`) is treated as a false pass — each guard is confirmed to fail on its own assertion before the implementation lands.

- **AC1 — `RoutingInput` cannot carry name/email/phone** (structural): a runtime test that every key of both projected arms is in `ROUTING_SHIP_TO_ALLOWED_KEYS`, plus a compile-time `Extract<keyof RoutingShipTo, 'name'|'email'|'phone'|'address1'|'address2'> extends never` assertion, plus a projection test proving a source carrying those fields yields none of them.
- **AC2 — `OL_STORE_PII=false` produces the hash-only degraded shape**: `mode: 'hashed'`, a `locationHash`, `countryIso2` still present, and **no** `postcode` / `city` key at all (absent, not `null` — a `null` key would still be a key the allowlist has to admit).
- **AC3 — `evaluate()` is provably non-committing**: a structural test asserting `RoutingEvaluation` carries no `decisionId` / `assignments` / `holds` (via `Extract<keyof RoutingEvaluation, …> extends never`), plus a source scan asserting the port and types files import no repository port, no service token and no `ModuleRef` — i.e. no write seam is reachable from a caller of `evaluate`.
- **AC4 — the `pending` arm exists and is rejected**: `assertRoutingPlanResolved` throws `PendingRoutingPlanNotSupportedError` carrying the `decisionId`, and narrows a resolved plan.
- **AC5 — no boundary violation**: `pnpm check:invariants` (35 checks) green, including `check-cross-context-imports` and `check-no-injection-contracts`; `barrel-purity.spec.ts` green with the allow-set unchanged.

---

## 9. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (`hashAddress`, the `is*`-free config-only posture, the pure-rule file convention)
- [x] Idempotency considered (n/a — no I/O)
- [x] Event-driven patterns (n/a)
- [x] Rate limits & retries (n/a — deferred to `W4-1`/`W4-2`, pointer line in the port)
- [x] Error handling — one named domain exception in `domain/exceptions/`
- [x] Testing strategy complete, red-first
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Execution-ready

---

## 10. Gate

`pnpm lint` · `pnpm type-check` · `pnpm test` · `pnpm test:integration` · `pnpm check:invariants` (35).
Node 22. Known pre-existing and not chased: **#2638** `earliest-order-date`, **#2639** `allegro-prestashop-carrier-mapping`.

---

## Related Documentation

- [Architecture Overview § 26 Fulfillment](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [ADR-062](../architecture/adrs/062-trust-posture-for-authority-holding-capabilities.md) · [ADR-055](../architecture/adrs/055-first-party-oms-product-package.md) · [ADR-054](../architecture/adrs/054-fulfillment-work-unit-of-assignment.md) · [ADR-053](../architecture/adrs/053-fulfillment-authority-vocabulary-leaf.md)
- `docs/plans/implementation-plan-fulfillment-context.md` (#2391, the parent slice)

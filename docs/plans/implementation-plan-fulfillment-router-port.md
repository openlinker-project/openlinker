# Implementation Plan: `FulfillmentRouterPort` + routing I/O types + `RoutingInput` PII allowlist

**Issue**: [#2393](https://github.com/openlinker-project/openlinker/issues/2393) (`W3a-4`, Wave 3a stream S1)
**Epic**: [#2412](https://github.com/openlinker-project/openlinker/issues/2412)
**Date**: 2026-08-30
**Status**: Ready for Review (revision 2 — `/tech-review` findings applied)
**Estimated Effort**: ~0.5–1 day
**Design of record**: `docs/plans/analysis/DESIGN-oms-authority-model.md` §5.3; [ADR-062](../architecture/adrs/062-trust-posture-authority-holding-capabilities.md) Decision 2; [ADR-055](../architecture/adrs/055-oms-as-credentialless-connection-plugin.md); [ADR-054](../architecture/adrs/054-fulfillment-work-unit-of-assignment.md); [ADR-053](../architecture/adrs/053-fulfillment-authority-vocabulary-leaf.md); REVIEW G5, H7.

> **Revision 2** applies the `/tech-review` verdict on revision 1. Two BLOCKING findings are resolved in §3 (the hashed arm's input source) and §8 (a vacuous compile-time assertion); the readiness gate's I-1/I-2 are folded into §3 and §5; `route()` gains the idempotency key design §5.3 requires to cross the port.

---

## 1. Task Summary

**Objective**: ship the neutral contract a fulfilment router is called through — `FulfillmentRouterPort` (`evaluate` non-committing, `route` committing) — together with the routing I/O types that cross it, and make `RoutingInput`'s PII exposure an **explicit allowlist projection** rather than a spread of an order.

**Context**: ADR-055 makes the router a connection-backed plugin, so `RoutingInput` is a projection handed to third-party code. ADR-062 Decision 2 bounds that exposure *by construction*: `shipTo` is limited to what routing can actually filter on, `OL_STORE_PII`-aware, with a degraded hash-only shape — the same discipline the MCP tools' explicit-allowlist projections already apply (`get_order` enumerates its line-item fields rather than spreading them, so a field added to the underlying shape later cannot silently start leaking).

**Classification**: CORE / Domain. Types, one port interface, one domain exception, two pure functions. No adapter, no service, no persistence, no HTTP.

---

## 2. Scope & Non-Goals

### In scope
- `domain/types/routing.types.ts` — `RoutingInput`, `RoutingInputLine`, `RoutingPlan` (+ its `pending` arm), `RoutingEvaluation`, `RoutingAssignment`, `RoutingUnfulfillableLine`, `RoutingHold`, `RoutingExplanationStep`, `RoutingRuleRef`, `RouteOptions`.
- `domain/types/routing-ship-to.types.ts` — `RoutingShipTo`, `RoutingShipToSource`, the pure `buildRoutingShipTo` projector, and the exported `ROUTING_SHIP_TO_ALLOWED_KEYS` / `ROUTING_INPUT_ALLOWED_KEYS` / `ROUTING_INPUT_LINE_ALLOWED_KEYS` allowlists.
- `domain/ports/fulfillment-router.port.ts` — the two-method port, with a pointer line to the Wave-4 hardening issues.
- `domain/exceptions/pending-routing-plan-not-supported.exception.ts` + the pure `assertRoutingPlanResolved`.
- Specs (§8). Barrel export from `libs/core/src/fulfillment/index.ts`. An `architecture-overview.md` § 26 paragraph.

### In scope by review finding: the route idempotency key
Design §5.3 requires "a mandatory route idempotency key derived from the decision row". The **decision row** is #2395's, but the **key has to cross the port**, so deferring the whole clause would force #2395 to widen a published port one slice after it ships. `route(input, options)` therefore takes a required `RouteOptions.idempotencyKey` **now**, documented as populated by #2395.

It is on `route`'s options and deliberately **not** on `RoutingInput`, which both methods share: a committing key reachable from `evaluate()` would contradict the non-committing contract. Keeping `evaluate(input)` single-argument is itself the structural evidence — evaluate cannot even be *handed* a key.

### Out of scope (owned elsewhere, named)
- **The named filter/sort vocabulary and its coercer** — REVIEW H7 moves them to `@openlinker/oms` (today an empty `OmsModule`); core keeps only what crosses the port, with rule names as **opaque strings + display labels** so a vendor's own rule names render.
- **The `pending` arm's *consumption*** — Wave 4 (`W4-3`). 3a **declares** the arm and rejects it with a named error.
- **Per-method error unions, wall-clock budgets, `maxBatchSize`/declared freshness, and an order-version/freshness token on `RoutingInput`** — Wave-4 hardening (`W4-1`, `W4-2`). The port file carries a pointer line. `maxBatchSize` is REVIEW G5's other half and is **unowned by any Wave-3a issue**; it must be filed against the Wave-4 hardening epic rather than left as a note in a plan document that closes with its PR.
- **Persistence** — `fulfillment_works` / `_lines` / `_holds`, their migration, the repository and `FULFILLMENT_WORK_REPOSITORY_TOKEN` are **#2392**'s (concurrent sibling). No ORM entity, no migration, no repository, no NestJS module here.
- **The routing decision row, the per-order lock, `selectPrimaryFulfillmentRouter`** — #2395's.

### Constraints
- **`FulfillmentRouter` must NOT enter `CoreCapabilityValues`** (#2403 ruled A2 `config-only`): nothing can dispatch the name, and an advertised name invites a gate that silently does nothing because `enabledCapabilities` is stamped at create and never retro-filled (the #2085 shape).
- **ADR-053 no-injection invariant** — order data enters as **arguments**. `scripts/check-no-injection-contracts.mjs` scans source text and cannot see `ModuleRef.get(TOKEN, { strict: false })`, so that idiom must not be used to route around the rule.
- **Zero-sibling-edge leaf** — the `fulfillment` allow-set in `barrel-purity.spec.ts` holds exactly one entry and **this slice adds none**.

---

## 3. Architecture Mapping

**Target layer**: CORE → `libs/core/src/fulfillment/domain/` (ports + types + exceptions).

**Why CORE, not an integration**: the port is the abstraction a router *implements*. ADR-055 puts the first-party router in `@openlinker/oms` and ADR-062 Decision 1 makes third-party the *contract* target; both need the contract in core, exactly as `OfferManagerPort` / `InventoryMasterPort` do.

### Decision: `RoutingInput` carries only self-contained primitives — **zero new allow-set entries**

`orderId` is a plain internal-id string (the shape `FulfillmentWork.orderId` already holds, and why ADR-053's no-injection invariant is cheap here), lines carry `orderLineId` / `productVariantId` / `quantity`, and `shipTo` is the allowlisted projection. Nothing needs the `Order` shape, so **no `@openlinker/core/orders/types` entry is added**. That route is sanctioned but is a per-leaf registration and therefore a deliberate spend; this slice does not need it.

### Decision (revised — BLOCKING-1): the degraded arm carries a **caller-supplied** `locationHash`; core never hashes

| `OL_STORE_PII` | `RoutingShipTo` |
|---|---|
| `true` (default) | `{ mode: 'plain', countryIso2, postalCode: string \| null, city: string \| null }` |
| `false` | `{ mode: 'hashed', countryIso2, locationHash: string \| null }` |

Revision 1 had `buildRoutingShipTo` recompute the hash with `hashAddress`. **That is wrong, and silently so.** Under `OL_STORE_PII=false` the persisted order snapshot's address has already been through `redactAddress` (`libs/core/src/orders/domain/order-address-redaction.ts`), which replaces `address1` / `city` / `postalCode` with the literal `'[REDACTED]'` and keeps only `country`. Hashing that yields **one `locationHash` per country, shared by every order in the install** — a plausible 64-hex string that groups everything, so the single-hash design's own justification ("equality grouping survives, zone routing does not") would be false with nothing to signal it. `NormalizedAddress` also requires `address1`/`city`, which an allowlisted projection does not have, so the projector could not have fed it honestly in the first place.

So **core projects and selects; it does not derive.** `locationHash` is passed through from `RoutingShipToSource.addressHash` — the ingestion-time hash OL already persists on `customer_address_projections.addressHash`, computed by the one salted `hashAddress` rule, and available precisely on a hash-only deployment. `null` when the caller has none, which is honest rather than a fabricated grouping key.

Three consequences, all improvements: this slice imports **no** hashing helper (so no second call site of a salted rule, and no `OL_PII_HASH_SALT` throw reachable from a routing path), provenance is a fact rather than a recomputation, and the leaf gets no new dependency at all.

**`countryIso2` survives in both arms**: a country code is not PII — `order-address-redaction.ts` already keeps `country` in the clear under redaction — and `country-served` is the primary routing filter, so degrading it would make hash-only mode unable to route rather than merely less precise.

**Why one `locationHash` and not per-field hashes**: a hashed postcode admits neither prefix nor range matching, so per-field hashes would *look* like they preserved zone routing while preserving nothing. One hash states the real cost — equality grouping survives, zone routing does not — and a design that misleads is worse than one that degrades.

**Never crosses the port, in either arm**: buyer name, email, phone, `address1`, `address2`, buyer tax id, prices/totals (routing is a sourcing decision, not a pricing one), and the `Order` entity itself.

### Decision (readiness gate I-2): the field is `postalCode`

The repo carries both spellings. `RedactableAddress` / `RedactedAddress` and the order snapshot — the shapes a caller actually holds — use `postalCode`; only `NormalizedAddress` uses `postcode`, and that is the `hashAddress` boundary this slice no longer touches. ADR-062's prose ("country, postcode, city") names the *values*, not the identifier.

### Decision (readiness gate I-1): the port header disambiguates itself from `mappings`

`libs/core/src/mappings` already ships an HTTP-exposed `FulfillmentRouting*` family (`FulfillmentRoutingQuery`, `IFulfillmentRoutingService`, `connections/:connectionId/routing-rules`) answering *"which processor/carrier dispatches this?"*, and `ReservationService` consumes it for `atpEffect`. `FulfillmentRouterPort` answers *"which location and holder sources this?"*. The symbols do not collide, but the phrase already means something here, so the port header names the existing family and states the distinction. Neither is renamed.

---

## 4. Questions & Assumptions

### Assumptions
- Rule names crossing the port are **opaque strings with display labels** (REVIEW H7): `RoutingRuleRef = { ruleId, name, displayLabel }`, with no core-side validation of `name`.
- `evaluate()` mints no `decisionId` — the design's "it never mints an internal id (operates on ingested orders only)" read as forbidding a committing identifier on that path.
- `RoutingShipToSource.addressHash` is the caller's responsibility to populate; core asserts nothing about how it was derived beyond passing it through unchanged.

### Open questions (recorded, non-blocking)
- **`RoutingHold.reason` stays an opaque string**, rather than importing `HoldReason` from `@openlinker/core/order-lifecycle` (design adjudication #4 wants one hold vocabulary across both grains). Importing it spends the leaf's **second** allow-set entry for a field with no writer, when holds become first-class rows in #2392 and the vocabulary decision is genuinely theirs.
  Two things the docblock must record so this reads as a decision rather than an inconsistency: (a) the **asymmetry inside the same file** — `RoutingUnfulfillableLine.resolution` *is* a closed `'refund' | 'return'` union because design §5.3(a) closes it explicitly, while `reason` is a cross-grain vocabulary another context owns; and (b) narrowing an opaque string to `HoldReason` later is a **breaking** change for any implementer.
- `'routing'` is already an `AuthorityAttentionProducer` in `fulfillment-authority`, with `'line-unfulfillable'` as its default reason. No import is taken — that union is a *persisted operator state* while `RoutingUnfulfillableLine.resolution` is a port-level statement — but the docblock cross-references it so the two are not later conflated.

---

## 5. Implementation Plan

### Phase 1 — the projection and its allowlists (the point of the issue)
1. **`domain/types/routing-ship-to.types.ts`** — `RoutingShipToSource` (the wider input: `countryIso2`, `postalCode`, `city`, `addressHash`, each nullable), the `RoutingShipTo` union, the three `*_ALLOWED_KEYS` `as const` arrays, and the pure `buildRoutingShipTo(source, { storePii })`.
   - `storePii` is an **explicit argument**, never read from env inside the function: the function stays pure, and the one thin resolver a builder uses reads `getEnvBoolean('OL_STORE_PII', true)` — **not** `getPiiConfig()`, which throws `PiiConfigurationError` when `OL_PII_HASH_SALT` is unset *regardless of `storePii`* and would break routing on a default deployment. The precedent with its own rationale comment is `order-ingestion.service.ts:840-846`.
   - **Acceptance**: neither arm ever carries a key outside `ROUTING_SHIP_TO_ALLOWED_KEYS`.

### Phase 2 — routing I/O types
2. **`domain/types/routing.types.ts`** — `RoutingInput` (+`RoutingInputLine`), `RouteOptions`, `RoutingAssignment`, `RoutingUnfulfillableLine`, `RoutingHold`, `RoutingExplanationStep`, `RoutingRuleRef`, `ResolvedRoutingPlan`, `PendingRoutingPlan`, `RoutingPlan`, `RoutingEvaluation`.
   - Every member `readonly`; arrays `readonly T[]`. The one closed `as const` union is `RoutingUnfulfillableResolutionValues = ['refund', 'return']` — design §5.3(a): unfulfillable lines resolve as line-scoped refund/return, "never an invented partial-cancel state no source can express".

### Phase 3 — the `pending` arm's named rejection
3. **`domain/exceptions/pending-routing-plan-not-supported.exception.ts`** + `assertRoutingPlanResolved(plan): asserts plan is ResolvedRoutingPlan`.
   - The arm is **declared** so an asynchronous DOMS (R1) has a shape to answer in; 3a **rejects** it rather than silently treating it as resolved, which would proceed with no assignments and read as a successful empty routing.

### Phase 4 — the port
4. **`domain/ports/fulfillment-router.port.ts`** — `evaluate(input)` / `route(input, options)`, with a header stating (a) return-type-can-say-no, (b) dry-run is first-class, (c) rules are opaque across the port, (d) **the disambiguation from `mappings`' `FulfillmentRouting*` family**, and (e) the pointer line to `W4-1` / `W4-2`.
   - **No `is*` guard, no manifest entry, no `CoreCapabilityValues` member** — A2 is `config-only` (#2403). The file says so, so the next reader does not add one.

### Phase 5 — barrel, docs, gates
5. Export from `libs/core/src/fulfillment/index.ts`; extend its docblock table.
6. Add the `docs/architecture-overview.md` § 26 paragraph (every recent slice of this programme lands one; § 26 already forward-references #2395/#2398/#2406).
7. Run the full gate (§10).

**No token is added**, so `fulfillment.tokens.ts` keeps its `export {};` and the conflict with #2392 does not arise there.

---

## 6. Alternatives Considered

| Alternative | Rejected because |
|---|---|
| `RoutingInput.order: Order` (or the `orders/types` sub-barrel) | Spends a second allow-set entry for no need, and hands a plugin the whole order — the exact spread ADR-062 Decision 2 forbids. |
| Recompute `locationHash` in core with `hashAddress` (revision 1) | On the only deployment it exists for, the input is already `'[REDACTED]'`, so it yields one hash per country and silently groups the whole install. See §3. |
| Per-field hashes (`postalCodeHash`, `cityHash`) | Looks like it preserves zone routing and does not; a hashed postcode admits neither prefix nor range matching. |
| Drop `shipTo` entirely under `OL_STORE_PII=false` | `country-served` is the primary filter; hash-only mode would stop routing rather than degrade. |
| Add `FulfillmentRouter` to `CoreCapabilityValues` | #2403 ruled A2 `config-only`. Nothing can dispatch it, and an advertised name invites a gate that drains nothing for every existing connection. |
| Closed filter/sort union in core | REVIEW H7 assigns the names + coercer to `@openlinker/oms`; a closed union here would bind every vendor to OL's rule vocabulary. |
| `idempotencyKey` on `RoutingInput` | Shared by both methods, so it would be reachable from the non-committing `evaluate()`. |
| Defer `idempotencyKey` wholly to #2395 | Forces a published port shape to widen one slice after it ships, in the same wave. |
| Treat `pending` as resolved-with-no-assignments in 3a | Indistinguishable from a successful empty routing. |

---

## 7. Validation & Risks

| Check | Status |
|---|---|
| Hexagonal layering (domain only, no framework import) | OK |
| CORE ↔ Integration boundary | OK — port in core, implementers outside |
| Zero-sibling-edge leaf preserved (no new allow-set entry) | OK |
| ADR-053 no-injection invariant | OK — no injection, no `ModuleRef` |
| Naming (`*.port.ts` → `{Capability}Port`, `*.types.ts`, `*.exception.ts`) | OK |
| Pure-rule exception to "types only" | OK — `buildRoutingShipTo` / `assertRoutingPlanResolved` are pure, are the rule for the type they sit with, and change with it |
| `as const` + union (never `enum`) | OK |
| Idempotency | OK — `RouteOptions.idempotencyKey` required on the committing method |

**Risks**
- *A later field is added without the allowlist* → the structural specs fail; adding a field is a deliberate two-place edit (type + `*_ALLOWED_KEYS`).
- *A caller passes a hash derived some other way* → core cannot detect it; documented as the caller's responsibility (§4).
- *Merge conflict with #2392* → confined to `index.ts` (append-only) and the overview paragraph.

**Backward compatibility**: additive only. Nothing imports these types yet — the #2304/#2391 "vocabulary ships first" posture.

---

## 8. Testing Strategy & Acceptance Criteria

Unit only, colocated. No integration test: no persistence, no wiring, no boot-graph change — #2392 owns the provider-graph assertion in `fulfillment-no-injection-boot.int-spec.ts`.

**Every guard is verified red-first**, and a red for the *wrong* reason (an unused-import `TS6133` with `Tests: 0 total`) is treated as a false pass.

- **AC1 — `RoutingInput` cannot carry name/email/phone.** Three mechanisms, each failing red for its own reason:
  1. **Runtime key-set equality** over a fully-populated `RoutingInput`, `RoutingInputLine` and both `RoutingShipTo` arms against their `*_ALLOWED_KEYS` — widened beyond `shipTo`, because the issue's AC names `RoutingInput` and nothing structural otherwise stops a later `RoutingInput.buyerEmail`.
  2. **A distributive compile-time assertion.** Revision 1 used `Extract<keyof RoutingShipTo, …>`, which is **vacuous**: `RoutingShipTo` is a discriminated union and `keyof (A | B)` is the *intersection* (`'mode' | 'countryIso2'`), so it evaluated to `never` whether or not an arm carried `name`. The fix distributes: `type KeysOf<T> = T extends unknown ? keyof T : never`, asserted over `KeysOf<RoutingShipTo>` and `keyof RoutingInput`.
  3. **A source scan** of the two types files for the forbidden identifiers as property names (the `barrel-purity.spec.ts` technique).
- **AC2 — `OL_STORE_PII=false` produces the hash-only degraded shape**: `mode: 'hashed'`, `countryIso2` present, **no** `postalCode` / `city` key at all (absent, not `null` — a `null` key is still a key the allowlist must admit), and the caller's `addressHash` passed through **unchanged**. Plus the discrimination test the constant-hash bug would have failed: **two different source addresses in the same country yield two different `locationHash` values**, and a source with no `addressHash` yields `null` rather than a fabricated grouping key.
- **AC3 — `evaluate()` is non-committing.** Reworded to the claim this repo can actually support: it is a **contract-level** property, not a runtime guarantee about plugin behaviour — a third-party router's `evaluate()` can do what it likes and core cannot forbid it. What is asserted is that **no committing identifier can be returned or supplied**: `RoutingEvaluation` carries no `decisionId` (so no caller can persist a decision off an evaluate result), and `evaluate` takes no `RouteOptions`, so it cannot be handed an idempotency key. A source scan for repository ports / service tokens / `ModuleRef` is kept as cheap defence-in-depth, with its near-vacuity stated in the spec rather than presented as the proof.
- **AC4 — the `pending` arm exists and is rejected**: `assertRoutingPlanResolved` throws `PendingRoutingPlanNotSupportedError` carrying the `decisionId`, and narrows a resolved plan.
- **AC5 — no boundary violation**: `pnpm check:invariants` (35) green; `barrel-purity.spec.ts` green with the allow-set unchanged.

---

## 9. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (the pure-rule file convention, the salt-free flag read, the `is*`-free config-only posture)
- [x] Idempotency considered — required on `route`, absent from `evaluate` by design
- [x] Error handling — one named domain exception in `domain/exceptions/`
- [x] Testing strategy complete, red-first, and non-vacuous
- [x] Naming conventions followed
- [x] Execution-ready

---

## 10. Gate

`pnpm lint` · `pnpm type-check` · `pnpm test` · `pnpm test:integration` · `pnpm check:invariants` (35). Node 22.
Known pre-existing, not chased: **#2638** `earliest-order-date`, **#2639** `allegro-prestashop-carrier-mapping`.

---

## Related Documentation

- [Architecture Overview § 26 Fulfillment](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [ADR-062](../architecture/adrs/062-trust-posture-authority-holding-capabilities.md) · [ADR-055](../architecture/adrs/055-oms-as-credentialless-connection-plugin.md) · [ADR-054](../architecture/adrs/054-fulfillment-work-unit-of-assignment.md) · [ADR-053](../architecture/adrs/053-fulfillment-authority-vocabulary-leaf.md)
- `docs/plans/analysis/ANALYSIS-fulfillment-router-port.md` (readiness gate)
- `docs/plans/implementation-plan-fulfillment-context.md` (#2391, the parent slice)

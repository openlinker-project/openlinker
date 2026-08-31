# Readiness gate: `routing_decisions` intent table (#2394)

**Plan**: `docs/plans/implementation-plan-routing-decisions-table.md`
**Branch**: `2394-routing-decisions-table` (base `origin/oms-programme-wave-3a`)
**Date**: 2026-08-30

## Verdict: **READY**

No Critical findings. No reuse collision. No contract-surface break. Three minor corrections to
the plan's prose are listed below; none blocks implementation.

---

## Reuse findings

| Plan artifact | Classification | Evidence |
|---|---|---|
| `routing_decisions` table | **NEW** | every `routing_decisions` hit in the tree is documentation (DESIGN §5.3/§5.4, ADR-054, REVIEW C2, backlog); no DDL, no entity |
| `RoutingDecision*` types | **NEW** | zero TypeScript declarations repo-wide. `SalesDocumentDecision` does **not** collide — `grep RoutingDecision libs/core/src/sales-documents/` is empty |
| `deriveRouteIdempotencyKey` | **NEW** | zero code hits |
| `ROUTING_DECISION_REPOSITORY_TOKEN` | **NEW** | absent. Nearest symbols are `mappings`' `FULFILLMENT_ROUTING_REPOSITORY_TOKEN` / `FULFILLMENT_ROUTING_SERVICE_TOKEN` — different context, different question |
| `RoutingDecisionRepositoryPort` | **NEW** | absent |
| `@openlinker/core/fulfillment` subpath | **ALREADY EXISTS → reuse** | `libs/core/package.json:67-71`; no `exports` edit needed |
| `FulfillmentModule` | **PARTIAL → extend** | add entity to `forFeature`, provider, token export |
| `fulfillment.tokens.ts` | **PARTIAL → extend** | currently one binding |
| Migration prefix `1866000000000` | **NEW / free** | `1865000000000` was free when analysed but #2400 merged it into `oms-programme-wave-3a` during review, so this renumbered to `1866000000000`; max on `origin/main` is `1849000000003`. `git grep 1866000000000` empty on both refs |

### The adjacent stack that must NOT be reused — confirmed distinct

`libs/core/src/mappings` ships `IFulfillmentRoutingService`, `FulfillmentRoutingQuery`,
`FULFILLMENT_PROCESSOR_KIND`, `fulfillment_routing_rules` and a repository. Verified: it persists
**connection-scoped configured rules** and its `resolve()` is a pure lookup that **writes nothing
per order**. It answers *"by what mechanic does a label get made for this (source, deliveryMethod)?"*;
`routing_decisions` answers *"where is this order sourced from, and has that decision already been
claimed?"*. ADR-054 keeps the two layers separate and #2393's port docblock warns against wiring
one into the other. **No reuse; no rename.** The new Symbol description is
`Symbol('RoutingDecisionRepositoryPort')`, distinct from both `FulfillmentRouting*` descriptions.

---

## Backward-compatibility findings

| Surface | Assessment | Severity |
|---|---|---|
| Top-level barrel `@openlinker/core/fulfillment` | additive only — no symbol removed or renamed | none |
| Port method signatures | no existing `*Port` is modified; `FulfillmentRouterPort` untouched | none |
| DTO shapes | none touched | none |
| Symbol tokens | additive | none |
| ORM schema | new table ⇒ migration required — planned as `1865000000000`, shipped as `1866000000000` after a #2400 collision | Warning (addressed) |
| `check-cross-context-imports` | the port is **not** barrel-exported (the `ReservationRepositoryPort` precedent). Note the deny rule bites at the *import* site, not the barrel — inventory still exports two legacy repository ports — so omitting it is discipline, not a build requirement | none |
| `barrel-purity.spec.ts` leaf allow-set | stays at **two** entries: every column is a primitive or a union declared in this leaf | none |
| `check-migration-timestamps` rules 1-4 | filename prefix, class suffix and `name` property all move together at `1866000000000` | none |

---

## Corrections to the plan's prose (non-blocking)

1. **`invoiceIssueLockKey` is a function, not a constant** (`libs/core/src/invoicing/application/services/invoice-issue-lock.ts:67`). The plan's §2 alternatives reference is loose; harmless, but worth not repeating in a docblock.
2. **The unconditional history index should carry `createdAt`**, mirroring `IDX_order_changes_order` on `['internalOrderId','createdAt']` rather than a bare `("orderId")`. A history read is ordered; the composite serves both.
3. **`order_changes.insertRequested` re-selects and returns `{ inserted: false }`** where this plan throws. That difference is deliberate and should be stated in the repository docblock: `order_changes` wants the caller to *reuse* the open row, whereas a live routing decision is a **refusal** — returning the winner would invite a caller to route against another router's intent.

---

## Open questions carried to `/tech-review`

1. **`abandonReason` here or in #2395?** The plan includes it so an `abandoned` row is never
   reasonless. Counter-argument: #2395 owns the values and the column is unwritten until then.
2. **Persist the derived idempotency key?** Plan says derive-only (one source of truth).
   Counter-argument: an audit copy of what actually crossed the vendor boundary survives a change
   to the derivation.
3. **Does `terminalise` need `expectedState`?** The plan's conditional UPDATE already carries
   `state = 'live'` in its WHERE; an explicit input field would be additive.

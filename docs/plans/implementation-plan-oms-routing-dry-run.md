# Implementation plan — OMS routing dry run (#2954)

Local work only: nothing in this plan is committed, pushed or posted anywhere.

## 1. Goal and classification

Give `FulfillmentRouterPort.evaluate()` its first caller: an operator-facing, read-authorised
endpoint that returns the router's `RoutingEvaluation` for an order (or a hand-built basket)
without committing anything, plus a "test sourcing rules" panel on the sourcing-rules page.
An optional draft rule list is evaluated beside the saved ruleset so the operator can compare
before saving (decision D14).

Layers: **Integration** (`libs/oms`, the router + a pure diff), **CORE** (a shared order → router
input projection in `orders`), **Interface** (`apps/api/src/oms`), **Frontend** (`apps/web/src/features/oms`).

### Non-goals
- No `route()` call, no decision row, no idempotency key, no persistence of draft rules.
- No `pending` plan arm (W4-3), no per-method error taxonomy (W4-1/W4-2): the `error` state shows a generic message.
- No new buyer data across the port (ADR-062): the existing `RoutingInput` allowlist is reused unchanged.
- No change to the live routing paths' behaviour.

## 2. Findings from the codebase (what is reused, what is missing)

| Fact | Where |
|---|---|
| `OlFulfillmentRouter.evaluate()` and `route()` both call `evaluateRouting`; `load()` reads rules via `RoutingRuleSourcePort.listActiveRules` | `libs/oms/src/routing/ol-fulfillment-router.ts` |
| The router is obtained through `FulfillmentRouterResolverPort.resolve(connectionId)` (platform check, `holderCanExecute`) | `libs/oms/src/routing/oms-fulfillment-router.resolver.ts` |
| Order → `RoutingInput` projection exists **twice** (ingestion + `fulfillment.work.route` handler), each a private copy | `order-ingestion.service.ts` `projectOrderForRouting`, `fulfillment-work-route.handler.ts` `projectOrder` |
| Draft validation: `coerceRoutingRule` is the one coercer saved rules pass through | `libs/oms/src/routing/routing-rule.types.ts`, used by the admin service |
| Sourcing-rules controller is class-level `@Roles('admin')` with prefix `connections/:connectionId/sourcing-rules` | `apps/api/src/oms/http/oms-sourcing-rules.controller.ts` |
| Web page, API client and order search (`GET /orders?search=`) exist | `apps/web/src/features/oms`, #3507 |
| Mockup M9 is **not in the repo**; the artifact is readable | target `docs/plans/mockups/oms-mvp/m9-test-sourcing-rules.html` |

## 3. Design

### 3.1 Backend

**A. Draft rules — an optional sub-capability, not a core port change.**
Rules are `@openlinker/oms` vocabulary (REVIEW H7: opaque across the core port). Widening the core
`FulfillmentRouterPort.evaluate()` with a rules argument would put that vocabulary in core. Instead:

- `libs/oms/src/routing/draft-rule-evaluator.capability.ts` — `DraftRuleEvaluator` (`evaluateWithRules(input, rules)`) + co-located `isDraftRuleEvaluator` guard (ADR-002 sub-capability shape, as `FulfillmentStatusSource`).
- `OlFulfillmentRouter` implements it. `load()` takes an optional rules override; `route()` has no such parameter, so a committing call can never be handed a draft.
- This satisfies the AC's intent ("`route()` never accepts one, the draft is never persisted") while keeping core free of OMS rule types. The deviation from the issue's literal wording (port gains the parameter) is recorded in the PR description.

**B. Pure diff.** `libs/oms/src/routing/diff-routing-evaluations.ts` — per `orderLineId`, compares assignments (`locationId`, `quantity`) and unfulfillable entries between saved and draft; returns the lines whose placement differs. Pure, unit-tested.

**C. Shared projection (CORE, `orders`).** Extract `projectOrderForRouting(order, shippingAddressHash, storePii)` into `libs/core/src/orders/domain/` (pure, exported from the orders barrel). `orders` already depends on `fulfillment`; the reverse edge stays absent. The new service uses it. The two existing private copies are switched to it in a mechanical step (own commit-sized change, their specs must stay green); if that proves non-mechanical it is dropped and filed as a follow-up.

**D. Application service (api).** `apps/api/src/oms/application/services/routing-dry-run.service.ts` (+ `*.service.interface.ts`, token):
1. Resolve the router via `FulfillmentRouterResolverPort` for the connection; `null` → 400 with the reason (not an OMS connection / no router).
2. Build `RoutingInput` from `{ orderId }` (via `IOrderRecordService` + `orderFromReadySnapshot`, `requireBuyer: false`) **or** from a `basket` (country, optional postcode, lines `{productVariantId, quantity}`, optional delivery method) using `buildRoutingShipTo`.
3. `router.evaluate(input)`; when `draftRules` is present: coerce every draft through `coerceRoutingRule` (400 listing the invalid ones), require `isDraftRuleEvaluator(router)`, evaluate again with the draft, diff.
4. Never call `route()`; never touch `markFulfillmentBlock`/attention/any write.

**E. Controller + DTOs.** `OmsRoutingDryRunController`, `POST connections/:connectionId/sourcing-rules/dry-run`, `@Roles('admin', 'operator', 'viewer')` (the #2954 AC says read-authorised: an operator inspects before anyone arms a rule; it changes no state. Rule CRUD stays admin-only. Revised after review from an earlier admin-only decision). Request DTO: `orderId` XOR `basket`, optional `draftRules[]`. Response: `saved: RoutingEvaluation`, `draft?: RoutingEvaluation`, `changedLines?: …`, explanation rendered with the router-supplied display labels, `unfulfillable[].reason` verbatim. Register in `OmsApiModule`.

### 3.2 Frontend

- `features/oms/api/`: `routing-dry-run.api.ts`, types, TanStack mutation hook (server state), Zod schema for the response (`unfulfillable.reason` kept an opaque string).
- `features/oms/components/sourcing-rules-test-panel.tsx` rendering the six states `empty`, `picking`, `routable`, `unfulfillable`, `compare`, `error` with the `data-testid`s of the mockup; order picker reuses `GET /orders?search=` (masked buyer names); basket builder with RHF + Zod; draft = an unsaved ruleset supplied by the caller. **Deferred:** every edit on the rules page saves at once, so the page has no unsaved draft to pass and the compare toggle is reachable only in component tests until a draft-editing flow exists (follow-up).
- Mounted in `sourcing-rules-section.tsx`. No raw `fetch`, CSS tokens only, badges carry text.
- Copy in a `*.copy.ts` so `check-ui-vocabulary` covers it.
- Copy the M9 mockup into `docs/plans/mockups/oms-mvp/` (read for scripts first; it came from a shared artifact).

## 4. Steps (each tied to a file, with acceptance)

1. `libs/oms/src/routing/routing-rule.types` — confirm `coerceRoutingRule` export; add nothing unless missing. *AC: draft and saved share one coercer.*
2. `draft-rule-evaluator.capability.ts` + guard + spec. *AC: guard true only with the method.*
3. `ol-fulfillment-router.ts` — `load(input, rulesOverride?)`, `evaluateWithRules`; spec: override used, saved rules untouched, `route()` signature unchanged, `evaluate()` with no override identical to before.
4. `diff-routing-evaluations.ts` + spec (moved line, unchanged line, newly unfulfillable, split order).
5. `libs/core/src/orders/domain/…project-order-for-routing.ts` + barrel export + spec (PII on/off, no address → null, variant fallback).
6. (Mechanical) switch ingestion and the route handler to the shared function; existing specs green.
7. API service + interface + token + spec (order path, basket path, draft path, invalid draft 400, non-OMS connection 400, **asserts `route` never called**).
8. DTOs + controller + `OmsApiModule` + controller spec; `route-authorization-coverage.spec.ts` stays green.
9. Integration spec (`apps/api/test/integration`): dry run against real Postgres leaves `routing_decisions`, `fulfillment_works`, `order_records` untouched (row counts before/after).
10. Mockup file into repo.
11. Frontend api layer + schema + hook (+ tests).
12. Test panel + copy + section mount (+ tests per state).
13. Docs: one bullet in `docs/architecture-overview.md` § 26 Fulfillment; the "evaluate has no caller" note in the router docs updated.

## 5. Validation

- Architecture: no new core → oms or fulfillment → orders edge; `barrel-purity` and `check-cross-context-imports` unaffected (the shared projection lives in `orders`).
- ADR-062: the response and logs carry no buyer name/email/phone/address; basket accepts only country/postcode.
- Naming: `*.capability.ts`, `*.service.ts` + `*.service.interface.ts`, `*.controller.ts`, `*.dto.ts`, `*.copy.ts`.
- Security: DTO class-validator at the boundary; no raw SQL; guarded by global JWT + explicit `@Roles`.
- Quality gate: `pnpm lint`, `pnpm type-check`, `pnpm test`; integration spec needs Docker.

## 6. Risks and open questions

1. **Audience - decided: admin-only**, like the rules page it lives on. (The issue says only "read-authorised" and names no role.)
2. **Draft input shape.** The dry run takes a full ordered draft list (same shape as a saved rule, minus ids). How the page produces "unsaved rule order" (the mockup's own open question) is decided in the UI step: the plan assumes the rules section passes its current in-memory list.
3. **Port deviation.** Draft rules go through a guard-only sub-capability in `@openlinker/oms` rather than the core port (reason in 3.1 A).
4. **Refactor risk (step 6).** Touching the two live routing paths is optional and gated on green specs.
5. **Mockup provenance.** M9 comes from a shared artifact; it is read before being added to the repo.

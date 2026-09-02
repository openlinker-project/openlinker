# Readiness gate: `FulfillmentRouterPort` + routing I/O types + `RoutingInput` PII allowlist

**Plan**: `docs/plans/implementation-plan-fulfillment-router-port.md`
**Issue**: [#2393](https://github.com/openlinker-project/openlinker/issues/2393) (`W3a-4`) · **Epic**: #2412
**Date**: 2026-08-30
**Gate run against**: worktree `2393-fulfillment-router-port` @ `origin/oms-programme-wave-3a`

## Verdict: **READY** — with two IMPORTANT revisions to fold in during implementation

No Critical finding. No contract break. No reuse collision on any planned symbol. Two naming/consistency items below must be applied while implementing; neither changes the plan's shape, scope or file list.

---

## 1. Reuse findings

| Plan artifact | Verdict | Evidence |
|---|---|---|
| `RoutingInput`, `RoutingInputLine` | **NEW** | zero occurrences repo-wide |
| `RoutingPlan`, `ResolvedRoutingPlan`, `PendingRoutingPlan` | **NEW** | zero occurrences |
| `RoutingEvaluation` | **NEW** | zero occurrences |
| `RoutingShipTo`, `ROUTING_SHIP_TO_ALLOWED_KEYS`, `buildRoutingShipTo` | **NEW** | zero `shipto` hits (case-insensitive) anywhere in `libs`/`apps` |
| `RoutingAssignment`, `RoutingHold`, `RoutingExplanationStep`, `RoutingRuleRef`, `RoutingUnfulfillableLine` | **NEW** | zero occurrences |
| `FulfillmentRouterPort` | **NEW** | exists only as prose in `DESIGN-oms-authority-model.md` §5.3 and ADR-062 |
| `PendingRoutingPlanNotSupportedError` | **NEW** | `libs/core/src/fulfillment/domain/exceptions/` does not exist yet |
| `domain/ports/` + `domain/exceptions/` under `fulfillment` | **NEW** | current tree is `index.ts`, `fulfillment.tokens.ts`, and 4 type files (+specs) in `domain/types/` only; 25 other core contexts already carry `domain/ports/`, so the layout is conventional |
| PII allowlist projector for a ship-to address | **NEW — nothing reusable** | the only neighbour is a *redactor*, not a projector (below) |
| `hashAddress`, `getEnvBoolean` | **REUSE (confirmed importable)** | `libs/shared/src/config/`; `@openlinker/shared` is a declared dep of `libs/core` and 7 core files already import `@openlinker/shared/config` |

**The plan reinvents nothing.** `libs/oms/src` holds only an empty `OmsModule` — REVIEW H7's filter/sort names and coercer have not been started, so the plan's exclusion of them is correct and there is nothing there to extend.

### `order-address-redaction.ts` is NOT a reusable substitute

`redactAddress` blanks `city` and `postalCode` to `'[REDACTED]'` and keeps only `country` — the **opposite** of what routing needs (country + postcode + city retained in the plain arm). It is correctly excluded. What it *does* supply is the repo's established field spelling — see finding I-2.

---

## 2. Contract-surface checklist

| Surface | Result |
|---|---|
| Top-level barrels | OK — additive only; `libs/core/src/fulfillment/index.ts` gains `export *` lines, nothing removed or renamed |
| Port method signatures | OK — no existing port is touched |
| DTO shapes | OK — none; no HTTP surface in this slice |
| Symbol tokens | OK — **no token added**, so `fulfillment.tokens.ts` keeps its `export {};`, Rule 6 is not engaged, and the merge conflict anticipated with #2392 does not arise there |
| ORM schema / migration | OK — none; persistence is #2392's |
| `barrel-purity.spec.ts` (`ZERO_SIBLING_EDGE_LEAVES`) | OK — the matcher `continue`s on any specifier not starting with `@openlinker/core/`, so `@openlinker/shared/config` is invisible to it. The `fulfillment` allow-set stays at its single entry; **the plan adds none** |
| `check-no-injection-contracts.mjs` | OK — the registered `forbidden` list is the two EXACT specifiers `@openlinker/core/orders` and `@openlinker/core/inventory`; the plan imports neither and uses no `ModuleRef` |
| `check-cross-context-imports.mjs` | OK — walks `@openlinker/core/<ctx>` specifiers only |
| `CoreCapabilityValues` | OK — **`FulfillmentRouter` is absent and the plan keeps it absent.** The array's own docblock (`adapter.types.ts:24-36`) argues for that absence, a spec asserts it (`adapter.types.spec.ts:40`), and `apps/web` carries the matching comment. No manifest and no mirror script mentions it |
| Collision with sibling #2392 | OK — disjoint. #2392 owns `infrastructure/`, the migration, the repository and the token; this slice owns `domain/ports/`, `domain/types/`, `domain/exceptions/`. Only `index.ts` is shared, append-only |

---

## 3. Findings to apply while implementing

### I-1 (IMPORTANT) — a `FulfillmentRouting*` family already exists, for a *different* question

`libs/core/src/mappings` ships a shipped, HTTP-exposed **carrier/processor** routing stack: `FulfillmentRoutingQuery` / `FulfillmentRoutingResolution` / `FulfillmentRoutingRule`, `IFulfillmentRoutingService`, `FULFILLMENT_ROUTING_SERVICE_TOKEN`, `apps/api/src/mappings/http/fulfillment-routing.controller.ts` (`connections/:connectionId/routing-rules`), migration `1799000000005`. It answers *"which processor/carrier dispatches this?"*; `FulfillmentRouterPort` answers *"which location and holder sources this?"*.

The symbols do not literally collide, so this is not a blocker — but "fulfillment routing" already **means something else in this codebase**, and `ReservationService` already consumes `IFulfillmentRoutingService` for `atpEffect`. **Required**: the port file's header must name the existing family and state the distinction, so the next reader does not wire one into the other. Do not rename either.

### I-2 (IMPORTANT) — field spelling: `postalCode`, not `postcode`

The repo carries both spellings: `NormalizedAddress` (pii-hashing) uses `postcode`, while the order-side shapes a caller actually holds — `RedactableAddress` / `RedactedAddress` (`order-address-redaction.ts:25,33`) and the order snapshot — use `postalCode`. `RoutingShipTo` and `buildRoutingShipTo`'s input use **`postalCode`**, mapping to `postcode` only at the `hashAddress` boundary. ADR-062's prose ("country, postcode, city") names the *values*, not the identifier, so this is consistent with it. `ROUTING_SHIP_TO_ALLOWED_KEYS` follows.

### N-1 (NOTE) — `'routing'` is already an attention producer

`fulfillment-authority` ships `AuthorityAttentionProducerValues` including `'routing'`, whose default reason is `'line-unfulfillable'` (`authority-attention-reason.types.ts:84,327`, mirrored FE-side and by `check-attention-reason-mirror.mjs`). The unfulfillable concept therefore already has a canonical operator-facing spelling. **No import is needed** — that union is a *persisted operator state*, while `RoutingUnfulfillableLine.resolution` (`'refund' | 'return'`) is a port-level statement about how the line resolves. One cross-reference line in the docblock keeps the two from being conflated; importing it would spend the leaf's single allow-set entry for nothing.

### N-2 (NOTE) — the salt-free flag read is the right precedent, and it is documented in-tree

`getPiiConfig()` throws `PiiConfigurationError` when `OL_PII_HASH_SALT` is unset **regardless of `storePii`**, so reading the flag through it would break routing on a default deployment that never enabled hash-only mode. The plan's `getEnvBoolean('OL_STORE_PII', true)` choice is correct and has an explicit in-tree precedent with a rationale comment at `order-ingestion.service.ts:840-846`. `hashAddress` (which does call `getPiiConfig`) stays reachable only on the `storePii === false` branch, where the salt is already required for `customer_projections`.

### N-3 (NOTE) — the planned specs can assert what they claim

`libs/core/jest.config.mjs` configures `ts-jest` **without** `isolatedModules`, so full type diagnostics run: a type-level `Extract<...> extends never` assertion in a spec genuinely fails the suite red, and `tsc --noEmit` catches it too. There is no `extends never` precedent in core specs, so it is paired with the runtime key-allowlist assertion and a source scan (the `barrel-purity.spec.ts` technique) rather than relied on alone — each then fails red for its own distinct reason.

---

## 4. Open questions (recorded, non-blocking)

- `RoutingHold.reason` stays an opaque string this slice rather than importing `HoldReason` from `@openlinker/core/order-lifecycle` (design adjudication #4 wants one hold vocabulary across both grains). Resolving it means spending a **second** allow-set entry for a field with no writer; #2392/#2395 should take that decision when holds gain rows.
- `maxBatchSize` / declared freshness (REVIEW G5's other half) is outside this issue's Proposed Solution and remains unowned by any Wave-3a issue.

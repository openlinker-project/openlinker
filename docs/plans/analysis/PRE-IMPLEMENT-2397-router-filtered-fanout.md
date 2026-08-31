# PRE-IMPLEMENT — Router-filtered destination fan-out (#2397, `W3a-8`)

Read-only readiness gate against `docs/plans/implementation-plan-router-filtered-destination-fanout.md`.
Worktree `2397-router-filtered-fanout`. No production code changed.

## Verdict: **GO-WITH-CHANGES** (`NEEDS-REVISION`)

No Critical contract break, no reuse collision. Two Warnings the plan should absorb before coding:
a stale docblock claim it inherits as fact, and an operator-facing consequence of ruling 1 (b) that
the codebase already argues against three lines away.

## Reuse audit

| Plan artifact | Verdict | Evidence |
|---|---|---|
| `OrderSyncRequest.destinationConnectionIds?` | **NEW (confirmed absent)** | `libs/core/src/orders/application/interfaces/order-sync.service.interface.ts:18-33` — three fields only. Zero hits for `destinationConnectionIds` repo-wide (excl. this plan). |
| Destination filtering / "allowlist override" | **NEW — no such mechanism exists** | `resolveDestinations` has exactly one implementation, `libs/core/src/orders/application/services/order-sync.service.ts:373-384`: `listCapabilityAdapters({capability:'OrderProcessorManager'})` → `.filter(id !== source)`. No allowlist, override, or id-scoping anywhere. |
| `NoOrderDestinationsAvailableException` 3rd ctor arg | **PARTIAL (extend existing)** | `libs/core/src/orders/domain/exceptions/no-order-destinations-available.exception.ts:13-16` — 2 args today. |
| `FulfillmentRouterPort` involvement | correctly **out of scope** | Port exists (`libs/core/src/fulfillment/domain/ports/fulfillment-router.port.ts`); plan imports nothing from it. `assertRoutingPlanResolved` cited in §4.4 is real (`.../exceptions/pending-routing-plan-not-supported.error.ts:77`). |
| `libs/oms` rival definition | **none** | Zero `OrderSyncRequest` / `destinationConnectionIds` hits under `libs/oms/src`. |

## Backward-compatibility

| Surface | Finding | Severity |
|---|---|---|
| `OrderSyncRequest` shape | Adding an **optional readonly** field breaks no caller. Only one production caller (`order-ingestion.service.ts:521`) and one mock (`order-ingestion.service.spec.ts:106`); the 30 `syncOrder(...)` call sites are all in `order-sync.service.spec.ts` and all omit it. | none |
| Barrel `@openlinker/core/orders` | `index.ts:204` re-exports `OrderSyncRequest`; widening only. | none |
| `NoOrderDestinationsAvailableException` 3rd arg | **Zero external construction sites** — `new NoOrderDestinationsAvailableException(...)` appears once, `order-sync.service.ts:75`. The exception is **not exported from the orders barrel** at all, so no out-of-tree consumer can construct it. An optional 3rd arg is safe. | none |
| Assertions on the exception | Three in-repo assertion sites, all `instanceof` / `.name` / field reads, none on message text: `order-sync.service.spec.ts:319,333-334,347,798`; `apps/api/test/integration/erli/erli-orders-vertical-slice.int-spec.ts:230-238` matches on `error.name` only. Changing the **message** for case (c) is therefore safe. | none |
| Integration coverage of throw-on-zero | `erli-orders-vertical-slice.int-spec.ts:226-238` (`syncTolerateNoDestination`) deliberately **relies on the throw**. It hits case (a) (field absent), which the plan preserves — so it stays green, but any future collapse of (a) into (b) silently breaks that suite's premise. Worth naming in the plan. | Warning |
| ORM / migration / `check:invariants` | None. Intra-`orders`, no schema, no new cross-context import, no `<ctx>.tokens.ts` change. | none |

## Warnings

**W1 — the plan inherits a FALSE claim from the exception's own docblock.**
`no-order-destinations-available.exception.ts:6-7` says the exception signals *"no processor
connections, all disabled, **or the allowlist override points at a missing connection**"*. There is
no allowlist override in the tree — the third clause describes exactly the behaviour #2397 is about
to build, and has been aspirational (or a leftover) all along. It should be **corrected as part of
this slice**, not left standing beside a real third argument that now means something different;
otherwise the next reader has one docblock describing two mechanisms, one of which does not exist.

**W2 — ruling 1 (b) writes no `syncStatus` rows, and this file already argues that is bad.**
`order-ingestion.service.ts:553-566` states, about the hold case, that *"writing NOTHING is the worst
of the four here, because `syncStatus` starts empty — the order would render 'No destinations' on
`/orders`, denying that the destinations exist at all."* Case (b) produces precisely that state.
The plan's AC ("a filtered destination gets no `syncStatus[]` entry") is about *filtered* rows and is
sound; (b) is the different, whole-order case where nothing at all is written. The plan should either
state that this operator-facing consequence is accepted and why (routing-attention surfaces own it),
or route it to the follow-up it already recommends for (c). Not a blocker — but shipping it silently
contradicts a rationale sitting in the caller.

**W3 — (b) returns before the cancellation and hold gates.**
The early `return []` sits at `order-sync.service.ts:68-76`, i.e. **above** the `isCancelled` re-read
(:85) and the `getOpenHold` re-read (:117). So a router-selected-nobody order emits neither
`skipped_cancelled` nor `skipped_held`. That is consistent (there is no destination to report a skip
*for*) but is a gate-ordering fact the ingestion handler's own comment says must be re-checked when
those gates move (`order-ingestion.service.ts:576-581`). Add it to §7 rather than discovering it later.

## Confirmations for the plan's own claims

- §2 "conflict surface with #2400 is zero shared file" — **holds**: `order-ingestion.service.ts` is the
  only production caller and needs no edit for an optional field.
- §4.2 "the `listCapabilityAdapters` call is unchanged, single key" — **matches** `:375-378` today, so
  the characterisation test in §8 is assertable exactly as written.
- §4.3 "empty `results` makes ingestion's `results.map(...)` a no-op" — **holds** (`:527-529`,
  `Promise.allSettled` over an empty array).
- §5 step ordering (field before spec, to avoid a `Tests: 0 total` false red) — sound; the spec file
  is ts-jest-compiled.

## Open questions

1. Is W2's "No destinations" rendering accepted for case (b), or does it need the follow-up issue the
   plan already recommends for (c)? (Recommend: one follow-up covering both routing-attention states.)
2. Should the stale allowlist clause in the exception docblock be corrected here (recommended) or left
   to #2400?

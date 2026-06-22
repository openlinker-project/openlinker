# Pre-Implement Gate — #1161 Shop-as-source cancellation detection

**Plan:** `docs/plans/implementation-plan-1161-ps-source-cancellation-detection.md`
**Issue:** #1161 (part of #1157, ADR-027)
**Gate run:** read-only reuse + backward-compat audit against the live tree.

## Verdict: ✅ READY

No Critical or Warning contract breaks. No reuse collision that reinvents an exported symbol. The change is purely additive, intra-package (PrestaShop infrastructure), and the downstream contract (`OrderFeedEventType` union, ingestion→relay path) already accommodates the new value.

---

## Reuse findings

| Plan artifact | Classification | Evidence |
|---|---|---|
| `cancelled` `OrderFeedEventType` | **ALREADY EXISTS → reuse** (correct) | `libs/core/src/orders/domain/types/order-feed.types.ts:20` — already in the union; plan consumes, never redefines. |
| Ingestion→relay path for `cancelled` | **ALREADY EXISTS → reuse** (correct) | `order-ingestion.service.ts:194` `handleSourceCancellation` → `orderLifecycleRelay.relay({type:'cancelled'})`. No core change needed. |
| `PRESTASHOP_DEFAULT_CANCELLED_STATE_ID = 6` | **NEW (confirmed absent)** | No exported PS order-state constant exists. The cancel=6 fact lives only as **inline literals** in `prestashop-order.mapper.ts` (`:106` id→status, `:418` status→id switch). Nothing to import. |
| `prestashop-order-state.types.ts` | **NEW** | File does not exist (`infrastructure/mappers/` has only `prestashop-order.mapper.ts` + interfaces). |
| `resolveFeedEventType` private helper | **NEW** | No existing feed-event-type helper; current derivation is inline at adapter `:80`. |
| Int-spec stub seam | **ALREADY EXISTS → reuse** (correct) | `AdapterRegistryService` + `AdapterFactoryResolverService` (carrier-mapping pattern, testing-guide §Vertical-slice). |

### Reuse observation (non-blocking, already adjudicated)
The "PS default cancelled state = `6`" fact will now live in **three** places: `mapOrderStatus` (`:106`), `mapStatusToPrestashopStateId` (`:418`, a `switch` that already centralizes default-install state ids), and the new constant. The plan's `/tech-review` consciously chose **option (a)** — leave the mapper untouched rather than ship a one-of-seven extraction or widen scope to fold the whole table (plan §8). This gate concurs: the existing sites are inline literals, not a reusable export, so the new constant does not *reinvent* anything. If a single source of truth is ever wanted, `mapStatusToPrestashopStateId`'s switch is the natural consolidation target — noted for a future cleanup, not this slice.

---

## Backward-compatibility findings

| Surface | Result |
|---|---|
| Top-level barrels (`@openlinker/integrations-prestashop`, `@openlinker/core/orders`) | ✅ No change. New types file is internal to PS infra; **not** re-exported from `src/index.ts`. Constant consumed only by the adapter (same-package relative import, ≤ `../..` depth). |
| Port signature (`OrderSourcePort.listOrderFeed`) | ✅ Unchanged. Return type `OrderFeedOutput` / `OrderFeedItem` unchanged — only the *value* of the already-typed `eventType` field now exercises a pre-existing union member. |
| DTO shapes | ✅ None touched. |
| Symbol tokens | ✅ None. |
| ORM schema / migration | ✅ None — no entity change, no migration (matches plan §5). |
| `check:invariants` | ✅ Clear. `check-cross-context-imports` — no new cross-context import (`OrderFeedEventType` already imported as a type in the adapter). `check-service-interfaces` — scopes `libs/core` only, N/A. No deep-barrel imports, no migration-timestamp involvement. |
| Downstream consumers of the new value | ✅ Safe. `OrderIngestionService` already branches on `cancelled` (`:194`); job payload types `eventType` as `OrderFeedEventType`; the orders-poll handler passes it through. No switch elsewhere breaks on the now-produced value. |
| Existing PS feed spec | ✅ No regression. The line-95 `eventTypes:['cancelled']` test uses non-state-6 orders → still yields 0 items. |

---

## Open questions
None blocking. One forward-looking note (already in plan §7): detection keys on default state id `6`, so renumbered-state installs are undetected — documented v1 limitation, name-resolution is the tracked follow-up. No decision required to implement this slice.

# Implementation Plan — Order-status relay completion (#1168, #1169, #1170)

**Branch:** `1168-1169-1170-order-status-relay-completion`
**Epic:** #1157 / ADR-027 (Order status writeback capability & lifecycle relay)
**Layer:** CORE (orders capability removal, shipping orchestration) + Integration (Allegro adapter) + Tests

This is the tail of the #1157 / ADR-027 relay epic. Slices #1158 (inbound cancel → destination), #1159 (Allegro `write()` + role-agnostic relay), #1160 (branch-1 dispatch → source), #1161 (shop-as-source cancel detection) have all merged. The three remaining children:

| # | Title | Effort | Order |
|---|---|---|---|
| #1170 | Branch-1 destination-shop cancellation → source via the relay | S | 1st |
| #1169 | Integration test — branch-1 dispatch → source relay (end-to-end) | S | 2nd |
| #1168 | Retire `OrderDispatchNotifier` — fold operator-dispatch into the relay | M | 3rd |

Implemented in S→S→M order: #1170 extends the same `FulfillmentStatusSyncService` hook #1160 added; #1169 then covers both dispatch (its AC) and the new cancel path in one int-spec; #1168 is the cross-cutting refactor done last so the int-spec exists to catch regressions.

No ORM-entity changes → **no migration**.

---

## 1. #1170 — Branch-1 shop cancellation → source relay

### Goal
When the destination **shop** cancels a branch-1 (OMP-fulfilled, no OL label) order, relay `{type:'cancelled'}` to the order's source marketplace via the lifecycle relay — exactly once — mirroring #1160's dispatch hook. Distinct from #1158 (inbound source-cancel → destination) and #1161 (shop-as-source cancel in the feed).

### Design
`FulfillmentStatusSyncService` (`libs/core/src/shipping/application/services/fulfillment-status-sync.service.ts`) is already the sole branch-1 `Shipment` creator/updater and already injects `ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN` (used by `relayDispatchedToSource`). The relay + both adapters already support `cancelled` (`AllegroOrderSourceAdapter.write` → `CANCELLED`; `PrestashopOrderProcessorManagerAdapter.write` → cancel-with-refuse-if-shipped). So this is a pure orchestration-hook addition — no new ports, no adapter changes.

### Steps
1. **Add transition-gate helpers** (mirror `isInitialDispatch` / `isFirstDispatchTransition`):
   - `isInitialCancel(status): boolean` → `status === FULFILLMENT_STATUS.Cancelled` (a branch-1 row **born** cancelled is the first cancel transition).
   - `isFirstCancelTransition(patch): boolean` → `patch.status === SHIPMENT_STATUS.Cancelled`. `diffPatch` only sets `patch.status` when it changed, so any `patch.status === Cancelled` is by construction the first entry into cancelled → at-most-once across re-polls with no separate ledger (same mechanism as dispatch).
2. **Add `relayCancelledToSource(internalOrderId, originConnectionId)`** mirroring `relayDispatchedToSource`: best-effort `relay({ internalOrderId, originConnectionId, event: { type: 'cancelled' } })`, identifier-mapping-level throw caught + logged so one order never breaks the sync loop. No `reason` (the branch-1 snapshot carries none).
3. **Wire the hooks** in `sync()`:
   - CREATE branch: after `createBranchOneShipment` + projection, `if (isInitialCancel(snapshot.status)) await this.relayCancelledToSource(record.internalOrderId, connectionId)`.
   - UPDATE branch: inside the `Object.keys(patch).length > 0` block, after projection, `if (isFirstCancelTransition(patch)) await this.relayCancelledToSource(...)`.
   - Both sit alongside the existing dispatch hooks; dispatch and cancel are mutually exclusive per snapshot (`diffPatch` produces one terminal status).
4. **Marketplace-rejection surfacing (AC):** the relay's `writeToTarget` already logs non-`applied` outcomes at `warn` (`'cancelled' rejected on …`). `relayCancelledToSource` relies on that — a cancel-after-sent that Allegro/PS refuses is a logged `rejected`, never a silent drop. (No extra inspection needed; matches the dispatch helper's contract.) **AC coverage caveat:** the unit spec mocks `IOrderLifecycleRelayService`, so it cannot observe the relay's internal `warn`. Cover the rejection-surfacing AC at the **int-spec** layer instead — have the source stub return `{outcome:'rejected'}` and assert the sync loop completes without throwing and does not re-fire on the next pass.

### Unit tests (`fulfillment-status-sync.service.spec.ts`)
- Branch-1 row **born cancelled** → `relay({cancelled})` once.
- Existing row transitions dispatched→cancelled (or active→cancelled) → `relay({cancelled})` once.
- Re-poll with unchanged `cancelled` status → empty patch → **no** re-fire.
- Relay throw is swallowed (sync loop continues, `failed` not incremented for a relay-only error).
- Dispatch path unaffected (regression).

### Acceptance criteria
- [ ] Branch-1 shop cancellation relays `{cancelled}` to source once; re-polls don't re-fire.
- [ ] Marketplace rejection surfaces as a logged `rejected`.
- [ ] Unit + integration green.

---

## 2. #1169 — Integration test: branch-1 dispatch → source relay (+ cancel)

### Goal
A Testcontainers int-spec proving the branch-1 relay reaches a **source** `OrderStatusWriteback` through **real identifier mappings** — the one thing unit tests mock. Covers dispatch (the #1169 AC) and, since #1170 lands in the same branch, a cancel case for reinforcement.

### Design
New `apps/api/test/integration/fulfillment-status-sync-relay.int-spec.ts`. The existing `dispatch-notify-test-stubs.helper.ts` is the wrong shape (it stubs `OrderDispatchNotifier`/`OrderFulfillmentUpdater`, and after #1168 those go away). Author a **new branch-1 relay stub helper** (`fulfillment-relay-test-stubs.helper.ts`) registering, via the real `AdapterRegistry` + `AdapterFactoryResolver` plugin seam:
- a **destination** adapter: `OrderProcessorManagerPort` + `FulfillmentStatusReader` returning a scripted `{status, trackingNumber, deliveredAt?}` snapshot (drives the branch-1 read), recording its reads;
- a **source** adapter: `OrderSourcePort` + `OrderStatusWriteback` recording each `write(event)` call.

The destination snapshot is settable per-test (`stubs.dest.nextSnapshot = {...}`) so one harness covers dispatched + cancelled.

### Seeding (reuse existing fixtures/helpers)
- `createTestConnection` for source (allegro platformType) + destination (prestashop) + a branch-1 routing rule (`FULFILLMENT_PROCESSOR_KIND.OmpFulfilled`, `processorConnectionId = null` fan-out default) via the routing service.
- `createTestOrderRecord` mirrored to the destination connection (`syncStatus` with the dest external id, `recordStatus: 'ready'`, `sourceConnectionId` = source) — the shape `FulfillmentStatusSyncService.sync` pages.
- Order→source **and** Order→destination identifier mappings via `IIdentifierMappingService.createMapping(CORE_ENTITY_TYPE.Order, …)` so `relay.getExternalIds` resolves the source target (origin = destination connection, excluded).

### Harness specifics
- The spec resolves `FulfillmentStatusSyncService` directly via `harness.getApp().get(SYNC_TOKEN)` and drives `sync()` — it does **not** need `loginAsAdmin` (no HTTP auth path). Only call `loginAsAdmin` if a seed helper requires an authenticated request, and then **at most once per test** (the fixed-admin INSERT trips a unique-constraint on a second call).
- Stub `supportedCapabilities` must match the relay's resolution path: source stub `['OrderSource']`, dest stub `['OrderProcessorManager']`. The relay's `resolveWriteback` tries `OrderProcessorManager` then `OrderSource` per target; the source (allegro) connection rejects `OrderProcessorManager` (`CapabilityNotSupported`) and falls through to `OrderSource` → narrows via `isOrderStatusWriteback` → `write`.

### Cases
1. **Dispatch:** dest snapshot `{status:'dispatched', trackingNumber:'T1'}` → run `sync(destConnId, {limit})` → assert source stub `write` called once with `{type:'dispatched', externalOrderId: <source ext id>, trackingNumber:'T1'}`.
2. **At-most-once:** second `sync()` pass, unchanged snapshot → assert source stub **not** re-called (transition gate).
3. **Cancel (#1170 reinforcement):** dest snapshot `{status:'cancelled'}` (fresh order) → assert source stub `write` called once with `{type:'cancelled', externalOrderId}`; re-poll → no re-call.

### Acceptance criteria
- [ ] Int-spec proves branch-1 dispatch reaches source `OrderStatusWriteback` through real identifier mappings.
- [ ] Re-poll (unchanged) does not re-fire.
- [ ] `pnpm test:integration` green.

---

## 3. #1168 — Retire `OrderDispatchNotifier`; fold operator-dispatch into the relay

### Goal
`ShipmentDispatchNotificationService.notifyDispatched` (the #837 operator-dispatch path for OL-managed shipments) drives cross-system writes through `OrderLifecycleRelayService` / `OrderStatusWriteback` instead of the direct `isOrderDispatchNotifier` + `notifyDispatched` (source, A) and `isOrderFulfillmentUpdater` + `updateFulfillment` (destination, B) calls. Then remove `OrderDispatchNotifier` / `isOrderDispatchNotifier` and the Allegro adapter's `notifyDispatched`. **No change** to the `POST /shipments/:id/notify-dispatched` endpoint contract.

### Key design decision — the "origin" of an operator-initiated dispatch
The relay excludes the event's `originConnectionId` from its targets. An OL-managed shipment isn't tied to a source-feed origin — the operator (OL) is the origin. **Resolution:** pass `shipment.connectionId` (the **carrier** connection, e.g. InPost/DPD) as `originConnectionId`. In practice a carrier connection is a `ShippingProviderManager`, never an `OrderSource`/`OrderProcessorManager`, so it does not appear in `getExternalIds(Order, …)` → it excludes **nothing** → the relay writes to the source marketplace **and** all destination shops in one call. This is the correct semantic: an operator dispatch must tell every participant "shipped + tracking."

**Limitation (accepted, documented):** the exclusion-is-empty property holds by capability disjointness, **not** by a hard constraint — nothing in the schema forbids a single `Connection` that multiplexes a carrier role *and* an order-participant role. If such a connection ever existed, passing it as origin would silently skip that participant from the relay. No such multiplexed connection exists today; if one is introduced, revisit this with an explicit "operator-origin" sentinel rather than the carrier id. Keep `shipment.connectionId` for now (honest + useful in relay logs). A code comment at the call site must carry this caveat.

### Behavior preservation
ADR-027 migration path is explicit: the relay subsumes **both** the source `notifyDispatched` and the destination `updateFulfillment` this service performs today.
- Source (Allegro): `write({dispatched})` reuses the same `markSent` helper as `notifyDispatched` → identical wire effect.
- Destination (PrestaShop): `write({dispatched})` delegates to the same `updateFulfillment({status:'shipped', tracking})` internals → identical wire effect.

So routing both through one `relay({dispatched, trackingNumber, carrier})` call is behavior-preserving. The relay forwards the carrier hint via `event.carrier`.

**One benign behavioural delta (not a regression):** today the order is strictly A (source `notifyDispatched`) then B (destinations `updateFulfillment`). The relay iterates `getExternalIds` targets and tries `['OrderProcessorManager','OrderSource']` per target, so a **destination may now be written before the source**. There is no cross-participant ordering dependency for `dispatched`, and both writes are idempotent, so this is acceptable — flagged here so it isn't mistaken for a regression in review.

**Removal is safe — only Allegro implements `OrderDispatchNotifier`** (grep-verified: `WooCommerce`/`PrestaShop` order-processor adapters implement `OrderFulfillmentUpdater`, which is retained). So deleting the capability + Allegro's `notifyDispatched` leaves no other adapter dangling, which is what makes the "no remaining references" AC verifiable.

**Response DTO + advance-gate preserved** by re-labelling the relay's role-agnostic per-target results by `connectionId` after the call:
- the target whose `connectionId === record.sourceConnectionId` → `source` outcome (`applied`→`ok`, `rejected`→`failed`, missing/`unsupported`→`absent`);
- all others → `destinations[]` (`applied`→`ok`, `rejected`→`failed`, `unsupported`→`unsupported`).
- Advance `generated → dispatched` iff the source outcome ∈ {`ok`,`absent`} — the **unchanged** rule (`source === 'ok' || 'absent'`). Destinations stay best-effort. `ShipmentDispatchNotificationResult` shape is unchanged → endpoint response identical.

The status-gate (`shipment.status === 'generated'`) and carrier-hint resolution stay in the service; only the two cross-system write blocks (`notifySource` / `updateDestinations`) are replaced by one relay call + result re-labelling.

### Steps
1. **`ShipmentDispatchNotificationService`** (`…/shipping/application/services/shipment-dispatch-notification.service.ts`):
   - Inject `ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN` (`IOrderLifecycleRelayService`); drop the `IIdentifierMappingService` injection (the relay now owns external-id resolution) — verify no other use first.
   - Replace `notifySource` + `updateDestinations` with: resolve carrier hint → `relay({ internalOrderId: shipment.orderId, originConnectionId: shipment.connectionId, event: { type:'dispatched', trackingNumber: shipment.trackingNumber ?? undefined, carrier } })` → re-label targets by connectionId into the existing `{source, destinations}` result → advance status on source ∈ {ok,absent}. The re-labelling reads `record?.sourceConnectionId` to identify the source target; a null `record` (order record not found) → no source target matched → source `absent` → advance (matches today's `!record?.sourceConnectionId → 'absent'` path). Add the origin-caveat code comment from the "Key design decision" section at the `relay(...)` call site.
   - Remove `isOrderDispatchNotifier` / `isOrderFulfillmentUpdater` / `OrderSourcePort` / `OrderProcessorManagerPort` imports now unused.
   - **Type placement:** if the re-labelling needs named outcome types, do **not** add new inline `type` aliases (engineering-standards: types live in `*.types.ts`). Reuse the existing `ShipmentDispatchNotificationResult` shape from `shipment-dispatch-notification.types.ts`; the current inline `SourceOutcome`/`DestinationOutcome` are a pre-existing deviation — don't widen it.
   - Update the file header (cross-system writes now via the relay).
2. **Module wiring:** confirm `ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN` is resolvable in the shipping module (it already is — `FulfillmentStatusSyncService`, same module, injects it). Add provider import if needed.
3. **Allegro adapter** (`allegro-order-source.adapter.ts`): remove `notifyDispatched` + the `OrderDispatchNotifier` from the `implements` clause and the import; keep `markSent` (feeds `write`). `write({dispatched})` already covers the behaviour.
4. **Remove the capability:** delete `order-dispatch-notifier.capability.ts`; drop its two barrel exports from `libs/core/src/orders/index.ts` (lines 23–24) and the now-stale `#837` comment.
5. **Tests / harness updated:**
   - `dispatch-notify-test-stubs.helper.ts`: source stub → `OrderSourcePort & OrderStatusWriteback` (drop `OrderDispatchNotifier`, add `write` recording into `source.calls`); dest stub → keep `OrderFulfillmentUpdater.updateFulfillment` (still used by the out-of-scope `ShipmentStatusSyncService`) **and** add `OrderStatusWriteback.write` recording into `dest.calls`. Rename call types if needed.
   - `shipment-dispatch-notification.int-spec.ts`: assert relay `write({dispatched})` reached source + dest stubs (was `notifyDispatched`/`updateFulfillment`); carrier hint still asserted via `write` event.
   - `shipment-status-sync.int-spec.ts`: the `notificationService().notifyDispatched()` call now relays; update the dest assertion from `updateFulfillment` to `write`.
   - `shipment-dispatch-notification.service.spec.ts` (unit): rewrite to mock `IOrderLifecycleRelayService` instead of source/dest adapters. Enumerated cases (`should … when …`):
     - relay called **once** with `originConnectionId === shipment.connectionId` and `{ type:'dispatched', trackingNumber, carrier }`;
     - source target `applied` → advances to `dispatched`;
     - source target `rejected` → stays `generated` (retriable);
     - no source target present → source `absent` → advances;
     - non-`generated` shipment → status-gate short-circuits, relay **not** called.
   - `allegro-order-source.adapter.spec.ts`: fold the `notifyDispatched (#837)` describe into `write({dispatched})` assertions (markSent + waybill + carrier).
   - `dispatch-notify-capabilities.spec.ts`: remove the `isOrderDispatchNotifier` describe (delete the file if it only covered that guard).
6. **Doc touch-ups (in-repo only):** `notify-dispatched-response.dto.ts` comment (line ~44 — replace the `OrderDispatchNotifier` mention with `OrderStatusWriteback`); `architecture-overview.md` only if it names `OrderDispatchNotifier`. **Scope note:** the "#1031 capability-table reference" lives in the **body of GitHub issue #1031**, not a repo file — a code PR can't/shouldn't edit it. If it's stale after merge, note it in the PR description rather than treating it as a file edit.

### Out of scope (explicit)
- `ShipmentStatusSyncService` (#871, branch-2/3 tracking → destination via `OrderFulfillmentUpdater`) is **not** migrated — different trigger, not in #1168's scope; `OrderFulfillmentUpdater` is **retained** (provisioning + #871).
- `OrderFulfillmentUpdater` / `isOrderFulfillmentUpdater` stay (ADR-027: retained for provisioning).

### Acceptance criteria
- [ ] Operator dispatch of an OL-managed shipment propagates sent + tracking to the source via `OrderStatusWriteback`; endpoint behaviour unchanged.
- [ ] `OrderDispatchNotifier` / `isOrderDispatchNotifier` / Allegro `notifyDispatched` removed; no remaining references.
- [ ] `OrderFulfillmentUpdater` retained.
- [ ] Unit + integration tests updated; full `pnpm test:integration` green.

---

## 4. Validation / risks

- **Architecture:** capability removal + orchestration rewiring; no new ports/DI tokens/ORM. Cross-context surface unchanged (relay consumed via `I*Service` + Symbol token, already in use). `check:invariants` unaffected.
- **Risk — advance-gate semantics (#1168):** re-labelling preserves the exact "advance iff source ok/absent" rule; destinations stay best-effort. Covered by the rewritten unit spec + the two int-specs.
- **Risk — shared stub helper (#1168):** `dispatch-notify-test-stubs.helper.ts` feeds two int-specs (`shipment-dispatch-notification`, `shipment-status-sync`). Both must stay green after the stubs gain `write`. Run the full `pnpm test:integration`, not just the new spec (per lessons: manifest/capability/routing ripple).
- **Risk — Allegro `write` vs removed `notifyDispatched`:** `write({dispatched})` and `notifyDispatched` share `markSent`; the 409-idempotency + waybill-attach behaviour is identical. Fold the adapter spec rather than delete coverage.
- **Quality gate:** `pnpm lint && pnpm type-check && pnpm test`, then `pnpm test:integration`. Rebuild libs dist after any pull (`pnpm -r --filter "./libs/**" build`) before type-check.

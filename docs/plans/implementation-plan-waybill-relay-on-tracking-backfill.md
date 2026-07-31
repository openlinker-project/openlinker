# Implementation Plan — relay the waybill to every order participant when the carrier mints it late (#1947)

## 1. Understand the task

**Goal.** A tracking number that arrives *after* the operator dispatched a shipment must reach the **order source** (and every other order participant), not just the destination shops. Today it reaches destinations only, so an Allegro-sourced order stays permanently without a waybill.

**Layer.** CORE (`libs/core/src/shipping`, application layer). No Integration change, no schema change, no FE change.

**The defect in one line.** `ShipmentStatusSyncService`'s `null → value` tracking backfill pushes through `OrderFulfillmentUpdater` to `record.syncStatus` **destinations** only; the order **source** has no path back once `ShipmentDispatchNotificationService`'s `generated`-only gate has closed.

**Non-goals.**
- Durable per-destination notify state (#861) — not needed here; see §3.2 for why the `null → value` transition already bounds the relay to at-most-once.
- Changing the `if (trackingNumber)` guard in `AllegroOrderSourceAdapter.markSent` — it is correct.
- Re-opening the `generated`-only gate on `notifyDispatched`.
- Any new column, migration, or entity field.

## 2. Research — what already exists

| Fact | Where |
|---|---|
| The relay is the canonical one-writer-per-participant seam (ADR-027 / #1157 / #1168) | `libs/core/src/orders/application/interfaces/order-lifecycle-relay.service.interface.ts` |
| `ShipmentDispatchNotificationService` already consumes it, and its header records that #1168 **subsumed** the former split "source notify + destination `updateFulfillment`" into the single relay | `shipment-dispatch-notification.service.ts:80-86` |
| `ShipmentStatusSyncService.pushTrackingToOmps` is the **last surviving pre-#1168 destination-only path** — it resolves `OrderProcessorManager` + `isOrderFulfillmentUpdater` and never touches the relay | `shipment-status-sync.service.ts:303-350` |
| Both destination adapters implement `OrderStatusWriteback` **and** `OrderFulfillmentUpdater`, and their `write({type:'dispatched'})` delegates verbatim to `updateFulfillment({status:'shipped', trackingNumber})` | `prestashop-order-processor-manager.adapter.ts:791-799`, `woocommerce-order-processor.adapter.ts:281-297` |
| `ShippingModule` already imports `OrdersModule`, which exports `ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN` | `shipping.module.ts:27,77`; `orders.module.ts:89,100` |
| Carrier-hint resolution already exists as a private method — needed by the relay so Allegro maps a real `carrierId` instead of falling back to `OTHER` + `'Carrier'` | `shipment-dispatch-notification.service.ts:~205` (`resolveCarrierHint`), `allegro-order-source.adapter.ts:176-183` |
| A bare non-service helper colocated in `application/services/` is established precedent | `shipment-dispatch-lock.ts` |

**Decisive consequence of row 4:** for destinations, swapping `updateFulfillment` for the relay is behaviourally *identical* — the adapter's own `write` is a one-line delegation to it. So converging on the relay is not a behavioural risk to destinations; it is purely additive reach to the source.

## 3. Design

### 3.1 Replace the destination-only push with the relay

In `ShipmentStatusSyncService`, delete `pushTrackingToOmps` and relay instead:

```ts
await this.orderLifecycleRelay.relay({
  internalOrderId: shipment.orderId,
  originConnectionId: shipment.connectionId,  // carrier connection — never an order participant (#1168)
  event: { type: 'dispatched', trackingNumber: newTrackingNumber, carrier },
});
```

One call now reaches the source **and** every destination, matching what `notifyDispatched` does. `IOrderRecordService` is dropped from the constructor — see §3.3d for why it has no remaining use in this file.

### 3.2 At-most-once, without new state

`newTrackingNumber` is non-null only on a `null → value` transition, which happens **exactly once per shipment lifetime** (the field is never overwritten — same discipline as `carrier`, `shipment-status-sync.service.ts:255-259`). That transition *is* the durable "waybill newly known" marker. No column, no migration, no #861 dependency.

The duplicate `PUT …/fulfillment SENT` the relay causes is harmless: `markSent` treats 409 / "already sent" as success (`allegro-order-source.adapter.ts:139-149`), PrestaShop's state transition is guarded, WooCommerce's is idempotent.

### 3.3 Retry semantics for `trackingNumber` revert to exactly today's

> **History, kept because each rejection encodes a real constraint.** Draft 1 relayed *alongside* the existing destination push — rejected: destinations implement both capabilities, so they would be notified twice. Draft 2 gated retry on the source outcome only — rejected by two independent reviews: one transient destination blip on the single tick where the waybill appears permanently loses destination tracking. Draft 3 kept all-or-nothing and leaned on Allegro 409-idempotency — rejected: rests on unverified external behaviour and still lets a broken destination hammer a create endpoint. The marker column below is what all three failures were pointing at.

With the marker owning at-most-once for the source, the `trackingNumber` retry rule needs **no change at all** from today (`:287-294`): include it in the patch iff every target succeeded, otherwise drop it so the next poll re-diffs. Destinations keep their current best-effort-with-retry behaviour verbatim, and a retry can no longer re-drive the source because the claim is already consumed.

The guards below remain, each for the reason stated.

#### 3.3-DECISION `shipments.waybill_relayed_at` is the at-most-once mechanism

> **Final design, chosen after four review rounds.** Every rejected variant failed for the same underlying reason: `Shipment.trackingNumber` was serving as **both the data and the retry marker**. That overload forces a choice between "retry and risk a duplicate waybill at the marketplace" and "don't retry and permanently lose the number". Splitting the two roles removes the dilemma instead of picking a side.

One nullable column:

```sql
ALTER TABLE shipments ADD COLUMN waybill_relayed_at timestamptz NULL;
```

Semantics:

- **`trackingNumber` becomes pure data.** It is persisted as soon as it is known, unconditionally. Destination push/retry semantics therefore stay **byte-identical to today** — no regression, and none of the "one transient failure loses destination tracking" hazard that killed the source-only gate.
- **`waybillRelayedAt` is the source-relay claim.** The relay fires only while it is `NULL`, and is stamped after the source reports `applied`. At-most-once becomes a **database fact**, not an inference from a mutable field.

What this closes, all at once:

| Previously-open problem | Closed by |
|---|---|
| Unbounded duplicate `POST …/shipments` on a permanently-failing participant | the claim is consumed once; a retry cannot re-drive the source |
| Unserialized poll-vs-webhook race producing two waybill POSTs | conditional claim (`WHERE waybill_relayed_at IS NULL`) — the loser writes nothing |
| Dependence on an unverified Allegro dedup behaviour | no longer load-bearing; the probe becomes a nice-to-have |
| Destination retry regression | avoided — `trackingNumber` keeps its current role verbatim |

It is also a strictly smaller step toward **#861** than a competing half-measure would be: #861 generalises this single marker into per-destination state, so this column is the first row of that model rather than something to unwind.

Cost: one migration. Accepted deliberately (the user's call) over waiting on a live sandbox probe.

#### 3.3a Idempotent waybill attach in the Allegro adapter — defence in depth

The retry loop is harmless for destinations (PrestaShop's transition is state-guarded, WooCommerce's PUT is idempotent) but **not** for the source: the waybill POST has no 409-as-success branch — only the fulfillment PUT does (`allegro-order-source.adapter.ts:139-149`) — and its own catch rethrows unconditionally (`:159-161`). Left alone, a permanently-failing participant would re-issue `POST /order/checkout-forms/{id}/shipments` every tick forever.

> **Revised again.** The first attempt invented a `GET /order/checkout-forms/{id}/shipments` read-before-write. That was an unverified assumption about an external API — and unnecessary, because **the repo already solved this exact problem in the Erli adapter**. Use the in-tree precedent, not a new invention.

`ErliOrderSourceAdapter.markDispatched` (`erli-order-source.adapter.ts:658-707`) is the structural twin of `markSent`: status write, then a conditional external-shipment registration. It makes the *second* step retry-safe two ways:

```ts
// erli-order-source.adapter.ts:692
await this.httpClient.post(ERLI_EXTERNAL_SHIPPING_PATH, shipmentBody, { idempotent: true });
// :694-701 — and 409 on THAT post is treated as success:
//   "A 409 here means the shipment is already registered — e.g. a retry after a
//    partial success where the status PATCH landed but this POST's response was
//    lost. Treat it as success so the job converges instead of failing
//    permanently while the shipment is in fact registered (PR1082-TECH-03)."
```

That comment describes #1947's retry scenario verbatim, and it was written for a review finding on a *different* PR. Mirror it:

1. **Extend `isAlreadySentOrStale` handling to the waybill POST**, not just the fulfillment PUT. One-line change at `allegro-order-source.adapter.ts:159-161`; the predicate already exists (`:155-160` in the Erli twin, `isAlreadyDispatchedOrStale`).
2. **Give the Allegro HTTP client Erli's `idempotent` transport flag** — or, if that is too wide a change for this branch, note the gap explicitly. Erli's client has it (`erli-http-client.types.ts:55`, `erli-http-client.ts:135-136`: POST is fail-fast on transport error unless opted in); the Allegro client has **no equivalent** (zero `idempotent` hits under `libs/integrations/allegro/src/infrastructure/http/`). Without it, a lost-response POST cannot be safely retried at the transport layer — which is precisely how a duplicate waybill gets created.

This keeps at-most-once a *property of the call* (the goal) while resting on a shipped, reviewed in-repo pattern instead of an assumed endpoint. It covers the retry loop, the unserialized webhook/cron detection race, and the §5 sandbox question — and the probe narrows from "does a GET exist and what shape does it return?" to the far smaller "what status does Allegro return on a duplicate waybill POST?"

#### 3.3b `unsupported` must not swallow a transient connection failure

`OrderLifecycleRelayService` returns `unsupported` for **two** unrelated conditions, distinguished today only by a `detail` string:

```ts
// order-lifecycle-relay.service.ts:97   ← connection-level throw: disabled, not-found, credentials
return { connectionId, outcome: 'unsupported', detail: 'adapter unresolved' };
// order-lifecycle-relay.service.ts:105  ← structural: this participant has no writeback capability
return { connectionId, outcome: 'unsupported', detail: 'no order-writeback capability' };
```

Today that conflation is harmless (`pushTrackingToOmps` just `continue`s past a non-`OrderFulfillmentUpdater` destination). With the source in the set it becomes data loss: disable the Allegro connection for ten minutes of re-auth, let one poll land in that window, and the source target comes back `unsupported` → treated as vacuously done → `trackingNumber` persisted → the diff never fires again. **#1947 reproduced, silently.**

Fix: add an optional discriminator to `OrderLifecycleRelayTargetResult` (e.g. `unsupportedReason: 'no-capability' | 'adapter-unresolved'`) — an orders-context internal result type, **not** the adapter-facing `OrderWritebackOutcome` union (`order-lifecycle-event.types.ts:52-53`).

**Why the union must not be widened** (review round 3): `ShipmentDispatchNotificationService.resolveSourceOutcome` ends in `default: return 'absent'` (`:195-202`), and `absent` **advances the shipment to `dispatched`** (`:124-129`). A new outcome value would silently land in that default — so a momentarily-unresolvable Allegro connection at dispatch time would push the shipment past the at-most-once gate, never mark-sent, never retried. That is this same bug class, on the *primary* path.

**Therefore the sibling service is updated in the same change**: `resolveSourceOutcome` must map `unsupported / adapter-unresolved` to `'failed'` (leaves the shipment `generated`, retriable), not `'absent'`. This is a latent defect that exists today and that the discriminator finally makes fixable — worth doing here because the plan is already touching both services.

Then, for the retry classification:

| Target result | Counts as failure (⇒ retry)? |
|---|---|
| `applied` | no |
| `unsupported` / `no-capability` (structural — incl. Erli gated off, `erli-order-source.adapter.ts:559-562`) | no — matches today's `continue` |
| `unsupported` / `adapter-unresolved` (disabled, unreachable, credential failure) | **yes** |
| `rejected` | **yes** |
| relay throws before the per-target loop | **yes** |

#### 3.3c Terminal-status guard

Step 1 patches `status` from the snapshot (`:231-247`); the push gate then reads the **pre-patch** `shipment.status` (`:280`). So a `dispatched` shipment whose snapshot arrives as `{status: 'cancelled', trackingNumber: '68…'}` would relay `dispatched` — marking the Allegro order SENT and attaching a waybill for a parcel that will never move, plus a buyer "shipped" notification. Today the blast radius is one shop's status; after this change it reaches the marketplace and the buyer.

Skip the relay for **`cancelled` and `failed` only** — never for `delivered`, and still persist `trackingNumber` in every case.

> **Corrected after review round 3.** The first wording said "skip when `patch.status` is a terminal outside `PUSH_GATE_OPEN_FROM`". That **reintroduces #1947** on the fastest-moving orders: `delivered` is also a terminal (`shipment-status.types.ts:67`) and, with a 30-minute poll plus tracking minted at confirmation, one snapshot can legitimately carry `status: delivered` *and* the first non-null tracking number. Skipping there while persisting `trackingNumber` consumes the `null → value` diff and the waybill is lost forever — precisely the bug being fixed.
>
> The sibling service already decided this correctly, and must be matched rather than contradicted:
> ```ts
> // fulfillment-status-sync.service.ts:123-125
> function isInitialDispatch(status: FulfillmentStatus | null): boolean {
>   return status === FULFILLMENT_STATUS.Dispatched || status === FULFILLMENT_STATUS.Delivered;
> }
> ```
> A delivered parcel unambiguously shipped, so the source must be told. Only `cancelled` / `failed` mean "do not announce this as a dispatch".

#### 3.3c-bis What actually bounds the retry — state it honestly

Nothing counts attempts. Verified: the relay throw is swallowed inside `buildPatchAndMaybePush`, so `failed` never increments and the worker handler always returns `{outcome: 'ok'}` (`marketplace-shipment-status-sync.handler.ts:80`) — the sync-job retry/backoff machinery never sees this path at all. `SCAN_STATUSES` keeps a `dispatched` shipment in the scan set until the carrier reports a terminal (`:78-82`), which for a lost parcel can be never. There is no attempt counter on `shipments`.

So the retry is bounded only by **the shipment reaching a terminal status**, i.e. potentially days of 30-minute ticks.

This is a **pre-existing property**, not something this change introduces: today a permanently-broken destination is already re-called on every tick by `pushTrackingToOmps`. What the change does is re-aim those repeats at a *create*-shaped call (the Allegro waybill POST) instead of an idempotent status write. Which is exactly why §3.3a is not optional garnish — it is the thing that keeps a pre-existing traffic pattern from becoming a data-corruption pattern.

Consequence for sequencing: **if the sandbox probe shows Allegro does not 409 a duplicate waybill, this design is not shippable as-is** and the `shipments.waybill_relayed_at` marker (§5, fallback 2) becomes mandatory rather than optional. Do not implement §3.3a on the assumption; probe first.

A per-attempt cap or backoff is deliberately **not** added here: it needs durable per-participant state, which is #861's scope, and inventing a second half-measure alongside the existing one would make the eventual #861 migration harder.

#### 3.3d Consequence: `IOrderRecordService` is dropped

With all-or-nothing restored there is no need to identify which target is the source, so `record.sourceConnectionId` is not needed. `orderRecords` is used at exactly **one** site in this file — `:307`, inside the method being deleted — so the dependency leaves the constructor. (The earlier draft claimed it was still needed for `fulfillmentProjection.recompute`; that is wrong — `recompute` comes from `ORDER_FULFILLMENT_PROJECTION_SERVICE_TOKEN`, `:106-107`.)

### 3.3e The relay must not swallow the terminal-status patch

`pushTrackingToOmps` catches everything and never throws (`:334-347`); `relay()` **can** throw before its per-target loop (`getExternalIds`, `order-lifecycle-relay.service.ts:61-64`). Unhandled, that propagates out of `buildPatchAndMaybePush` into `sync`'s per-shipment catch (`:158-163`) and discards the *whole* patch — including `status: delivered/failed/cancelled`, `deliveredAt`, and the `carrier` backfill — and skips `fulfillmentProjection.recompute`. Wrap the call the way `fulfillment-status-sync.service.ts:477-488` does and treat a throw as a source failure.

### 3.4 Keep the dispatched-gate

`PUSH_GATE_OPEN_FROM = [dispatched, in-transit]` stays. At `generated` we still only backfill the field — `notifyDispatched` owns that transition and already reads the row. Unchanged.

### 3.3f Erli has the same defect, one degree worse — and it makes the carrier hint load-bearing

`ErliOrderSourceAdapter.markDispatched` guards its shipment registration on **two** conditions (`erli-order-source.adapter.ts:685-686`):

```ts
const vendor = carrier?.platformType;
if (trackingNumber && vendor) {
```

So Erli is structurally exposed to #1947 exactly like Allegro (same late-waybill skip), **plus** a second silent-drop path Allegro does not have: if the carrier hint is absent, the waybill is dropped even when it *is* known.

That matters directly for §3.5. `resolveCarrierHint` is explicitly degraded-but-non-fatal — it catches and returns `undefined` (`shipment-dispatch-notification.service.ts:135-148`), and its comment reasons that Allegro then "falls back to its catch-all carrier (OTHER + a generic name)". True for Allegro; **false for Erli**, where `undefined` means no registration at all. The hint is therefore not cosmetic, and the shared helper must say so.

Consequences for this change:

- The relay fix reaches Erli for free (same `OrderStatusWriteback` seam), so the fix is not Allegro-specific — a point in favour of converging on the relay rather than special-casing one adapter.
- Erli's dispatch writeback is **gated OFF** by `OL_ERLI_DISPATCH_WRITEBACK_ENABLED` pending #992 (`:554-563`), returning `unsupported`. So on Erli the defect is **latent, not live** — and §3.3b's classification is what keeps it that way: that `unsupported` is structural (`no-capability`-like) and must never trigger a retry loop against a gated-off endpoint.
- No Erli code change belongs in this branch. Its waybill POST is already 409-safe and already `idempotent: true`; the `vendor` guard is intentional (Erli's API requires a vendor per entry). Fix Erli's hint dependency only if #992 lands and it proves to bite.

### 3.4b Origin exclusion — the sibling service's stated premise is false

`ShipmentDispatchNotificationService:14-21` justifies passing the carrier connection as `originConnectionId` with "in practice a carrier is a `ShippingProviderManager`, never an order participant". **That is not true**: the Allegro manifest advertises `OrderSource` *and* `ShippingProviderManager` on the same connection (`allegro-plugin.ts` `supportedCapabilities`). So for an **Allegro-Delivery** shipment, `shipment.connectionId` *is* the order source and the relay excludes it (`order-lifecycle-relay.service.ts:65`).

That exclusion is nonetheless **correct** for this flow: on the source-brokered branch Allegro issued the waybill itself, so it already holds it — which is exactly why `markSent` is documented to receive no `trackingNumber` there. #1947's flow is the own-contract branch (InPost = a separate connection), so the source is reached.

Action: pass the carrier connection as origin (same as the sibling service), but replace the false premise in both comments with the accurate statement above. Do not copy the claim forward.

### 3.5 Extract the carrier hint

Move `resolveCarrierHint` into a shared helper so both services resolve it identically:

`libs/core/src/shipping/application/services/resolve-carrier-hint.ts`
```ts
export async function resolveCarrierHint(
  integrations: IIntegrationsService,
  connectionId: string,
  logger: LoggerPort,
): Promise<DispatchCarrierHint | undefined>
```
Same degraded-but-non-fatal behaviour (debug log, `undefined` on failure). `ShipmentDispatchNotificationService`'s private method becomes a delegation to it.

### 3.6 Make the silent skip observable

In `ShipmentDispatchNotificationService.notifyDispatched`, `warn` when relaying `dispatched` with **no** `trackingNumber` — the exact condition that produced #1947 in the field. Also correct the header comment's false premise ("an InPost (own-contract) shipment carries a **synchronous** `trackingNumber`", `:8-12`) — ShipX mints it at confirmation (`inpost-shipx.mapper.ts:183-185`).

### Data flow after the change

```
carrier poll / webhook
  → ShipmentStatusSyncService.buildPatchAndMaybePush
      → null→value trackingNumber detected
      → status ∈ {dispatched, in-transit}?
          yes → resolveCarrierHint → orderLifecycleRelay.relay({dispatched, trackingNumber, carrier})
                  → source  (Allegro OrderStatusWriteback) → PUT fulfillment SENT (409-idempotent) + POST …/shipments  ← THE FIX
                  → dests   (PS / WC OrderStatusWriteback) → updateFulfillment(shipped, tracking)   ← same call as before
                  → any rejected/throw ⇒ drop trackingNumber from patch (retry next poll)
          no  → patch trackingNumber only (notifyDispatched owns the dispatched transition)
```

## 4. Step-by-step implementation

| # | File | Change | Acceptance |
|---|---|---|---|
| 1 | `.../services/resolve-carrier-hint.ts` (new) | Extract the carrier-hint resolver | Pure delegation of existing logic; unchanged degraded behaviour |
| 2 | `.../services/shipment-dispatch-notification.service.ts` | Use the helper; add the no-waybill `warn`; fix the false header comment | Existing specs pass unchanged; new spec asserts the warn |
| 3 | `.../services/shipment-status-sync.service.ts` | Inject `ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN`; replace `pushTrackingToOmps` with `relayTrackingToParticipants`; update the header's workaround notes | Relay called with the waybill on a `dispatched` backfill; not called at `generated` |
| 4 | `.../services/shipment-status-sync.service.spec.ts` | **Existing tests break and must be rewritten, not just extended**: the harness injects `ORDER_RECORD_SERVICE_TOKEN` (dropped dep ⇒ module construction fails) and `:230`, `:261`, `:288`, `:304`, `:354`, `:378` all assert against the `updateFulfillment` / `syncStatus` mock surface. `:288` ("no destinations have an externalOrderId") loses its premise entirely — targets now come from identifier mappings. Then add the new cases below | All green, no stale `syncStatus` assertions left |
| 5 | `.../services/shipment-dispatch-notification.service.spec.ts` | Add the currently-missing NULL-`trackingNumber` dispatch case (`:39` always defaults a waybill), **plus** the §3.3b case: source `unsupported / adapter-unresolved` ⇒ shipment stays `generated` | Asserts relay receives `trackingNumber: undefined` + a warn; asserts no advance on an unresolved source |
| 6 | `apps/api/test/integration/shipment-status-sync.int-spec.ts` | The poll path is already covered there (destination-only today, `:196`, `:232`, `:261`) — extend with: dispatch at NULL tracking → backfill → assert the **source** stub received the waybill; plus the `adapter-unresolved` retry case | Green against real Postgres |
| 7 | `docs/architecture-overview.md` | There is **no shipping bounded-context section** to append to (contexts 1–14 omit it; shipping appears only in the dependency mermaid). Add the note under *Orders* next to the `OrderStatusWriteback` row, where ADR-027 already lives | Reviewer finds the behaviour without reading the diff |

### Mandatory test cases

Named explicitly because three review rounds each found a defect that a missing test would have let through silently.

1. `dispatched` + first tracking ⇒ relay called **once**, with the right origin / carrier / tracking; `trackingNumber` persisted.
2. Every row of the §3.3b classification table — in particular `unsupported / adapter-unresolved` ⇒ `trackingNumber` **not** persisted.
3. `generated` + first tracking ⇒ persisted, relay **not** called (`notifyDispatched` owns that transition).
4. **`delivered` + first tracking ⇒ relay still fires** (guards the §3.3c regression).
5. `cancelled` + first tracking ⇒ relay skipped, `trackingNumber` still persisted.
6. Allegro adapter: waybill POST 409 ⇒ `applied`; 500 ⇒ `rejected`; re-`write` of the same waybill ⇒ `applied`.
7. Dispatch notification: source `adapter-unresolved` ⇒ shipment stays `generated` (guards the §3.3b latent defect).
8. Integration: two consecutive `sync()` runs deliver `write({dispatched, trackingNumber})` to the source stub **exactly once**.

### Secondary findings folded into the same change

Each is a stale/incorrect artefact discovered while verifying the design; all are one-liners in files already being touched.

| Finding | Where | Action |
|---|---|---|
| Docstring references `ShipmentDispatchNotificationService.updateDestinations`, a method deleted by #1168 | `shipment-status-sync.service.ts:10,301` | Rewrite to name the relay |
| `ShipmentStatusSyncResult.propagated` currently means "all destinations OK"; its meaning now includes the source | `shipment-status-sync.types.ts:24`, logged by `apps/worker/src/sync/handlers/marketplace-shipment-status-sync.handler.ts:75` | Redefine in the type's doc comment as "participants notified" |
| WooCommerce `updateFulfillment` **discards** `trackingNumber` (`woocommerce-order-processor.adapter.ts:257-262`, "WC has no core tracking field") | — | Out of scope; note it so nobody expects WC destinations to gain tracking from this change |
| Erli's `write` is env-gated OFF and returns `unsupported` (`erli-order-source.adapter.ts:547-556`) | — | Correctly handled: `unsupported` is not a failure, so it never blocks the persist |
| Targets move from `record.syncStatus` → Order identifier mappings | `order-lifecycle-relay.service.ts:61-64` | Pre-existing, already-documented divergence (`shipment-dispatch-notification.service.ts:205-211`); note in the code comment |

**Quality gate for this branch:** `pnpm lint` + `pnpm type-check` locally; unit + integration suites run on CI (local full-test runs are prohibited on this machine).

## 5. Validate

- **Hexagonal compliance** — the change lives entirely in a CORE application service and consumes an existing sibling-context service interface + Symbol token via the `@openlinker/core/orders` barrel. No platform name enters core; Allegro is reached only through `OrderStatusWriteback`. No repository port crosses a context boundary.
- **Reuse over new abstraction** — no new port, service, token, or entity. One existing method is deleted, one existing seam is reused, one private method is promoted to a shared helper.
- **Naming** — `resolve-carrier-hint.ts` follows the colocated-helper precedent (`shipment-dispatch-lock.ts`); no `*.service.ts` file is added, so the service-interface invariant check is unaffected.
- **Security** — no credential, PII, or secret touched; the waybill is already stored and already sent to destinations.
- **Testing** — unit coverage for all five outcome branches; one integration test for the real ordering. Both currently-untested holes (NULL-tracking dispatch, post-backfill source notify) get a first test.
- **Blocking design input (not merely a closure check)** — the Allegro sandbox probe. Two questions, one session:
  1. Does Allegro accept `POST /order/checkout-forms/{id}/shipments` on an order already in `SENT`? (`needs-sandbox-probe`, `allegro-order-fulfillment.types.ts:8-9`.) If it refuses, the whole approach reopens: the fallback is deferring the writeback until the waybill is known, at the cost of a later buyer-visible status.
  2. What does a **duplicate** waybill POST return — 409, 200, or a second shipment row? §3.3a treats 409 as success, following Erli's shipped precedent. If Allegro instead accepts the duplicate silently, the fallback is a durable `shipments.waybill_relayed_at` marker (one nullable column + migration) — strictly smaller than #861's per-destination model, and the fallback both earlier reviews would accept.

  Run the probe **before** implementing §3.3a. Both questions are answerable with two curl calls against one sandbox order.

### Deliberately deferred — filed separately, not fixed here

Two genuine defects surfaced during review that are **not** this issue's bug and each need their own reproduction:

1. **Non-atomic gate between `notifyDispatched` and the poll.** `notifyDispatched` reads the row (`:91`), relays (`:106`), then writes `dispatched` (`:125-128`) — and takes **no lock** (verified: no `shipmentDispatchLockKey` use in the service or the controller), while the poll takes none either. Interleave them and the poll resumes holding a stale `generated` snapshot, so its push gate is closed: `trackingNumber` is persisted with nobody notified, and the `null → value` diff never fires again. This hole is **pre-existing** — today it silently loses the *destination* push in exactly the same way — so this change neither creates nor worsens it, but it can make #1947's acceptance criteria flap. Closing it properly means serializing on `shipmentDispatchLockKey(orderId)` across both paths.
2. **Allegro-Delivery orders are never marked SENT at the source.** A consequence of §3.4b: when the carrier connection *is* the source connection, the relay excludes it (`order-lifecycle-relay.service.ts:65`), `resolveSourceOutcome` finds no target and returns `absent` (`shipment-dispatch-notification.service.ts:183-203`), and the shipment advances to `dispatched` (`:124-129`) — with Allegro never told. Needs an explicit operator-origin sentinel rather than reusing the carrier connection as origin.

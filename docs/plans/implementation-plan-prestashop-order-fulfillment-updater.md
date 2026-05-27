# Implementation Plan — #858 PrestaShop `OrderFulfillmentUpdater` (capability B)

**Issue:** [#858](https://github.com/openlinker-project/openlinker/issues/858) (follow-up of #837 / E3 of #732)
**Branch:** `858-prestashop-order-fulfillment-updater`
**Layer:** Integration (PrestaShop adapter) + a one-method mapper-interface widening. **No CORE change, no migration, no manifest change.**

> #837 shipped the `OrderFulfillmentUpdater` port + the `ShipmentDispatchNotificationService` orchestration. The destination half degrades to `destinations[].status='unsupported'` because no adapter implements B. This issue implements it for PrestaShop — once it lands the orchestration drives it automatically (the guard `isOrderFulfillmentUpdater` starts returning true).

---

## 1. Goal & scope

Implement `updateFulfillment({ externalOrderId, status, trackingNumber? })` on `PrestashopOrderProcessorManagerAdapter` (declare `implements OrderProcessorManagerPort, DestinationOptionsReader, OrderFulfillmentUpdater`).

**In scope:** the adapter method (tracking write + state transition + the buyer "shipped" email via `sendmail=1` + idempotency), a typed `sendEmail` write-option on the WS client, exposing a compile-time-exhaustive status→PS-state-id mapping on the mapper interface, the PS test WS-key grant for `order_histories`/`order_carriers`, a unit spec (request-shape + ordering matrix), and a module-free PS-Testcontainer int-spec (real state + tracking).

> **Design settled via a full `/grill-me` + repeated `/tech-review`.** See §6 Decision log (Q1–Q6). Two follow-ups filed: **#861** (durable per-destination notify-state / idempotency source-of-truth) and **#862** (operator-configurable OL→PS order-state mapping).

**Out of scope / deferred:**
- Branch-3 (Allegro Delivery) backfilled-tracking → OMP propagation — **#838** (reuses this same method).
- Asserting actual email **delivery** — PS's own contract behind `sendmail`; needs an SMTP catcher (disproportionate). OL's contribution (sending `sendmail=1`) is unit-covered; the container asserts `order_histories` row + `current_state` advance + tracking. Documented accepted gap (Q6). **Re-open trigger:** if field reports show shipped emails not firing, add a MailHog assertion then.
- Durable notify-state / retry-to-convergence (**#861**) and configurable OL→PS state mapping (**#862**) — own slices.
- Any change to `createOrder` semantics, the orchestration, or the capability port.

---

## 2. Research findings (verified against the branch)

- **Adapter:** `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-order-processor-manager.adapter.ts` — `class PrestashopOrderProcessorManagerAdapter implements OrderProcessorManagerPort, DestinationOptionsReader`. Constructor injects `IPrestashopWebserviceClient httpClient`, `IdentifierMappingPort`, `IPrestashopOrderMapper orderMapper`, `Connection`, provisioners, `IPrestashopOpenLinkerModuleClient`, optional `IMappingConfigService`.
- **WS client** (`IPrestashopWebserviceClient`): `getResource(resource, id)`, `listResources(resource, filters?, limit?, offset?)`, `createResource(resource, data)` → POST `/api/{resource}`, `updateResource(resource, id, data)` → PUT `/api/{resource}/{id}` (**full-replace** — must send the whole resource body incl. `id`). `listResources` supports `{ custom: { <field>: <value> } }` → `filter[field]=[value]`.
- **`order_histories` is the PS-intended state-transition primitive.** No existing code touches it. `createResource('order_histories', { id_order, id_order_state })` is a POST that creates an `OrderHistory` row → PS changes the order's `current_state` and fires the state-machine side-effects (buyer email, stock, invoice). This is **the** reason #858 forbids the `orders` full-replace.
- **`order_carriers`** holds `tracking_number` (`PrestashopOrderCarrier` in `prestashop.mapper.interface.ts:112` — `{ id, id_order, id_carrier, tracking_number?, … }`). The WS-client spec already exercises `updateResource('order_carriers', id, {...})`.
- **Status mapping:** `prestashop-order.mapper.ts:418` `private mapOrderStatusToPrestashop(status): number` (`shipped → 4`, `delivered → 5`, …), used by `mapOrderCreate`. It is **private** — needs exposing on `IPrestashopOrderMapper` to reuse from the adapter (single-source the mapping).
- **Capability B** is exported from `@openlinker/core/orders`: `OrderFulfillmentUpdater` + `isOrderFulfillmentUpdater`; `updateFulfillment(input: { externalOrderId: string; status: OrderStatus; trackingNumber?: string }): Promise<void>`.
- **PS-Testcontainer harness:** `apps/api/test/integration/helpers/prestashop-container.helper.ts` → `startPrestashopContainer({ installOlModule? })` returns `{ baseUrl, webserviceApiKey, olDynamicCarrierId, plnCurrencyId, mysqlAddress, cleanup }`. The **OL-module install** is the CI-flaky path (#716) — this feature does NOT need it, so the spec runs with `installOlModule: false`.
- Existing PS-container specs: `orders/allegro-prestashop-carrier-mapping.int-spec.ts` (full ingest→order create), `orders/prestashop-harness-smoke.int-spec.ts`, `prestashop/prestashop-webhook-provisioning.int-spec.ts`.

---

## 3. Design

### 3.1 Mapper — single-sourced + compile-time-exhaustive (Q5)
Expose `mapStatusToPrestashopStateId(status: OrderStatus): number` on `IPrestashopOrderMapper`; make the impl public and **switch on the typed `OrderStatus`** (drop `.toLowerCase()`) with a `never` exhaustiveness guard in `default` that throws. Adding an `OrderStatus` member without mapping it becomes a **compile error**, not a silent default-to-`pending` (which on the projection path, with `sendmail`, would mis-transition + mis-email). `mapOrderCreate` reuses the same method. The state-ids assume a **default PS install** (`shipped→4`, …) — this is the **fallback tier** of the operator-configurable resolution chain tracked in **#862**. The exhaustive-throw is behaviour-preserving: a grep confirms the only callers are `mapOrderCreate` + `updateFulfillment`, both passing a typed `OrderStatus`, so `default` was already unreachable.

### 3.2 WS-client `sendEmail` write-option (Q3 — option A′)
Add a typed `PrestashopWriteOptions { sendEmail?: boolean }` to `createResource`/`updateResource` on `IPrestashopWebserviceClient`; the client maps `sendEmail:true` → append `?sendmail=1` to the write URL. PS-WS-protocol knowledge (the wire param) stays **in the PS-WS client**; the adapter expresses **intent** (`{ sendEmail: true }`). Opt-in per call — never a client default, so non-order writes never email. (Rejected: raw `{ query }` bag — leaks wire detail to the adapter + untyped junk-drawer on a shared client.)

### 3.3 `updateFulfillment` (adapter) — idempotent projector (Q1/Q2/Q4)
```
updateFulfillment({ externalOrderId, status, trackingNumber? }):
  order = getResource('orders', externalOrderId)            // throws if gone
  targetStateId = mapper.mapStatusToPrestashopStateId(status)

  // B. Tracking FIRST (when supplied) — so the state-email renders the link,
  //    and a failure here aborts before the irreversible email.
  if trackingNumber: writeTracking(externalOrderId, trackingNumber)

  // A. State transition LAST — the single irreversible side-effect.
  if Number(order.current_state) !== targetStateId:
    createResource('order_histories',
                   { id_order: externalOrderId, id_order_state: targetStateId },
                   { sendEmail: true })                      // → ?sendmail=1 (buyer email)
  // else already in target → skip (idempotent; no duplicate "shipped" email)
  // any WS failure → throw PrestashopApiException (no compensation)

writeTracking(externalOrderId, trackingNumber):
  rows = listResources('order_carriers', { custom: { id_order: externalOrderId } })
  if rows empty: warn + skip (do NOT fabricate a PS-managed row)
  row = max-by(id)(rows)                                     // PS "current" carrier = highest id
  if row.tracking_number === trackingNumber: return          // idempotent no-op
  updateResource('order_carriers', row.id, { ...row, tracking_number: trackingNumber })  // full-replace
```

### 3.4 Contract — the load-bearing semantics (Q1/Q4)
- **Idempotent desired-state projector, NOT a state machine.** Projects the supplied status; does not enforce PS lifecycle ordering — monotonicity/legality is the domain's concern (**#861/#827**). The `current_state === target → skip` guard's real job is **duplicate-email prevention** (PS doesn't dedupe `order_histories`).
- **Irreversible side-effect last.** The buyer email (the one un-recallable effect) fires only after tracking is confirmed (tracking-first). Any failure before it leaves a clean, retriable state — no tracking-less email ever sent.
- **Non-atomic + forward-recoverable.** Two non-transactional WS writes; on partial failure we **throw** (→ per-destination `'failed'` in the orchestration) and do **not** compensate. Convergence (re-drive until reflected) is the notify-state layer's job (**#861**), not this adapter's.
- **No identifier-mapping call** — `externalOrderId` is the PS order id, resolved upstream by the orchestration.

### 3.5 WS-key requirement (finding)
`updateFulfillment` writes `order_histories` + `order_carriers`. The connection's WS key **must grant those resources** or PS returns `401 Invalid API key for <resource>`. Add both to the PS **test WS-key fixture** (`applyPrestashopFixture`) and **document the operator requirement** (a PS connection's WS key needs `order_histories`/`order_carriers` CRUD).

### 3.6 Files
```
libs/integrations/prestashop/src/infrastructure/
  http/prestashop-webservice.client.interface.ts   (+ PrestashopWriteOptions; createResource/updateResource opts)
  http/prestashop-webservice.client.ts             (+ sendEmail → ?sendmail=1; reuse singularizeResource)
  mappers/prestashop.mapper.interface.ts           (+ mapStatusToPrestashopStateId on IPrestashopOrderMapper)
  mappers/prestashop-order.mapper.ts               (public + exhaustive switch)
  adapters/prestashop-order-processor-manager.adapter.ts        (+ implements OrderFulfillmentUpdater; updateFulfillment + writeTracking)
  adapters/__tests__/...adapter.spec.ts            (updateFulfillment matrix incl. sendEmail + ordering + max-id + warn-skip)
apps/api/test/integration/
  helpers/prestashop-fixture.helper.ts             (WS-key grant: order_histories + order_carriers)
  prestashop/prestashop-order-fulfillment-update.int-spec.ts    (PS container, installOlModule:false)
```
**Migration: none.**

---

## 4. Step-by-step

1. **WS client (Q3/A′)** — `PrestashopWriteOptions { sendEmail? }` on the interface + impl; map → `?sendmail=1`. *AC:* WS-client unit asserts **both** `sendEmail:true` → URL contains `?sendmail=1` **and** `sendEmail` absent → no `sendmail` param (catches an always-append regression); existing PS write specs green.
2. **Mapper (Q5)** — expose `mapStatusToPrestashopStateId` on the interface; public + exhaustive `never`-guarded switch; `mapOrderCreate` reuses it. *AC:* type-check; mapper/adapter specs green.
3. **Adapter (Q1/Q2/Q4)** — `implements … OrderFulfillmentUpdater`; `updateFulfillment` (tracking-first, `sendEmail:true`, throw/no-compensate) + `writeTracking` (max-id, warn-skip, no fabricate). *AC:* `isOrderFulfillmentUpdater(adapter) === true`.
4. **Unit spec (Q6)** — sendmail option requested; **call ordering** (tracking before `order_histories`); skip-when-in-state; max-id row; warn-skip when no row; tracking-unchanged skip; state-only when no tracking; WS-error wrap.
5. **WS-key fixture grant** — add `order_histories` + `order_carriers` to the PS WS-key fixture (fixes the 401).
6. **Integration spec (Q6)** — PS container (`installOlModule:false`); create the order via the ingest path with a `defaultCarrierId` (no OL module — relies on `applyPrestashopFixture` always seeding the OL Dynamic carrier **stub** row so `discoverDynamicCarrierId()`, always called in `createOrder`, passes); call `updateFulfillment`; assert `current_state===4` + a new `order_histories` row + `order_carriers` tracking; re-invoke → idempotency. Header documents the email-delivery gap.
7. **Quality gate** — `pnpm lint && type-check && test`; `pnpm test:integration` (new spec + full suite — #833 lesson); `migration:show` (none).

> **Gating AC (the load-bearing proof):** #858 is *not done* until the container probe is green on `current_state===4` + the new `order_histories` row. That green run is simultaneously the design's proof that WS `order_histories` advances state on PS 9.0.2. If it comes back negative after the WS-key grant, **stop and escalate** per §5 (module-side endpoint) — never the `orders` full-replace.

---

## 5. Validation
- **Architecture:** Integration-only; reuses the existing port/guard; status mapping single-sourced in the mapper; the WS-client widening keeps PS-WS-protocol knowledge in the PS-WS client (no order-domain leak). Domain/core untouched.
- **Confidence boundary (Q6):** unit proves OL-owned logic (sendmail requested, ordering, wire-map); container proves PS-behavior OL depends on (state advances via `order_histories`, tracking lands, idempotency); email **delivery** is PS's contract behind `sendmail` — documented accepted gap (SMTP catcher disproportionate).
- **`POST order_histories` probe (resolved approach):** the container spec is the proof PS 9.0.2 advances `current_state` from a WS `order_histories` POST. If it does **not**, escalate (module-side endpoint) — **never** the forbidden `orders` full-replace.
- **Security:** no secrets; WS auth via the connection's stored credentials. `sendmail` is opt-in per call (no accidental emails on other writes).

---

## 6. Decision log (full `/grill-me` + `/tech-review`)
| # | Decision | Why |
|---|---|---|
| Q1 | Idempotent **projector**, non-monotonic; **tracking-first** (irreversible email last) | adapter projects desired state; lifecycle/legality is the domain's (#861/#827); the skip-if-in-state guard = duplicate-email prevention |
| Q2 | `order_carriers`: **max-id** row (PS "current" carrier), **warn-skip don't fabricate** | `rows[0]` trusts unspecified WS order; fabricating a PS-managed row violates the projector principle |
| Q3 | **A′** — typed `{ sendEmail }` write-option; client maps → `?sendmail=1` | PS-WS-protocol (wire param) belongs in the PS-WS client; adapter expresses intent; avoids untyped query junk-drawer |
| Q4 | **Non-atomic, throw, no compensation**, irreversible-last; convergence = re-drive (#861) | correctness = convergence over idempotent re-drives, not per-call atomicity; rollback adds failure modes without buying correctness |
| Q5 | Mapper is the home; **compile-time-exhaustive** switch; accept+document default-install ids | single-source the table; extending `OrderStatus` must be a compile error, not a silent mis-transition; configurable mapping is #862 |
| Q6 | Unit = param+ordering+wire-map; container = state+tracking+idempotency; **email delivery = documented gap** | test what OL owns at the cheapest layer; PS's own side-effect (behind a flag we set) isn't worth an SMTP-catcher harness |

**Follow-ups filed:** **#861** (durable per-destination notify-state / idempotency source-of-truth — the per-target retry model #837 deferred), **#862** (operator-configurable OL→PS order-state resolution chain — the override tier in front of this default mapper).

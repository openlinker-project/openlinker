# Implementation Plan — #1159 Allegro implements OrderStatusWriteback + relay source-role targeting

**Issue:** #1159 (Part of #1157; ADR-027). Realises **User story S3** (marketplace side). Closes #1159.
**Branch:** `1159-allegro-order-status-writeback`
**Layer:** Integration (Allegro) + CORE (`orders` relay generalization).

---

## 1. Goal (restated)

- **Allegro implements `OrderStatusWriteback`** — `dispatched` (mark-sent + waybill, reusing today's `notifyDispatched` mechanics) and `cancelled` (mark Allegro fulfillment `CANCELLED`), reporting `applied | unsupported | rejected` via `OrderWritebackResult`.
- **Generalise the lifecycle relay** so it can target a **source-role** participant (Allegro is an `OrderSource`, not an `OrderProcessorManager`) — by resolving the participant's order capability from the registry, with **zero platform-type branching**. Today the relay hardcodes `'OrderProcessorManager'`, so it can never reach Allegro.

**Non-goals (this slice):**
- **Retiring `OrderDispatchNotifier`** — still live in `shipment-dispatch-notification.service` (`isOrderDispatchNotifier` + `notifyDispatched`); migrating that to the relay is #1160. #1159 is **additive**: Allegro implements `OrderStatusWriteback` *alongside* `notifyDispatched`.
- **The shop-side cancel *trigger*** that calls the relay with a shop origin → Allegro target (that detection is #1160/#1161). #1159 ships the *capability + relay reach*; the end-to-end cancel→Allegro completes when a sibling provides the trigger.
- **Refunds / money** — OL is never the money book of record (ADR-027). Cancel writeback is the fulfillment-status signal only.

## 2. Verified facts

- Allegro fulfillment status enum includes `CANCELLED`; set via `PUT /order/checkout-forms/{id}/fulfillment { status }` — the **same endpoint + flat body** the existing mark-sent uses (`ALLEGRO_FULFILLMENT_STATUS_SENT = 'SENT'`). Verified on developer.allegro.pl.
- `AllegroOrderSourceAdapter implements OrderSourcePort, SourceOptionsReader, OrderDispatchNotifier`; ctor `(connectionId, httpClient, connection)`. Sub-capabilities are **not** in the manifest — adding `OrderStatusWriteback` needs **no factory/manifest change** (runtime `isOrderStatusWriteback` guard).
- Relay `writeToTarget` hardcodes `getCapabilityAdapter<OrderProcessorManagerPort>(connId, 'OrderProcessorManager')`. `getCapabilityAdapter` **throws** `CapabilityNotSupported/NotEnabled` when a connection lacks the capability.
- `OrderStatusWriteback` / `OrderLifecycleEvent` / `OrderWritebackResult` are on `main`, exported from `@openlinker/core/orders`. PrestaShop already implements `write()`.

## 3. Design

### 3.1 Allegro adapter (`AllegroOrderSourceAdapter`)

- Add `OrderStatusWriteback` to `implements`; import the three types from `@openlinker/core/orders`.
- Add `ALLEGRO_FULFILLMENT_STATUS_CANCELLED = 'CANCELLED'` to `allegro-order-fulfillment.types.ts`.
- **Extract** the current `notifyDispatched` body into a private `markSent(externalOrderId, trackingNumber?, carrier?): Promise<void>` (unchanged behaviour — 409/already ⇒ idempotent success; failures ⇒ `AllegroOrderDispatchRejectedException`). `notifyDispatched` becomes `return this.markSent(...)` (preserves its throwing `Promise<void>` contract for the still-live dispatch path).
- Implement `write(event)`:
  - `dispatched` → `try { await this.markSent(event.externalOrderId, event.trackingNumber, event.carrier); return { outcome: 'applied' } } catch (e) { return { outcome: 'rejected', detail } }`.
  - `cancelled` → `PUT /order/checkout-forms/{id}/fulfillment { status: CANCELLED }`; success ⇒ `applied`; **any `AllegroApiException` (incl. 409) ⇒ `rejected`** with `detail = message`. **Do NOT reuse `isAlreadySentOrStale`'s "409 ⇒ success" branch here** — for cancel, a 409 is at least as likely to mean a *forbidden transition* (e.g. cancel after `SENT`) as "already cancelled", and masking that as `applied` would silently swallow a failed cancel (the conflict AC-3 wants surfaced). Treating 409/4xx as `rejected` is the safe default until Allegro's exact cancel-409 semantics are sandbox-verified (`needs-sandbox-probe`); a verified "already cancelled" signal can be upgraded to `applied` later. Mirrors PrestaShop's "report, never throw" `write()`.

### 3.2 Relay source-role targeting (`OrderLifecycleRelayService`)

- Replace the hardcoded resolution in `writeToTarget` with a role-agnostic resolver:
  ```ts
  const ORDER_PARTICIPANT_CAPABILITIES = ['OrderProcessorManager', 'OrderSource'] as const;

  private async resolveWriteback(
    connectionId: string,
  ): Promise<{ adapter: OrderStatusWriteback; capability: string } | null> {
    for (const capability of ORDER_PARTICIPANT_CAPABILITIES) {
      try {
        const adapter = await this.integrations.getCapabilityAdapter<object>(connectionId, capability);
        if (isOrderStatusWriteback(adapter)) return { adapter, capability };
      } catch (error) {
        // CapabilityNotSupported/NotEnabled → this connection just isn't this
        // role; try the next candidate. A connection-level failure (disabled /
        // not-found) is real — rethrow so the caller surfaces it (warn), rather
        // than masking it as a generic "no capability".
        if (
          error instanceof CapabilityNotSupportedException ||
          error instanceof CapabilityNotEnabledException
        ) {
          continue;
        }
        throw error;
      }
    }
    return null;
  }
  ```
  `writeToTarget` resolves via `resolveWriteback`; on `null` → `{ outcome:'unsupported', detail:'no order-writeback capability' }`; on a thrown connection-level error → catch + warn + `{ outcome:'unsupported', detail:'adapter unresolved' }` (preserves #1158 observability). The applied/rejected log line **includes the resolved `capability`** so a cross-role (source vs destination) misroute is diagnosable. No platform-type branching; destinations resolve on the first candidate (OMP), Allegro on the second (OrderSource). Backward-compatible: existing #1158 cancel→destination still resolves OMP on the first try. (`CapabilityNotSupportedException` / `CapabilityNotEnabledException` import from `@openlinker/core/integrations`.)

### 3.3 No new caller wiring

The relay is reached today only by `OrderIngestionService.handleSourceCancellation` (origin = source). Allegro becomes a *reachable target* via 3.2; the trigger that makes a shop-origin cancel fan out to Allegro is #1160/#1161. Documented, not built here.

## 4. Steps

1. `allegro-order-fulfillment.types.ts`: add `ALLEGRO_FULFILLMENT_STATUS_CANCELLED`. **AC:** const exported.
2. Allegro adapter: extract `markSent`, add `implements OrderStatusWriteback` + `write()`. **AC:** unit tests — dispatched(applied, +waybill), dispatched(rejected on POST fail), cancelled(applied), **cancelled(409→rejected)**, cancelled(rejected on 4xx); existing `notifyDispatched` tests still green.
3. Relay: role-agnostic `resolveWriteback` (capability-exception → try next; connection-level error → surface). **AC:** unit tests — a target supporting only `OrderSource` is resolved + written; a connection-level failure (disabled/not-found) surfaces as `unsupported: 'adapter unresolved'` (warn), distinct from `'no order-writeback capability'`; existing OMP-target tests unchanged (OMP resolved on first try).
4. Quality gate: `pnpm lint` / `type-check` / `test`; **full `pnpm test:integration`** (capability changes ripple into routing int-specs — issue note).

## 5. Validation

- Capability + guard pattern, types via barrel, Logger, no `any`, service-interface invariant intact (relay unchanged contract).
- ADR-027 conformance: one event-as-data capability; relay dispatches by guard, no platform branching. `OrderFulfillmentUpdater`/`OrderDispatchNotifier` untouched (retirement deferred).
- Allegro cancel verified against official docs (memory: never guess Allegro shapes).

## 6. Risks

- **Allegro cancel transition rules** — Allegro may reject `CANCELLED` after `SENT` (or other states). Handled: such rejections surface as `rejected` with the Allegro message (AC: "unsupported cases surface a clear result"). Exact post-SENT semantics are a `needs-sandbox-probe`, like the existing 409-on-SENT note.
- **No end-to-end cancel→Allegro yet** — needs the shop-origin trigger (#1160/#1161). #1159 delivers the capability + relay reach, unit-tested; the relay generalization is the shared prerequisite #1160 also consumes.

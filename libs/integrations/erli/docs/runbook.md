# Erli Integration — Runbook

Day-2 operational reference for the Erli adapter (`erli.shopapi.v1`): scheduler
env flags, known Erli platform quirks, and troubleshooting. For first-time setup
(connection, webhooks, first offer, orders), see the
[Erli setup guide](./setup-guide.md).

---

## Scheduler env flags (worker)

Two Erli schedulers are **opt-in** — enable them on the worker process:

| Env var | Effect | Default |
|---|---|---|
| `OL_ERLI_ORDERS_POLL_SCHEDULER_ENABLED=true` | `erli-orders-poll` reads Erli's unread inbox on an interval (order backstop for missed/dropped webhooks). | off |
| `OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED=true` | `erli-offer-status-sync` reconciles live offer status into `offer_status_snapshots` and populates the frozen-stock cache. | off |

> The orders poll is the correctness backstop for order ingestion — keep it
> enabled in any deployment that relies on Erli orders, since webhooks are
> fire-once with no retry (see below).

---

## Known Erli quirks

Read these before relying on the integration in production.

- **Async writes (HTTP 202).** Create/update calls return `202` with a cache lag
  of roughly 20 minutes. **Read-after-write does not reflect immediately** — a
  freshly created offer won't read back right away. Authoritative status comes
  from offer-status reconciliation, not the create response.
- **No webhook retry.** Erli webhooks are fire-once with a ~5 s timeout and no
  retry. A dropped webhook is lost; the inbox poll is the only delivery
  guarantee. Keep `OL_ERLI_ORDERS_POLL_SCHEDULER_ENABLED=true`.
- **Stock not auto-restored on cancellation.** Erli decrements stock on purchase
  but does not restore it on cancel. OpenLinker issues a compensating
  stock-restore for cancelled orders.
- **Public `https` images required.** Offers without at least one public `https`
  image are rejected. Non-`https`/non-public URLs (e.g. a PrestaShop dev store on
  `http://localhost`) are dropped when building the offer.
- **Category is optional.** Offers prefer a resolved Allegro category id, fall
  back to the master shop's categories, and otherwise list uncategorised.
- **Frozen fields.** If a seller manually edits an offer in the Erli panel, Erli
  marks those fields `frozen`. OpenLinker excludes frozen **content** fields
  (price/name/description) on field updates. Honoring frozen **stock** on the hot
  quantity path is a follow-up; enable the offer-status reconciliation scheduler
  to populate the frozen-stock cache.
- **Static API key.** No OAuth/refresh — rotate by replacing the key in the Erli
  seller panel and updating the connection credentials in OpenLinker.
- **Estimated ship-by on orders.** Erli's order payload has no per-order dispatch
  deadline field, so OpenLinker DERIVES the orders list/detail **Ship-by** from the
  connection's shop-wide **default dispatch time** (`config.defaultDispatchTime`):
  `ship-by = purchasedAt + defaultDispatchTime`. For the `day` unit the period is
  counted in **working days** (weekends skipped; PL public holidays are not yet
  accounted for). This is a best-effort per-order estimate — a per-offer dispatch
  override isn't visible on the order, so an offer with a non-default dispatch time
  will have a ship-by off by that difference. If no `defaultDispatchTime` is
  configured (or the order has no `purchasedAt`), the Ship-by field stays blank
  rather than being fabricated. The delivery-method label shows whenever the Erli
  order carries a delivery method; when it doesn't, the order-detail **Method** row
  falls back to the booked shipment's carrier/method and the **Carrier** row still
  surfaces the carrier of record.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| **Install webhooks → 400 / 500** | Ensure `config.callbackBaseUrl` is set and reachable by Erli (public `https`; use a tunnel in dev). |
| **Offer create fails: "requires at least one valid public https image URL"** | Master product has no public `https` image. Add one, or pass `overrides.imageUrls` via the API. |
| **Offer create fails: "supply overrides.categoryId"** | No automatic category match and no override. Supply a category or rely on the shop-source category fallback. |
| **Test connection fails (401)** | Invalid/expired API key. Regenerate it in the Erli seller panel and update the connection credentials. |
| **No orders arriving** | Confirm the inbox-poll scheduler is enabled (`OL_ERLI_ORDERS_POLL_SCHEDULER_ENABLED=true`); confirm webhooks are installed and `callbackBaseUrl` is reachable. |
| **Order ingests but doesn't reach PrestaShop ("Customer ID is required")** | The buyer email could not be resolved to a customer. Confirm customer identity resolution is configured (the Erli order carries a buyer email and no buyer id). |
| **PS order-create fails: "Country … not found / not active"** | The buyer's destination country is not enabled in PrestaShop. Activate it under PrestaShop → International → Locations → Countries (Erli sells in Poland → enable Poland). |
| **PS order-create fails: "Webhook secret not found"** | The PrestaShop connection has no provisioned HMAC secret. Install webhooks on the PrestaShop connection (Connection detail → Install webhooks) — OpenLinker creates the order via the OL-module `validateOrder` endpoint, which the secret signs. |
| **Freshly created offer not visible via read** | Expected — Erli writes are async (`202`, ~20-min cache lag). Wait for offer-status reconciliation rather than reading back immediately. |

# Next Steps: ISSUE_47 Offer Mapping Sync

**Date**: 2026-01-25  
**Status**: Ready for execution  

---

## What’s Already Done

- Offer mapping pipeline implemented (core services, worker handler, Allegro adapter).
- New job type `marketplace.offers.sync` added.
- Scheduler task added to `SchedulerService` (`allegro-offers-sync`).
- Migration added for `(entityType, connectionId, internalId)` index.
- Unit tests added and passing.
- Worker integration test added and passing (requires Docker/Testcontainers).

---

## Remaining Steps (Execution Checklist)

### 1) Apply & Verify Environment Configuration

Set/verify these env vars in API runtime:

- `ALLEGRO_OFFERS_SYNC_SCHEDULER_ENABLED` (default `true`)
- `ALLEGRO_OFFERS_SYNC_INTERVAL_CRON` (default `*/30 * * * *`)
- `ALLEGRO_OFFERS_SYNC_PAGE_LIMIT` (default `100`)
- `ALLEGRO_OFFERS_SYNC_FEED_TYPE` (`events` by default; set to `offers` for full-crawl bootstrap)

Confirm the API instance logs the registration of `allegro-offers-sync`.

---

### 2) Confirm Scheduler Activity

The scheduler runs in API. Verify that jobs are enqueued on cron ticks for **active Allegro connections**.

Check Redis stream or job table for `marketplace.offers.sync` entries.

---

### 3) Backfill Offer Mappings (One-Time or On-Demand)

If you want to force a full run immediately, enqueue a seed job:

```json
{
  "jobType": "marketplace.offers.sync",
  "connectionId": "<ALLEGRO_CONNECTION_ID>",
  "payload": {
    "schemaVersion": 1,
    "limit": 200,
    "feedType": "events",
    "cursorKey": "allegro.offers.lastEventId"
  },
  "idempotencyKey": "marketplace:<ALLEGRO_CONNECTION_ID>:offers:sync:seed-1"
}
```

Follow-up jobs are automatically enqueued by the worker handler until `nextCursor` is empty.

For initial backfill, you can temporarily set `ALLEGRO_OFFERS_SYNC_FEED_TYPE=offers` (or enqueue a manual job with `feedType: "offers"`), then switch back to `events` for incremental runs.

---

### 4) Verify Data in Database

Check `identifier_mappings`:

- `entityType = 'Offer'`
- `connectionId = <ALLEGRO_CONNECTION_ID>`
- `externalId = <allegroOfferId>`
- `internalId = <internal variant ID>`
- `context.metadata.source = 'marketplace.offers.sync'`

Ensure `internalId` points to **variant IDs** only (no product IDs).

---

### 5) Validate Allegro API Assumptions

Confirm events feed behavior for `GET /sale/offer-events`:

- event IDs are monotonic for cursor progression
- `offer.id` is present for each relevant event

The handler persists cursor key `allegro.offers.lastEventId` after each successful page.
If identifiers are missing on some offers, linking falls back to SKU/barcodes or safely skips.

---

### 6) Smoke Test Order Sync

Pick an order whose offers have been mapped and trigger `marketplace.order.sync`:

- Expect **no** `MissingOrderItemMappingError`.
- Ensure order items include `variantId` and correct `productId`.

---

## Optional Follow-Ups

- Add a per-connection “offers sync in progress” guard if cron overlap becomes a problem.
- Tune `ALLEGRO_OFFERS_SYNC_INTERVAL_CRON` based on account size and rate limits.
- Extend linking to support EAN/GTIN if you confirm data availability.

---

## Test Commands (Reference)

Core unit tests:
```
pnpm --filter @openlinker/core test -- offer-linking.service.spec.ts offer-mapping-sync.service.spec.ts order-item-ref-resolver.service.spec.ts
```

Worker unit tests:
```
pnpm --filter @openlinker/worker test -- marketplace-offers-sync.handler.spec.ts inventory-propagate-to-marketplaces.handler.spec.ts
```

Worker integration test (requires Docker):
```
pnpm --filter @openlinker/worker test:integration -- marketplace-offers-sync-e2e.int-spec.ts
```

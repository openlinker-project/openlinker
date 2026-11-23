# Implementation plan: Empik offer sync (#4277)

Part of epic #4273, stacked on #4276.

## Goal

Keep stock and price of offers a seller listed on Empik in step with
OpenLinker, link those offers to OL variants, and show why an offer is
inactive. Layer: Integration (`libs/integrations/mirakl`), plus one
plugin-owned table. No core change.

## Design

`MiraklOfferManagerAdapter` (dispatched as `OfferManager`) implements:

| Capability | Mirakl |
|---|---|
| `updateOfferQuantity`, `OfferQuantityBatchUpdater` | record, then STO01 |
| `OfferFieldUpdater` (price only) | record, then PRI01 |
| `PendingQuantityAckReconciler` | STO01 status / PRI02, error reports |
| `OfferLister` | OF21 (`shop_sku`, EAN from `product_references`) |
| `OfferStatusReader` | OF21 `?sku=` (`active`, `inactivity_reasons`) |

- Offers are keyed by `shop_sku`: the STO01/PRI01 key and the order line key.
- `mirakl_offer_writes`: one pending row per (connection, kind, offer) via a
  partial unique index; `version` guards the submit.
- `MiraklOfferWriteReconciler`: settle imports, send one file per kind,
  prune after a week.
- `createMiraklIntegrationModule(profile)`: registers the entity and fills the
  plugin's repository getter during DI.
- Scheduler: offer writes (5 min), offers sync (hourly), offer status (hourly).

## Decisions

- Buffer, do not send per change: Mirakl rate-limits imports.
- A `COMPLETE` import with error lines fails those offers; unnamed lines fail
  the import.
- Never OF24 (resets unspecified fields); enforced by a structural spec.
- Status via OF21 by SKU, not OF22, which needs Mirakl's numeric id.
- Title, description and tax rate updates are refused, not dropped.
- Premium price channels out of scope (issue assumption).

## Tests

Unit: file policy, inactivity reasons, adapter, reconciler, factory, plugin,
scheduler, no-OF24 guard. Integration (`empik-offer-writes.int-spec.ts`): the
upsert, version guard and per-SKU settle on real Postgres, driven by core's
write-back and reconcile services.

## Verified on staging (read-only)

OF21 shape (`shop_sku`, `product_references`, `active`,
`inactivity_reasons`), OF21 `sku` filter (exact). Imports were not sent from
this change; the spike already measured STO01/PRI01 changing only their field.

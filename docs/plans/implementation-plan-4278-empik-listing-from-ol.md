# Implementation plan: Empik listing from OL (#4278), part 1

Part of epic #4273, stacked on #4277.

## Split, as the issue itself prescribes

The issue's assumption: "If Empik reviews cards manually and slowly, split this
issue into 'offer on existing card' and 'card creation + variants + bundles'."
That is the case: on staging a product (card) import stayed waiting for the
operator indefinitely (import 30532, SPIKE-4268), and the dependency "an answer
from Empik on how card review works" is still open. A card that may take days
also does not fit the creation poller, which ends a record with `POLL_TIMEOUT`
after a bounded number of attempts; keeping it `validating` would need a core
change of its own.

**Part 1 (this change): offer on an existing card.**
**Part 2 (follow-up issue): card creation (P41), variant grouping
(`VARIANT_GROUP_MKPL`), bundle and multipack cards (`650`, `ADRU`, `2039`).**

Bundles and multipacks whose own EAN already has a card are listed by part 1
like any product: core already sends the bundle availability as their stock and
expands an order line into components.

## Part 1 design

- **Taxonomy** (`MiraklCatalog`): `TaxonomyIdentityProvider` (`empik` /
  `empik:staging`, added to core's `TaxonomyOwnerValues`), `CategoryBrowser`
  over H11 (`max_level=2` to tell leaves), `CategoryParametersReader` over PM11
  plus VL11 per value list. Feeds the destination taxonomy projection, so
  category mappings and attribute rules work for Empik.
- **Card match** (`EanCategoryMatcher`): P31 by EAN, up to 100 references per
  call. One card is `matched` (category + card id), several `multi-match`.
- **Offer creation** (`OfferCreator`): card required (P31). OF24 with the full
  field set a create needs: `product_id` (EAN), `state_code` 11, price,
  quantity, lead time and logistic class (batch `platformParams`, else
  connection `offerDefaults`), and the `gpsr-*` offer fields from
  `Product.gpsr`. No card is a clear rejection (`MIRAKL_PRODUCT_CARD_MISSING`).
  The OF24 import is recorded (`mirakl_offer_writes`, kind `offer`) so the
  status read can answer `activating` while it runs and report the import's
  error line if it fails; the reconciler settles it like stock and price.
- `shop_sku` is derived from the OL variant id (`OL-<hex>`, 35 chars), the key
  orders and stock already use.
- **Frontend** (`plugins/empik`): bulk wizard section for lead time and
  logistic class, and row blockers for a missing EAN and a missing card.

## Tests

Unit: catalog (H11 leaf detection, PM11/VL11 mapping, P31 match), GPSR fields,
offer creator (OF24 body, no-card rejection, in-flight status), config
validator, web plugin validation. Integration: OF24 create recorded and
settled through the reconciler on real Postgres.

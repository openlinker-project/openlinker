# Measuring tax-rate coverage before rollout

Per-line tax rates ([ADR-052](../architecture/adrs/052-per-line-tax-rate-resolution-and-provenance.md))
hold a document when a line has no rate. That is the right behaviour and the wrong
first day, if the catalogue has no rates in it: every order stops at once, and an
operator reads an outage rather than a diagnosis.

So the count comes first. This page is how to take it, and what the answer means.

## What the three states mean

| State | Condition | What it says |
|---|---|---|
| **known** | `taxRateReadAt IS NOT NULL AND taxRate IS NOT NULL` | The shop stated a rate. `'0'` counts here - a zero rate is an answer. |
| **missing** | `taxRateReadAt IS NOT NULL AND taxRate IS NULL` | The shop was asked and has none. **This is the population that holds documents.** |
| **not checked** | `taxRateReadAt IS NULL` | Nobody has asked yet. Not a problem - it needs a product sync, not a catalogue edit. |

Keeping *missing* and *not checked* apart is the whole point. On the day the
columns land every row is *not checked*, and reading that as *missing* would
report a catalogue-wide failure that does not exist.

## Taking the count

Per shop connection, which is the unit an operator actually fixes:

```sql
SELECT m."connectionId",
       m."platformType",
       COUNT(*)                                                                         AS total,
       COUNT(*) FILTER (WHERE p."taxRateReadAt" IS NOT NULL AND p."taxRate" IS NOT NULL) AS known,
       COUNT(*) FILTER (WHERE p."taxRateReadAt" IS NOT NULL AND p."taxRate" IS NULL)     AS missing,
       COUNT(*) FILTER (WHERE p."taxRateReadAt" IS NULL)                                 AS not_checked
  FROM products p
  JOIN identifier_mappings m
    ON m."internalId" = p.id AND m."entityType" = 'Product'
 GROUP BY 1, 2
 ORDER BY missing DESC, not_checked DESC;
```

A product mapped on two connections is counted under both. That is the honest
answer - both shops would have to carry the rate for both to publish - rather
than an arbitrary pick.

The same numbers are available in code as
`IProductsService.getTaxRateCoverageByConnection()`, which is what a future
operator surface would read. There is deliberately no standing dashboard: this
is a rollout measurement, and the standing form of the question is the
per-product state the publish and issuance paths already act on.

## Reading the answer

- **Mostly `not_checked`** - normal, and not a blocker by itself. Run a product
  sync per connection and re-measure. Only after that does the count mean
  anything.
- **Mostly `missing` after a sync** - the shop genuinely has no tax
  configuration for those products. Fill it there, not in OpenLinker; the
  catalogue is the only place a fix serves every channel.
- **Mostly `known`** - safe to remove the provider defaults (#2257).

## Why this gates #2257

#2257 removes the hardcoded 23% each provider adapter substitutes today. Until
then a rate-less product still produces a document, with a guessed rate. After
it, a rate-less product produces nothing at all. Running the two in the wrong
order turns a slow, visible data problem into an immediate outage.

**Baseline recorded 2026-08-21** on the `ol-demo-fresh` stack: coverage was
**zero** - no rate column existed, no order line carried a rate, and the
WooCommerce store had an empty tax table. The full measurement is on #2256.

## Pre-rollout orders

Orders ingested before the feature carry no rate on any line, and the documents
issued for them used the provider defaults. The
`MarkPreRolloutOrdersHistorical` migration stamps `order_records.taxRateEra =
'pre-rollout'` on them.

They **issue exactly as they do today** - blocking would stop history nobody is
going to retrofit - and they are **excluded from any net-revenue figure** rather
than presented as a confirmed rate. Nothing renders the marker to an operator:
it appeared in one place with no action attached, so it is analytics data, not a
badge.

```sql
-- orders whose tax is stated rather than defaulted
SELECT * FROM order_records WHERE "taxRateEra" IS NULL;
```

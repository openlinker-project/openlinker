# Measuring tax-rate coverage before rollout

Per-line tax rates ([ADR-063](../architecture/adrs/063-per-line-tax-rate-resolution-and-provenance.md))
hold a document when a line has no rate. That is the right behaviour and the wrong
first day, if the catalogue has no rates in it: every order stops at once, and an
operator reads an outage rather than a diagnosis.

So the count comes first. This page is how to take it, and what the answer means.

## What the three states mean

| State | Condition | What it says |
|---|---|---|
| **known** | `taxRateReadAt IS NOT NULL AND taxRate IS NOT NULL` | The shop stated a rate. `'0'` counts here - a zero rate is an answer. |
| **missing** | `taxRateReadAt IS NOT NULL AND taxRate IS NULL` | The shop was asked and has none. **This is the population that holds documents.** |
| **not checked** | `taxRateReadAt IS NULL` | Nobody has asked yet. It needs a product sync, not a catalogue edit - but note the gates do **not** distinguish it from *missing*: with strict enforcement on, a not-checked line is held exactly like a rate-less one. The distinction is about the REMEDY, not about whether the document waits. |

Keeping *missing* and *not checked* apart is the whole point. On the day the
columns land every row is *not checked*, and reading that as *missing* would
report a catalogue-wide failure that does not exist.

## Taking the count

Per shop connection, which is the unit an operator actually fixes:

Resolution is **variant-first**: a variant's own rate wins where it has one, and
the product's rate applies only where the variant has none. So the count has to
be taken per variant, or a shop that keeps its rates on variations cannot read
its own blast radius from it.

```sql
WITH effective AS (
  SELECT v.id                                          AS variant_id,
         v."productId"                                 AS product_id,
         -- The variant override wins where it was checked and answered;
         -- otherwise the product's own state applies. This mirrors
         -- `effectiveTaxRate` in libs/core/src/products/domain/types.
         CASE
           WHEN v."taxRateReadAt" IS NOT NULL AND v."taxRate" IS NOT NULL THEN 'known'
           WHEN p."taxRateReadAt" IS NOT NULL AND p."taxRate" IS NOT NULL THEN 'known'
           WHEN v."taxRateReadAt" IS NULL AND p."taxRateReadAt" IS NULL   THEN 'not_checked'
           ELSE 'missing'
         END                                           AS state
    FROM product_variants v
    JOIN products p ON p.id = v."productId"
)
SELECT m."connectionId",
       m."platformType",
       COUNT(*)                                          AS total_variants,
       COUNT(*) FILTER (WHERE e.state = 'known')         AS known,
       COUNT(*) FILTER (WHERE e.state = 'missing')       AS missing,
       COUNT(*) FILTER (WHERE e.state = 'not_checked')   AS not_checked
  FROM effective e
  JOIN identifier_mappings m
    ON m."internalId" = e.product_id AND m."entityType" = 'Product'
 GROUP BY 1, 2
 ORDER BY missing DESC, not_checked DESC;
```

A product mapped on two connections is counted under both. That is the honest
answer - both shops would have to carry the rate for both to publish - rather
than an arbitrary pick.

The product-level count is still worth taking alongside it, because a *product*
with no rate is one catalogue edit while N rate-less variants are N of them:

```sql
SELECT COUNT(*) FILTER (WHERE "taxRateReadAt" IS NOT NULL AND "taxRate" IS NULL) AS products_missing,
       COUNT(*) FILTER (WHERE "taxRateReadAt" IS NULL)                            AS products_not_checked
  FROM products;
```

The same numbers are available in code as
`IProductsService.getTaxRateCoverageByConnection()`, which is what a future
operator surface would read. There is deliberately no standing dashboard: this
is a rollout measurement, and the standing form of the question is the
per-product state the publish and issuance paths already act on.

## Reading the answer

- **Mostly `not_checked`** - normal on day one, and the remedy is a sync rather
  than a catalogue edit. It is *not* harmless once enforcement is on: the gates
  hold a not-checked line exactly like a rate-less one. Run a product sync per
  connection and re-measure before switching anything on.
- **Mostly `missing` after a sync** - the shop genuinely has no tax
  configuration for those products. Fill it there, not in OpenLinker; the
  catalogue is the only place a fix serves every channel.
- **Mostly `known`** - safe to remove the provider defaults (#2257).

## The switch that gates it: `OL_TAX_RATE_STRICT_ENABLED`

Strict enforcement is a single environment switch, and it is **OFF by default**.

With it off, every *coverage* refusal behaves as it did before the epic: the
three invoicing providers substitute their documented default (inFakt 23%,
Subiekt 23%, KSeF the per-connection value), the auto-issue gate and the
issuance write-path guard both pass, the fiscal-registration gate passes, and
the Allegro and Erli offer creates publish with the rate omitted.

With it on, ADR-063 applies: a rate-less line holds the document, and a
rate-less publish is refused with an error naming what to fix.

```bash
# after the count above reads mostly `known`
OL_TAX_RATE_STRICT_ENABLED=true
```

Only the exact string `true` enables it. Anything else - absent, empty, `1`,
`yes`, a typo - reads as off, deliberately: a mistyped value must never be the
thing that stops a seller invoicing.

### What can still fail with the switch off

Two publish refusals are **not** behind the switch, and they can fire on a
deployment that has touched nothing:

| Refusal | Where | When |
|---|---|---|
| `TAX_RATE_NOT_EXPRESSIBLE` | Allegro and Erli offer create | The shop's rate is an exemption code the channel cannot express (`zw` / `np` / `oo` on Allegro, `oo` on Erli). |
| `TAX_RATE_NOT_ALLOWED_IN_CATEGORY` | Allegro offer create | The shop's rate is not among the rates Allegro's target category allows (a 23% product published into a reduced-rate category). |

Both mean the shop **did** state a rate and the channel cannot carry that exact
value. That is a conflict at any coverage level rather than a coverage problem,
which is why it is not switchable: publishing the offer anyway would state the
wrong tax to real buyers, and a failed batch an operator can see is the better
failure.

**When it becomes reachable.** Not on deploy - with an empty rate column there
is nothing to conflict with. It becomes reachable as soon as a product sync
fills the rates in, which is the step this page tells you to run *before*
enabling anything. So the order is: sync, then expect these two, then take the
count, then switch.

**What it looks like.** The offer-create child job fails. There is no badge, no
counter and no held state for it - only the failed child in the bulk batch and
the job error, which names the offending rate and, for the category refusal, the
rates the category does allow. On a large bulk publish every affected child
fails, so a catalogue-wide misconfiguration (exempt goods carried as `zw`, or a
whole category published at the wrong rate) shows up as a mostly-failed batch.

**What the operator does.** Read the rate off the error, then fix it in the
place that owns it:

- a rate the category refuses - either the shop's rate is wrong for that product,
  or the product is being published into the wrong category. Fix whichever is
  wrong; both fixes are outside OpenLinker.
- an exemption code the channel cannot express - that product cannot be sold on
  that channel at that rate. Either the shop's exemption is wrong, or the product
  does not belong on that channel. There is no OpenLinker-side override, by
  design.

Nothing else on the publish path refuses. A missing rate with the switch off
still publishes with the rate omitted, byte for byte as before.

## Why this gates #2257

#2257 removed the hardcoded 23% each provider adapter substituted. That removal
now lives behind the switch above: with it off the default is still applied, so
a rate-less product still produces a document with a defaulted rate; with it on,
a rate-less product produces nothing at all. Running the two in the wrong order
turns a slow, visible data problem into an immediate outage, which is why the
switch exists rather than the removal simply shipping on.

**Baseline recorded 2026-08-21** on the `ol-demo-fresh` stack: coverage was
**zero** - no rate column existed, no order line carried a rate, and the
WooCommerce store had an empty tax table. The full measurement is on #2256.

## Pre-rollout orders

Orders ingested before the feature carried no rate on any line, and the documents
issued for them used the provider defaults. The
`MarkPreRolloutOrdersHistorical` migration stamps `order_records.taxRateEra =
'pre-rollout'` on them.

**Superseded by the tax-rate backfill sweep (#2440).** A pre-rollout order's
`taxRateEra` marker is untouched and still permanently exempts it from every
fiscal-issuance gate (below) — that guarantee never changes, so enabling
strict enforcement can never strand the back catalogue. But its
`order_line_items` rows are no longer permanently rate-less: the
`orders.taxRate.backfill` job (default ON, hourly per `OrderSource`
connection) fills a line's rate from the CURRENT catalogue state whenever the
catalogue has one, tagging it `taxSource: 'backfill'` — best-effort
provenance for internal reporting, never a confirmed shop/channel read at
order time, and never used to satisfy a *new* fiscal document's rate
requirement. This is what lets `/analytics` compute Net Sales/AOV/Median for
historical orders once the underlying product syncs, even though those
orders remain forever exempt from strict enforcement.

They **issue exactly as they do today** - blocking would stop history nobody is
going to retrofit. That is enforced, not merely intended: every refusal that can
see an order reads the marker and exempts a pre-rollout one **even with the
switch on**, so turning enforcement on cannot strand the back catalogue. That is
five places: the auto-issue invoice gate, the auto-issue receipt gate, the
invoice issuance write path, the fiscal-registration write path, and the Subiekt
line mapper. Its lines carry no rate because no rate was ever collected for
them, and no catalogue edit changes that after the sale.

The marker exists so a later net-revenue figure can **exclude** them rather than
present a defaulted rate as a confirmed one. Nothing reads it for that yet -
there is no net-revenue figure and no analytics consumer of `taxRateEra` today,
which is why the migration's own comment is conditional. Nothing renders the
marker to an operator either: it would appear in one place with no action
attached, so it is analytics data, not a badge.

```sql
-- orders whose tax is stated rather than defaulted
SELECT * FROM order_records WHERE "taxRateEra" IS NULL;
```

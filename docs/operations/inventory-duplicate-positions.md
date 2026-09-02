# Duplicate inventory positions — detection and remediation

Covers the read-only detection pass added in #2319, why duplicate inventory
positions exist at all, and the manual remediation an operator runs before
ADR-058 ladder step (iii) / #2325 can make the position key authoritative.

Detection **never repairs anything**. The endpoint below reads; every fix in
this document is a deliberate operator action.

## Why duplicates exist

An `inventory_items` row is meant to be one position: one product (or variant),
at one location, owned by one connection's sync. Two indexes are supposed to
enforce that:

```
UNIQUE ("productId", "locationId")                    WHERE "productVariantId" IS NULL
UNIQUE ("productId", "productVariantId", "locationId") WHERE "productVariantId" IS NOT NULL
```

Both are **NULL-distinct**, which is standard SQL and is the whole problem.
Postgres treats two NULLs as *not equal* for uniqueness purposes, so:

- two rows for the same product + variant with `locationId = NULL` both insert
  cleanly — the index does not consider them the same key;
- the same is true of two product-level rows (`productVariantId = NULL`) with no
  location.

`locationId` is nullable and is NULL on the overwhelming majority of rows in a
single-location install, so this is not an exotic corner. The rows are then
**summed** by the availability read, which double-counts available-to-promise:
OpenLinker publishes a quantity larger than the stock that exists, and the
oversell surfaces at a buyer's checkout rather than in any log.

`sourceConnectionId` (#2314) is deliberately absent from both indexes for the
same reason — adding a nullable column to a unique index widens the
NULL-distinctness rather than narrowing it.

The converse is worth knowing before you go looking: where every index-key
column is non-null — a variant row with a real `locationId` — the existing index
**does** work, and a second insert is rejected outright. Every duplicate the
report can find therefore has a NULL somewhere in its key. A duplicate at a
fully-specified position is not merely rare, it is unreachable today (an
integration test asserts the insert fails).

## What counts as a duplicate

The position key is **all four columns**:

```
("productId", "productVariantId", "locationId", "sourceConnectionId")
```

compared with `GROUP BY` semantics, where NULLs **do** group together — the
exact inverse of the index semantics above, which is what lets the scan see the
rows the index let in.

Provenance is part of the key on purpose. ADR-058 decision (2) states that
cross-source coexistence is legitimate and is why provenance is mandatory:
two connections may each legitimately hold a position for the same product at
the same location. Those rows are **not** duplicates, and reporting them as
such would permanently block #2325 on a perfectly healthy multi-source install.

Two rows are a duplicate only when all four values match — including both being
NULL. Rows not yet covered by the #2317 `'legacy'` backfill carry
`sourceConnectionId = NULL`; two such rows at the same position **are** a
duplicate, and stay one after the backfill turns both NULLs into `'legacy'`.

Stale rows (`isStale = true`) are **included**. This is stricter than the
availability read, which excludes them: a stale row still occupies the position
key and would still be rejected by the index #2325 creates. Each group reports
`liveRowCount` alongside `rowCount` so you can see whether the duplication is
currently distorting availability, or only blocking the migration.

## How to run it

Admin-only. Read-only. Takes no filters — a filtered scan could report a clean
subset of a dirty table, and the number below has to speak for the whole table
the index will be built over.

```
GET /v1/inventory/duplicate-positions?maxGroups=100
```

```bash
curl -s \
  -H "Authorization: Bearer $OL_ADMIN_TOKEN" \
  "$OL_API_URL/v1/inventory/duplicate-positions?maxGroups=100" | jq
```

```jsonc
{
  "groupCount": 2,        // UNCAPPED — every duplicate group in the table
  "rowCount": 5,          // UNCAPPED — total rows across those groups
  "excessRowCount": 3,    // rowCount - groupCount: rows that must go
  "truncated": false,     // true when maxGroups capped `groups`, never the totals
  "generatedAt": "2026-08-24T09:12:00.000Z",
  "groups": [
    {
      "productId": "ol_product_…",
      "productVariantId": "ol_variant_…",
      "locationId": null,
      "sourceConnectionId": null,
      "rowCount": 3,
      "liveRowCount": 2,
      "rows": [                       // newest first
        { "id": "…", "availableQuantity": 7, "reservedQuantity": 0,
          "isStale": false, "updatedAt": "2026-08-20T10:00:00.000Z" }
      ]
    }
  ]
}
```

`maxGroups` defaults to 100 and is capped at 500. It bounds the returned
**detail only** — `groupCount`, `rowCount` and `excessRowCount` are always
computed over the entire table, so a truncated response still carries a
trustworthy gate value. Above 500 the request is rejected with 400 rather than
quietly clamped.

The scan is two full sequential scans of `inventory_items` with no supporting
index (there is none that helps a four-column grouping over two nullable
columns). That is accepted for an operator-run diagnostic; run it off-peak on a
large catalogue.

## Wave 1d gate

**#2325 may not proceed while `groupCount` is anything other than 0.**

Step (iii) of the ADR-058 ladder does two things: `SET NOT NULL` on
`sourceConnectionId`, and recreate the position indexes so the four-column key
is authoritative. `CREATE UNIQUE INDEX` fails outright on a table holding
duplicate keys, so a non-zero `groupCount` is not a warning — it is the
migration failing at deploy time.

The gate is exactly:

```bash
curl -s -H "Authorization: Bearer $OL_ADMIN_TOKEN" \
  "$OL_API_URL/v1/inventory/duplicate-positions" | jq '.groupCount'
# must print 0
```

Read that value and nothing else. `groups` may be truncated;
`groupCount` never is. Note the ordering dependency: run this **after** the
#2317 backfill, because the backfill collapses NULL provenance to `'legacy'`
and can therefore turn two rows that were already duplicates into two rows that
are visibly duplicates under the same key. Re-run the gate after any
remediation until it prints 0.

On a large `inventory_items` table the backfill's `WHERE "sourceConnectionId"
IS NULL` scan is deliberately **unindexed** — building an index there would
lock the one table every published quantity derives from, which is exactly the
hazard the bounded-page design avoids. If the drain is too slow or too costly,
the supported lever is the cadence: raise `OL_INVENTORY_PROVENANCE_BACKFILL_CRON`
(or the page limit), do not add an index. Once the drain latches, the predicate
is never scanned again.

## Manual remediation

There is no automated repair, and this is deliberate: choosing which row
survives is a claim about physical stock, and OpenLinker is not in a position to
make it.

For each group:

1. **Pick the survivor.** Default rule: the live row (`isStale: false`) with the
   highest `updatedAt` — that is the most recent real write from the master.
   The `rows` array is already ordered newest-first, so it is normally
   `rows[0]`, provided `rows[0].isStale` is false.
2. **If every row in the group is stale**, none of them is describing live
   stock; keep the newest and delete the rest, or delete the whole group if the
   product is genuinely gone at the master.
3. **Reconcile the survivor's quantity with the master**, not with the other
   rows. The next `master.inventory.syncAll` pass will overwrite
   `availableQuantity` from the master anyway, so the survivor's figure matters
   only until then.

   > **Never sum the duplicated quantities.** The duplicate rows are two
   > *records of the same position*, not two locations holding stock. Summing
   > them re-creates, permanently and by hand, the exact over-count the index
   > exists to prevent — and unlike the index defect it will not be corrected by
   > the next sync, because it now looks like a legitimate master figure.

4. **Delete the losers by primary key**, taken from the report:

   ```sql
   -- ids come from the report's groups[].rows[].id — bare UUIDs, NOT
   -- ol_-prefixed internal ids (inventory_items.id is a plain uuid).
   DELETE FROM "inventory_items"
    WHERE "id" IN ('{loser id from the report}', '{loser id from the report}');
   ```

   Delete by `id` only. A `DELETE` keyed on the position columns cannot express
   "all but one" and will empty the whole group.

5. **Re-run the report** until `groupCount` reads 0, then proceed with #2325.

If a group is large or the survivor is genuinely ambiguous, the safe fallback is
to delete every row in the group and let the next master inventory sync
re-create the position from the master's own figure — at the cost of that
product publishing stale stock until the sweep reaches it.

## Related

- `docs/architecture/adrs/058-*` — the position-identity ladder; decisions (2)
  and (4) are what make provenance part of the key.
- #2314 — `sourceConnectionId` added (step (i)).
- #2317 — `'legacy'` sentinel backfill (step (ii)); run before the gate.
- #2325 — `SET NOT NULL` + recreated unique indexes (step (iii)); gated on
  `groupCount === 0`.

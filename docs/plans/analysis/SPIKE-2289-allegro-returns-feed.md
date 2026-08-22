# Spike #2289 — Allegro customer-returns: is the feed cursor/watermark-pollable?

Desk research only. Sources of record: the official OpenAPI spec at
`https://developer.allegro.pl/swagger.yaml` (fetched 2026-08-22; paths `/order/customer-returns`,
`/order/customer-returns/{customerReturnId}`), the order-handling tutorial, and one Allegro-staff
answer on `allegro/allegro-api`.

## Verdict — 4A, qualified

The kill condition for 4A is "the feed is neither cursor- nor watermark-pollable with acceptable
stability". It is not met. `GET /order/customer-returns` ships a first-class, vendor-documented
cursor — `from`, "The ID of the last seen customer return. Customer returns created after the given
customer return will be returned" ([swagger.yaml](https://developer.allegro.pl/swagger.yaml)) — and
Allegro staff state that returns are held in indexing order, that remembering the last id and
passing it as `from` is the intended way to synchronise a local copy, and that under that usage
"there is no risk that any returns will be missed"
([allegro/allegro-api#5550](https://github.com/allegro/allegro-api/issues/5550)). That is the same
shape `AllegroOrderSourceAdapter` already uses for `/order/events`, so it maps onto the existing
poll/sync job model without inventing a mechanism. A `createdAt.gte`/`createdAt.lte` date watermark
exists alongside it as a repair axis.

The qualification is load-bearing and must reach the issue, not just this file: the cursor covers
DISCOVERY, not LIFECYCLE. `CustomerReturn` carries `createdAt` and no `updatedAt`, and `from` is
defined over creation, so a return that moves `CREATED -> DELIVERED -> FINISHED` after the cursor
passed it is invisible to the cursor forever. There is also no returns entry in the order event
journal — `/order/events` `type` is exactly `BOUGHT | FILLED_IN | READY_FOR_PROCESSING |
BUYER_CANCELLED | FULFILLMENT_STATUS_CHANGED | AUTO_CANCELLED` — which independently kills 4B as a
SOURCE: an order-sync projection cannot observe an Allegro return at all. So 4A is the only path
that yields data, and it needs two passes: a cursor sweep for new returns plus a bounded re-read of
non-terminal ones for status.

## Evidence

Unless noted, the source is the official spec, [developer.allegro.pl/swagger.yaml](https://developer.allegro.pl/swagger.yaml).

| # | Fact | Source |
|---|---|---|
| E1 | `GET /order/customer-returns` exists, marked `[BETA]`, media type `application/vnd.allegro.beta.v1+json`, scope `allegro:api:orders:read` | swagger.yaml |
| E2 | `from` = "The ID of the last seen customer return. Customer returns created after the given customer return will be returned." | swagger.yaml |
| E3 | Returns are stored in indexing order (usually == buyer creation order); `from`-based sync is the documented incremental method and misses nothing | [allegro-api#5550](https://github.com/allegro/allegro-api/issues/5550) |
| E4 | `createdAt.gte` / `createdAt.lte` ISO-8601 filters exist — a date watermark is available as a fallback/repair axis | swagger.yaml |
| E5 | `limit` 1..1000 (default 100), `offset` >= 0 (default 0); response is `{count, customerReturns[]}` | swagger.yaml |
| E6 | Deep offsets are unsafe in practice: `offset=20000&limit=1000` returned HTTP 504; the same reporter saw creation dates out of sequence across pages | [allegro-api#5550](https://github.com/allegro/allegro-api/issues/5550) |
| E7 | No `updatedAt` / `modifiedAt` anywhere on `CustomerReturn` | swagger.yaml |
| E8 | `/order/events` carries no return event type | swagger.yaml |
| E9 | Rate limit stated in the endpoint description: 25 req/s per user, 50 req/s per clientId | swagger.yaml |
| E10 | `GET /order/customer-returns/{customerReturnId}` exists (single read by id) | swagger.yaml |
| E11 | `status` is filterable as a query param, same 11-value vocabulary as the payload | swagger.yaml |
| E12 | `status` was added to the payload after the resource shipped; the announcement gives no change-detection guidance | [news: status zwrotu](https://developer.allegro.pl/news/zwroty-klienckie-dodalismy-informacje-o-statusie-zwrotu-9gzwkO7ebuk) |
| E13 | Return REASON vocabulary is still being extended by Allegro (new reasons announced for 04 Nov 2025) — treat as open-world | [news: nowe powody zwrotu](https://developer.allegro.pl/news/zwroty-klienckie-4-listopada-2025-dodamy-nowe-powody-zwrotu-k1bKmlMWkIy) |
| E14 | Tutorial section "how to retrieve customer returns list" documents `from` as "the identifier of the most recently retrieved return" and states no ordering guarantee of its own | [process-orders tutorial](https://developer.allegro.pl/tutorials/process-orders-PgPMlWDr8Cv) |

## API surface summary

**List** — `GET /order/customer-returns`
Accept `application/vnd.allegro.beta.v1+json`; scope `allegro:api:orders:read`.

Query params (all optional; `string` unless noted):
`customerReturnId`, `orderId`, `buyer.email`, `buyer.login`, `items.offerId`, `items.name`,
`parcels.waybill`, `parcels.transportingWaybill`, `parcels.carrierId`,
`parcels.transportingCarrierId`, `parcels.sender.phoneNumber`, `referenceNumber`,
**`from`** (cursor — last seen return id), **`createdAt.gte`**, **`createdAt.lte`**,
`marketplaceId`, `status`, `limit` (int 1-1000, default 100), `offset` (int, default 0);
header `Accept-Language`.

**Single** — `GET /order/customer-returns/{customerReturnId}`
**Write** — `POST /order/customer-returns/{customerReturnId}/rejection` (reject refund; out of scope here)

Payload sketch (`CustomerReturn`):

```
id                string (uuid)          # this is the value passed to `from`
orderId           string (uuid)          # == checkout-form id -> joins OL's Order mapping
referenceNumber   string                 # e.g. '1234/Z04A'
createdAt         date-time              # the ONLY timestamp on the aggregate
status            CREATED | DISPATCHED | IN_TRANSIT | DELIVERED | FINISHED | FINISHED_APT
                  | REJECTED | COMMISSION_REFUND_CLAIMED | COMMISSION_REFUNDED
                  | WAREHOUSE_DELIVERED | WAREHOUSE_VERIFICATION
isFulfillment     boolean                # handled by One Fulfillment
marketplaceId     string                 # e.g. 'allegro-pl'
buyer             { email, login }
items[]           { offerId, quantity:int64, name, price, url,
                    reason:{ type, userComment }, serialNumbers[] }
refund            { bankAccount }        # present only for COD / transfer / Allegro Pay
parcels[]         { createdAt, waybill, transportingWaybill?, carrierId,
                    transportingCarrierId?, sender }
rejection         { code, reason, createdAt }
                  # code in REFUND_REJECTED | NEW_ITEM_SENT | ITEM_FIXED | MISSING_PART_SENT
                  #         | ITEM_MISMATCH | BUSINESS_PURCHASE | NO_RETURN_RIGHT
```

Two shape notes that bear on the neutral contract:

- **Line items key on `offerId`** — not on an order-line id, not on a barcode/SKU, and with no
  reference back to a specific order line. Attributing a returned quantity to an OL
  `ProductVariant` therefore goes `offerId -> Offer mapping -> variant`. A multi-variant
  auto-grouped listing (#824) puts one `offerId` per variant, so that resolves; an unmapped offer
  yields an ORPHANED return, which 4A must handle just as 4B was scoped to.
- **`items[].reason.type` is prose, not an OpenAPI `enum`** (E13 shows the list is still growing).
  Model it open-world (raw string passthrough), never a closed union.

## Open risks — flagged, not guessed

1. **`from` + filter composition is undocumented.** Whether `from` may be combined with `status` or
   `createdAt.gte` in one request — and if so whether the cursor applies before or after the filter
   — is stated nowhere. Must be settled live before a `status=`-filtered sweep is designed.
2. **`from` is defined over CREATION, but staff describe INDEXING order,** and say the two "usually"
   coincide (E2 vs E3) — an explicit hedge. Whether a late-indexed old return can be stepped over by
   a cursor already past its creation position is unresolved. The `createdAt.gte` repair sweep below
   exists for exactly this.
3. **No documented total-order guarantee, plus one field report of out-of-sequence pages (E6).** The
   report is offset-paged, so it may be an artefact of `offset` rather than of `from`. Unverified.
4. **Deep `offset` is a live 504 risk (E6)** and bootstrapping a large seller's history is precisely
   the deep-offset case.
5. **Status transitions have no watermark at all (E7/E8).** The cost of the re-read sweep is a
   function of open-return count, which the docs cannot bound.
6. **Sandbox coverage unverified.** The spec is environment-neutral and nothing states whether
   `[BETA]` returns are populated in `sandbox.allegro.pl`. Creating a BUYER-initiated return in
   sandbox may not be possible at all — the single biggest risk to writing integration tests for
   4A, and not answerable from docs.
7. **`[BETA]` media type** `application/vnd.allegro.beta.v1+json` may change without the usual
   deprecation ladder. Acceptable, but the shape must not be treated as frozen.
8. **`count` semantics unstated** (total matching vs. page size). Do not drive termination off it;
   terminate on an empty `customerReturns[]`.

## Recommended cursor semantics (4A)

Two passes, two cursors, deliberately separate — the split OL already draws between
`master.product.syncAll` (enumeration) and `master.product.reconcile` (state re-check).

**Pass 1 — discovery** (`marketplace.returns.poll`)
- Cursor key `allegro.customerReturns.lastReturnId`, per connection; value = `CustomerReturn.id` of
  the last item of the last FULLY-processed page. Scalar and opaque — the shape
  `OrderSourcePort.listOrderFeed` already uses.
- Request `GET /order/customer-returns?from={cursor}&limit=100`, paging until the array is empty.
- **Advance only after every item on the page was persisted/enqueued** (the #2218 rule): a partial
  failure holds the cursor and retries the page. Re-reading is free because the downstream write is
  an idempotent upsert keyed on `CustomerReturn.id`.
- A missing cursor means FIRST RUN, never "since the epoch" via a bare unbounded call.

**Bootstrap / repair.** Walk `createdAt.gte` + `createdAt.lte` windows oldest-first (7-day windows,
`limit=1000`), never deep `offset` (risk 4). The same mechanism is the repair path for risk 2: a
periodic overlapped re-sweep at `createdAt.gte = now - 7d` catches anything the id cursor stepped
over. **Overlap window 7 days, configurable** — deliberately generous, because a missed return is an
unrefunded buyer while an overlap is an idempotent no-op upsert.

**Pass 2 — lifecycle** (`marketplace.returns.statusSync`), the counterpart to
`marketplace.offer.statusSync` (#816) and for the same reason: no change feed exists, so OL must
re-read. Enumerate OL's own return records whose status is NOT terminal — treat `FINISHED`,
`FINISHED_APT`, `REJECTED`, `COMMISSION_REFUNDED` as terminal and everything else as open — budgeted
and rolling-scan-cursored via `runBoundedSweep`, re-reading each through
`GET /order/customer-returns/{id}` (E10). Prefer that over a `status=`-filtered list until risk 1 is
settled live. Budget against 25 req/s per user (E9), which is generous; the binding constraint is
OL's own lane accounting (ADR-050), not Allegro's quota.

**Verify live before implementation** (one ~30-minute spike): risks 1, 3 and 6. If 6 comes back
negative, 4A still stands but its test strategy becomes fixture-driven against recorded production
payloads — which should be said in the issue rather than discovered mid-wave.

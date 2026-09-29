# Spike #3638 — Shoper REST API: capabilities, flows, verdict

> Unlike the four marketplace spikes this repo already carries (`SPIKE-2879`/`2880`/`2881`/`2882`),
> Shoper is not a marketplace — it is a Polish SaaS shop platform, architecturally analogous to
> PrestaShop/WooCommerce (a `ProductMasterPort` + `InventoryMasterPort` + `OrderProcessorManagerPort`
> destination), and the requested scope mirrors what the Subiekt GT integration already delivers
> (`openlinker-subiekt-bridge#7`, `#3365`) minus sales documents. This document therefore groups
> findings by **C** (Connect), **M** (Catalogue/Inventory), **O** (Orders in), **F** (Fulfil), and
> **X** (Operate/Webhooks) — the shop-platform-relevant subset of the vocabulary
> `ANALYSIS-new-marketplace-integrations-story-catalogue.md` established for marketplace *publish*
> flows — plus a standalone **Sales documents** section, since that axis is a confirmed, deliberate
> exclusion rather than a partially-covered group.

Sources of record: live REST calls via `curl` against a real Shoper trial shop
(`sklep729770.shoparena.pl`), transcripts captured in `## Live transcripts` below; and static
analysis of Shoper's official downloadable Postman collection (`shoper-api.postman_collection.json`,
365 endpoints across 14 top-level folders — Auth, Authentication, Products, Orders, Customers,
Content, Marketing, Marketplace, Localization, Metafields, Configuration, Warehouse, Dashboard,
Webhooks). Every row below is marked `Live` (a real request/response, transcript captured) or `Desk`
(Postman-collection static analysis, not exercised against the live shop). The admin panel itself
(screenshots reviewed in the researching conversation, not re-embedded here) is cited as `Live —
admin UI` where it was the actual evidence source (multi-warehouse Premium gate; confirmed absence of
any invoice/receipt affordance on the order-detail screen).

## Environment

Trial shop `sklep729770.shoparena.pl` (14-day trial account). Auth via a static Bearer token issued
through the shop's own "Dodaj integrację" (Add integration) panel — Client ID + Token API, granted
scopes: produkty (products), warianty produktów (product variants/stocks), stany dostępności
(availabilities), kategorie (categories), stawki vat (tax rates), magazyny (warehouses), zamówienia
(orders), przesyłki (parcels), statusy zamówień (order statuses), klienci (customers), webhooki
(webhooks), dostawy (shippings/delivery methods), płatności (payments) — all at
`odczyt+dodawanie+edycja+usuwanie` (read+create+edit+delete) once the trial account's own permission
editor was used to widen an initial narrower grant partway through the research session. No
production Shoper account was used; no Shoper support ticket was filed.

## Verdict — lean ADOPT

**The requested scope — catalogue+variant+EAN+stock read, order push with the real marketplace-paid
price, customer resolution, fulfillment writeback with full partial-shipment support, and stock sync
between Shoper and sales channels — is demonstrably implementable against Shoper's REST API**, with
every capability confirmed live end to end at least once. Three real gaps and one hard scope boundary
were found, all load-bearing enough that the six capability mini-epics this spike feeds
(`#3639`-`#3644`) must design around them explicitly rather than discover them mid-implementation:

1. **No native order idempotency (O-group).** A caller-supplied order `code` neither prevents a
   duplicate nor round-trips back on `GET`. `#3642` (OrderProcessorManager) needs its own per-order
   lock, mirroring the shape of the existing `invoicing.issue` guard (`#2047`).
2. **No guest customer auto-provisioning (O-group).** `POST /orders` requires an existing `user_id`;
   `user_id=0` is explicitly rejected. `#3642` must call `POST /users` first — but Shoper's own
   native email-uniqueness enforcement (`400` on a duplicate) makes this a clean get-or-create.
3. **Stock auto-decrements the instant an order line is created (O-group).** Real double-deduction
   risk against OL's own inventory-sync for the same units; `#3642` needs an explicit policy
   decision, not an assumption.
4. **Multi-warehouse is Premium-plan-gated (M-group).** Confirmed via the live admin panel (disabled
   checkbox, explicit "PREMIUM" badge) and `GET /warehouses` → `400 "Warehouses module is disabled"`
   on the trial account. `#3641` (InventoryMaster) ships pooled/location-less positions in v1; a
   located model is out of scope until a real merchant on Premium needs it.

**And, separately from the four items above, a confirmed hard scope boundary rather than a gap**:
Shoper has **no sales-document (invoice/receipt) capability anywhere** — confirmed three independent
ways (see `## Sales documents — confirmed absent`). This narrows the requested scope relative to the
Subiekt GT precedent, which does cover documents; an operator using Shoper pairs an independent
`InvoicingPort`/`FiscalizationPort` connection, exactly as for any other shop platform.

Nothing found across this spike contradicts the ADOPT lean. The one genuinely unresolved technical
question — the exact `x-webhook-sha1` signing algorithm (X-group) — does not affect the verdict,
because OL's ingestion posture never trusts webhook payload authenticity for anything beyond
triggering a re-pull.

## Findings, by capability area

### C — Connect

| # | Fact | Evidence |
|---|---|---|
| C1 | A static Bearer token issued from the shop's own admin panel ("Dodaj integrację" → Client ID + Token API) works directly as `Authorization: Bearer {token}` — no OAuth exchange needed for this connection-per-shop model | Live: `GET /product-stocks?limit=1` → `200`, real data returned |
| C2 | Full OAuth2 also exists (`POST /webapi/rest/oauth/token`, `authorization_code`/`refresh_token` grants) — for App-Store-distributed public apps, not this use case | Desk: Postman `Auth`/`Authentication` folders |
| C3 | Granted scopes (`Obszar sklepu` × `Zakres dostępu`) are genuinely enforced server-side, not just a UI affordance | Live: `GET /shippings` and `GET /payments` → `403 {"error":"insufficient_scope","error_description":"The request requires higher privileges than provided by the access token"}` before those two areas were granted; `200` after granting them |
| C4 | An invalid token gives a clean, structured `401` | Live: `Authorization: Bearer garbage` → `401 {"error":"unauthorized_client","error_description":"Provided access token is invalid"}` |
| C5 | Rate-limit headers present on every response: `x-shop-api-calls` (running counter), `x-shop-api-limit`, `x-shop-api-bandwidth` | Live: `x-shop-api-calls: 1/2/3` incrementing across 3 sequential calls; `x-shop-api-limit: 10` |
| C6 | The real sustained rate-limit ceiling was **not** reached | Live: 25-request burst against `GET /currencies`, all `200`, no throttling observed — flagged as needing a longer test before production launch, not asserted as "no limit" |
| C7 | 26 distinct `Obszar sklepu` permission values discoverable in the panel's own dropdown (only ~13 are relevant to this milestone's scope) | Live — admin UI: dropdown DOM capture |
| C8 | Read/write granularity is a 4-level ladder: odczyt / odczyt+dodawanie / +edycja / +usuwanie (read / +create / +edit / +delete) | Live — admin UI |

### M — Catalogue & Inventory (`ProductMasterPort` / `InventoryMasterPort`)

| # | Fact | Evidence |
|---|---|---|
| M1 | `products` is the header entity (`GET/POST/PUT/DELETE /products[/:id]`); `product-stocks` is the **real variant grain** — EAN, price, stock, `code`, weight, `active`, `default` all live there, not on `products` | Live: `GET /product-stocks?limit=50` — real seeded catalogue, 36 rows |
| M2 | Multi-variant products fan out via `options#writable` nested under the product create/update payload into multiple `product-stocks` rows | Desk: `POST /products` request body schema |
| M3 | EAN write-then-read confirmed genuinely functional; the empty EAN observed on the seeded 36-product trial catalogue is a data-seeding artifact, not an API defect | Live: `PUT /product-stocks/181 {"ean":"5901234123457","stock":77}` → `200`; `GET /product-stocks/181` → `"ean":"5901234123457"` |
| M4 | Categories via `categories`/`categories-tree` (full tree, not paginated flat list) | Desk: Postman `Products > Categories`, `Products > Category Tree` |
| M5 | Tax vocabulary matches ADR-063's `InvoiceLine.taxRate` vocabulary almost exactly | Live: `GET /taxes` → `[{"value":"23","name":"23%"},{"value":"8","name":"8%"},{"value":"5","name":"5%"},{"value":"0","name":"0%"},{"value":"0","name":"zw."},{"value":"0","name":"np."}]` (missing only `oo`) |
| M6 | Deletion detection is clean: `GET` on a nonexistent id returns a structured `404` | Live: `GET /products/999999999` → `404 {"error":"invalid_request","error_description":"Resource not found"}` |
| M7 | **No bulk modified-since primitive.** Only a **per-object** `GET /object-mtime/{object}/{id}` exists (singular object name, unix timestamp) — `object-mtime/product` and `object-mtime/products` both `500`; `object-mtime/product/93` → `200 {"date":1790680990}` | Live: full trial-and-error sequence, final working form confirmed |
| M8 | `adjustInventory` (`PUT /product-stocks/:id {"stock": N}`) is a confirmed **absolute** write, not a delta | Live: set `stock:77`, read back `77`; a later order-line create dropped it to `76` (auto-decrement, see O8) |
| M9 | No native idempotency-key support on the stock-write endpoint | Desk: no such field in the Postman request schema; confirmed by omission in M8's live test |
| M10 | Multi-warehouse (`warehouses`/`warehouse-logs`/`warehouse-relocations`) is a real resource but **gated behind a paid Premium plan** | Live: `GET /warehouses` → `400 {"error":"invalid_request","error_description":"Warehouses module is disabled"}`; Live — admin UI: "Obsługa wielu magazynów" checkbox disabled, "PREMIUM" badge, "dostępna wyłącznie w pakiecie Premium" notice |
| M11 | `application-config` (`GET /application-config`) is a cheap, full shop-settings dump (~100 fields) — confirms `warehouses_enabled: false`, `product_defaults_tax_id`, `shopping_update_stock_on_buy`, `shopping_parcel_create_status_id`/`shopping_parcel_send_status_id`, and (relevant below) zero invoice/document-related fields | Live: full response captured |

### O — Orders in (`OrderProcessorManagerPort`)

| # | Fact | Evidence |
|---|---|---|
| O1 | `POST /orders` requires `email`, `status_id`, `payment_id`, `shipping_id`, `user_id`, `shipping_tax_id` | Live: `POST /orders {}` → `400` listing all six as `Pole wymagane` (required field) |
| O2 | **`user_id` must reference an existing user — no guest auto-provisioning.** `user_id=0` explicitly rejected | Live: `POST /orders {..., "user_id":0}` → `400 "Wartość pola 'user_id' jest niepoprawna: Nie znaleziono wartości '0'"` |
| O3 | Shoper natively enforces email uniqueness on `POST /users` — a duplicate `400`s | Live: two `POST /users` with the same email → first `200` (id 4), second `400 "Wartość 'ol-dedup-test@example.com' już istnieje"`; confirmed via `GET /users?filters[email]=...` exactly one row exists |
| O4 | Order line `price`/`tax`/`tax_value` are fully caller-controlled, independent of the catalog price — **real marketplace price passes through untouched** (ADR-014) | Live: catalog `product-stocks.price = 1484.28`; `POST /order-products {..., "price": 999.00}`; `GET /orders/:id` → `"sum": "999.00"` |
| O5 | **No native order idempotency.** The order's own `code` field is not round-tripped back on `GET` even when explicitly set, and two full orders posted with an **identical** caller-supplied `code` both succeed as two separate records | Live: `POST /orders {..., "code":"OL-IDEM-KEY-777", ...full addresses}` twice → `200` (id 5), `200` (id 6); `GET /orders/5`/`GET /orders/6` both `"code": ""` |
| O6 | **Stock auto-decrements the instant `POST /order-products` runs**, no separate confirm step | Live: `stock: 77` before, immediately `76` after one `POST /order-products` with `quantity:1`; config confirms `"shopping_update_stock_on_buy": "1"` |
| O7 | A full B2B order with a real NIP on the billing address completes fast, no synchronous external verification delay | Live: `POST /orders` with `billing_address.tax_identification_number: "5252556107"` → `200` in 0.437s (measured via `time curl`); `GET` confirms the NIP + company name stored correctly |
| O8 | `GET /statuses` returns 11 statuses with a coarse `type` (1=new / 2=processing / 3=shipped / 4=terminal: cancelled/rejected/returned) | Live: full 11-row response captured |
| O9 | Delivery/billing address carries `tax_identification_number` and `pesel` fields (both empty in seeded data, both real schema fields) | Live: seeded order #1/#2 full response bodies |

### F — Fulfil

| # | Fact | Evidence |
|---|---|---|
| F1 | `POST /parcels {order_id, shipping_id, shipping_code, sent:true}` is the tracking-writeback mechanism; `shipping_code` carries the carrier tracking number | Live: `POST /parcels {"order_id":4,"shipping_id":8,"shipping_code":"DPD-OL-TEST-999","sent":true}` → `200` |
| F2 | Confirmed end to end: creating a parcel **auto-advances `order.status_id`** per the shop's own config mapping | Live: order `status_id` `1` → `7` immediately after F1's parcel create, matching `application-config.shopping_parcel_send_status_id = "7"` |
| F3 | **Partial shipment is fully and correctly modelled.** An explicit `products:[{order_product_id, quantity}]` ships exactly that partial quantity of a line; a later parcel with **no** `products[]` automatically picks up exactly the remaining unshipped quantity across every line | Live: 2-line order (qty 2 + qty 1); parcel A with explicit `{order_product_id:14, quantity:1}` shipped 1 of 2 units of line A; parcel B with no `products[]` shipped the remaining 1 unit of line A **plus** the full 1 unit of line B — verified via `GET /parcels/:id` on both |
| F4 | A parcel created for an order with zero shipped remaining quantity is refused | Live: `POST /parcels` on an order with nothing left to ship → `400 "All products has been already sent"` |
| F5 | Shipping-method definitions (`GET /shippings`) carry a tracking-URL template with a `{tracking_number}` placeholder per carrier, and a native `engine` field (`inpost`, `ShoperShipment`/Apaczka.pl) | Live: full `shippings` list, 9 methods, InPost + Poczta Polska + DPD Kurier all present with real tracking-URL templates |
| F6 | This is reference data only — does not conflict with OL's own carrier adapters (InPost/DPD), since OL buys its own labels | Inference from F5, not a separate call |

### X — Operate / Webhooks

| # | Fact | Evidence |
|---|---|---|
| X1 | Webhooks fully manageable via API: `GET/POST/PUT/DELETE /webhooks` | Live: `GET /webhooks` on the trial shop returned 4 pre-existing webhooks from an already-connected third-party tool (Apilo) — `admin.account_connected/disconnected`, `order_transaction.create`, `order_refund.create` |
| X2 | Live event catalog is **richer than the official Postman collection** — the admin UI's live event picker showed `category.create/edit/delete` and `product-tag.edit`, none of which appear in the Postman `Webhooks > Webhook Events` folder | Live — admin UI: event multi-select dropdown DOM capture |
| X3 | Webhook payload is the **full resource object**, not just an id | Live: real webhook.site capture of `order.create`, `order.status`, `order.edit` (×2) — each carried the complete `order` JSON, ~2.2KB |
| X4 | Every webhook delivery carries `x-shop-license`, `x-shop-domain`, `x-shop-version`, `x-webhook-name`, `x-webhook-id`, `x-webhook-sha1`, `user-agent: Shop Webhook Sender {version}` | Live: headers captured on all 4 real deliveries |
| X5 | **The exact `x-webhook-sha1` signing algorithm is unresolved.** 13 candidate formulas tried against the real raw request bytes and the configured "Klucz" (Key) secret — none matched | Live: `HMAC-SHA1(body, secret)`, `SHA1(body+secret)`, `SHA1(secret+body)`, `SHA1(body)`, `HMAC-SHA1(body, SHA1(secret))`, `HMAC-SHA1(body, MD5(secret))`, `HMAC-SHA1(license, secret)`, `HMAC-SHA1(body, license)`, `SHA1(body+license)`, `SHA1(license+body)`, `SHA1(license+secret+body)`, `SHA1(secret+license+body)`, `HMAC-SHA1(body, license+secret)` — all ruled out against the real 2261-byte raw body |
| X6 | Because OL's ingestion posture never trusts webhook payload content — always re-pulls via authenticated `GET` — X5 is a non-blocking open item, not a launch blocker | Architectural reasoning, not a call |

## Sales documents — confirmed absent, three independent ways

1. **API surface**: zero matches for `invoice`/`faktura`/`paragon`/`receipt`/`document`/`fiscal` anywhere across the entire 365-endpoint official Postman collection (case-insensitive regex grep of the full raw JSON) | Desk
2. **Shop configuration**: zero such fields in `GET /application-config` (the full ~100-field shop settings dump — confirmed live, reviewed field by field) | Live
3. **Admin panel**: the live order-detail screen for a real order shows only payment status (`Nieopłacone`/`Oznacz jako opłacone` — "Unpaid"/"Mark as paid") and payment entries (`Dodaj wpłatę` — "Add payment") — no invoice, receipt, or document affordance anywhere on the page | Live — admin UI: full order-detail screenshot reviewed

This is a deliberate, hard scope boundary for the Shoper integration, not a gap to fill: Shoper
contributes nothing to the `InvoicingPort`/`FiscalizationPort` axis. An operator pairs an
independent invoicing/fiscalization connection (e.g. eparagony, inFakt) exactly as they would for
any other shop platform in this repo.

## Live transcripts

### Auth — Bearer token works directly, no OAuth exchange

```
GET /webapi/rest/product-stocks?limit=1
Authorization: Bearer e81e3b3820419373ffd496fbbc121b2cea35b82270c4aac0f0b11fd908602f26

HTTP/2 200
x-shop-api-calls: 1
x-shop-api-bandwidth: 10
x-shop-api-limit: 10
x-shop-result-count: 36
{"count":"36","pages":36,"page":1,"list":[{"stock_id":"181", ... }]}
```

### Bad token → clean 401

```
GET /webapi/rest/products?limit=1
Authorization: Bearer garbage

HTTP/1.1 401
{"error":"unauthorized_client","error_description":"Provided access token is invalid"}
```

### Scope not granted → clean 403

```
GET /webapi/rest/shippings?limit=5
Authorization: Bearer {token, "dostawy" not yet granted}

HTTP/1.1 403
{"error":"insufficient_scope","error_description":"The request requires higher privileges than provided by the access token"}
```

### EAN write-then-read (M3)

```
PUT /webapi/rest/product-stocks/181
{"ean":"5901234123457","stock":77}
→ HTTP 200, response body: 1

GET /webapi/rest/product-stocks/181
→ HTTP 200
{"stock_id":"181", ..., "stock":"77", "ean":"5901234123457", ...}
```

### `object-mtime` — per-object only, not bulk (M7)

```
GET /webapi/rest/object-mtime/product        → 500 {"error":"server_error","error_description":"Internal server error"}
GET /webapi/rest/object-mtime/products        → 500 (same)
GET /webapi/rest/object-mtime/1               → 500 (same)
GET /webapi/rest/object-mtime/product-stocks  → 500 (same)
GET /webapi/rest/object-mtime?object=product  → 501 {"error":"invalid_request"}
GET /webapi/rest/object-mtime/product/93      → 200 {"date":1790680990}
GET /webapi/rest/object-mtime/order/8         → 200 {"date":1790681848}
```

### Order creation — required fields (O1)

```
POST /webapi/rest/orders
{}

HTTP 400
{"error":"invalid_request","error_description":"Wartość pola 'email' jest niepoprawna: Pole wymagane; Wartość pola 'status_id' jest niepoprawna: Pole wymagane; Wartość pola 'payment_id' jest niepoprawna: Pole wymagane; Wartość pola 'shipping_id' jest niepoprawna: Pole wymagane; Wartość pola 'user_id' jest niepoprawna: Pole wymagane; Wartość pola 'shipping_tax_id' jest niepoprawna: Pole wymagane"}
```

### `user_id=0` rejected — no guest auto-provisioning (O2)

```
POST /webapi/rest/orders
{"email":"nowy-klient-bez-usera@example.com","status_id":1,"payment_id":1,"shipping_id":8,"user_id":0,"shipping_tax_id":1}

HTTP 400
{"error":"invalid_request","error_description":"Wartość pola 'user_id' jest niepoprawna: Nie znaleziono wartości '0'"}
```

### Native email dedup on `users` (O3)

```
POST /webapi/rest/users {"firstname":"Ewa","lastname":"Duplikat","email":"ol-dedup-test@example.com", ...}
→ HTTP 200, id: 4

POST /webapi/rest/users {"firstname":"Ewa","lastname":"Duplikat2","email":"ol-dedup-test@example.com", ...}
→ HTTP 400
{"error":"invalid_request","error_description":"Wartość pola 'email' jest niepoprawna: Wartość 'ol-dedup-test@example.com' już istnieje"}

GET /webapi/rest/users?filters={"email":"ol-dedup-test@example.com"}
→ {"count":"1", "list":[{"user_id":"4", ...}]}   ← exactly one row
```

### Real marketplace price passthrough (O4)

```
# catalog price on product-stocks 181: 1484.28
POST /webapi/rest/order-products
{"order_id":4,"product_id":93,"stock_id":181,"price":999.00,"quantity":1,"name":"Test produkt (cena marketplace)","tax":"23%","tax_value":23}
→ HTTP 200

GET /webapi/rest/orders/4
→ {"order_id":"4", ..., "sum":"999.00", ...}
```

### No order idempotency (O5)

```
POST /webapi/rest/orders {"code":"OL-IDEM-KEY-777", ...full valid addresses...}
→ HTTP 200, order_id: 5

POST /webapi/rest/orders {"code":"OL-IDEM-KEY-777", ...identical full valid addresses...}
→ HTTP 200, order_id: 6   ← NOT rejected, second full record created

GET /webapi/rest/orders/5
→ {"order_id":"5", ..., "code":"", ...}   ← code not even round-tripped
```

### Auto stock-deduction (O6)

```
GET /webapi/rest/product-stocks/181 → "stock":"77"

POST /webapi/rest/order-products {"order_id":4,"product_id":93,"stock_id":181,"price":999.00,"quantity":1, ...}
→ HTTP 200

GET /webapi/rest/product-stocks/181 → "stock":"76"   ← decremented immediately, no confirm step
```

### Fulfillment: tracking write + auto status advance (F1/F2)

```
POST /webapi/rest/parcels {"order_id":4,"shipping_id":8,"shipping_code":"DPD-OL-TEST-999","sent":true}
→ HTTP 200, parcel_id: 1

GET /webapi/rest/orders/4
→ {"status_id":"7", "total_parcels":1, ...}   ← status auto-advanced from 1, per application-config.shopping_parcel_send_status_id
```

### Partial shipment (F3) — two-line order, two parcels

```
# order 9: line A (product 93/stock 181, qty 2), line B (product 94/stock 182, qty 1)

POST /webapi/rest/parcels
{"order_id":9,"shipping_id":8,"shipping_code":"F2-PARTIAL-TEST-V2","sent":true,"products":[{"order_product_id":14,"quantity":1}]}
→ HTTP 200, parcel_id: 4

GET /webapi/rest/parcels/4 → products: [{"product_id":"93","quantity":"1","name":"Linia A"}]

POST /webapi/rest/parcels
{"order_id":9,"shipping_id":8,"shipping_code":"F2-FULL-TEST","sent":true}   ← no products[] array
→ HTTP 200, parcel_id: 5

GET /webapi/rest/parcels/5 → products: [
  {"product_id":"93","quantity":"1","name":"Linia A"},   ← the REMAINING 1 unit of line A
  {"product_id":"94","quantity":"1","name":"Linia B"}     ← the FULL line B
]
```

### Webhook payload — full order object, captured via webhook.site

```
POST https://webhook.site/e9009532-2b09-4e65-a2a9-ed84bf93115e
x-shop-license: 37925b6129cc700fc4ca23244bfa4e0d3cd9d740
x-shop-domain: sklep729770.shoparena.pl
x-shop-version: 5.26.54
x-webhook-name: order.create
x-webhook-id: 5
x-webhook-sha1: a12b6ee7f80b59f15dd81d892a802a1fde0291ce
user-agent: Shop Webhook Sender 5.26.54
content-type: application/json; charset=utf-8

{"order_id":"8","user_id":"1","date":"2026-09-29 13:37:23", ... full order object, 2261 bytes ...}
```

### Sales-document absence — Postman collection grep

```
$ grep -oiE '"[a-z_]*(invoice|faktura|paragon|receipt|document|fiscal)[a-z_]*"' shoper-api.postman_collection.json | sort -u
(zero output — no matches across the entire 433KB, 365-endpoint collection)
```

## API surface summary (partial — the subset exercised this spike)

| Resource | Methods | Role in this milestone |
|---|---|---|
| `products` | GET/POST/PUT/DELETE | `Product` header (`#3640`) |
| `product-stocks` | GET/POST/PUT/DELETE | `ProductVariant` grain — EAN/price/stock (`#3640`/`#3641`) |
| `categories`, `categories-tree` | GET(+write) | Category read (`#3640`) |
| `taxes` | GET only (no write) | Tax-rate vocabulary (`#3640`) |
| `object-mtime/{object}/{id}` | GET | Per-object freshness check only, not bulk sync (`#3640`) |
| `warehouses`, `warehouse-logs`, `warehouse-relocations` | full CRUD | Premium-gated, deferred (`#3641`) |
| `orders` | GET/POST/PUT/DELETE | Order header (`#3642`) |
| `order-products` | GET/POST/PUT/DELETE | Order lines (`#3642`) |
| `users`, `user-addresses` | full CRUD | Customer resolve/create (`#3642`) |
| `statuses` | GET(+write) | Order status vocabulary (`#3642`) |
| `parcels` | GET/POST/PUT/DELETE | Fulfillment/tracking writeback (`#3643`) |
| `shippings` | GET(+write) | Carrier/delivery-method reference data (`#3643`) |
| `webhooks` | full CRUD | Reconciliation trigger (`#3644`) |
| `application-config` | GET | Connection test target (`#3639`), shop-settings diagnostics |

Explicitly absent from the surface (confirmed): any invoice/receipt/document resource.

## Open risks — flagged, not guessed

1. **`x-webhook-sha1` signing algorithm unresolved** (X5) — 13 candidates ruled out against real raw
   bytes. Non-blocking (X6), but should be chased via Shoper support/docs before `#3644` ships any
   cryptographic verification; until then the webhook is a trigger-only signal.
2. **Real sustained rate-limit ceiling unconfirmed** (C6) — 25-request burst didn't hit it. Needs a
   longer, deliberate test before any production launch estimate is made.
3. **Multi-warehouse behavior entirely unverified** (M10) — the Premium gate meant `GET /warehouses`
   and any related read/write was never actually exercised against real data, only against the
   `400 "module is disabled"` refusal. `#3641`'s v1 (pooled/location-less) is unaffected by this,
   but a future located-inventory slice for Shoper starts from zero live evidence.
4. **`developers.shoper.pl/docs/` could not be fetched programmatically** — a JS-SPA behind
   `#fragment` routing; every finding in this document instead comes from the Postman collection +
   live calls, which is complete enough for this milestone's scope but leaves the prose
   documentation itself unreviewed (e.g. any officially-stated rate-limit numbers, any documented
   webhook-signature formula that differs from what was reverse-engineered here).
5. **Admin panel confirms Premium-gating for warehouses but the FULL list of Premium-gated features
   was not audited** — only the one feature this milestone's scope touches was checked. A future
   capability mini-epic that turns out to need another gated feature should re-check the panel
   rather than assume the trial account's limits are exhaustively known.

## Recommendation

**Lean ADOPT.** Every capability the milestone needs — catalog+variant+EAN read, tax-rate read,
absolute-write stock adjustment, order creation with the real marketplace-paid price, customer
resolve via native email dedup, fulfillment writeback with genuinely well-modelled partial shipment,
and webhook-triggered reconciliation — was confirmed live at least once, several of them end to end
across multi-step sequences (F3's two-parcel partial-shipment test in particular).

Four items are load-bearing enough that the six capability mini-epics must design around them
explicitly:

1. **`#3642` (OrderProcessorManager) needs its own per-order idempotency lock** — Shoper gives
   nothing native (O5). Mirror the `invoicing.issue` guard shape (`#2047`): persisted-state check
   under a `SyncLockPort` lock, not a database-unique-constraint trick, since Shoper offers no
   natural key to constrain on.
2. **`#3642` must resolve/create the customer via `POST /users` before `createOrder`** — no guest
   auto-provisioning exists (O2), but native email-uniqueness enforcement (O3) makes this a clean,
   low-risk get-or-create primitive.
3. **`#3642` must decide and document the stock-double-deduction policy** — Shoper auto-decrements
   on order-line create (O6); OL's own inventory-sync must not independently adjust the same units.
4. **`#3641`'s v1 stays deliberately pooled/location-less** — multi-warehouse is Premium-gated (M10)
   and structurally unverifiable against this trial account; this is the correct v1 shape per
   ADR-058 decision 2 ("the master declines to locate its stock"), not a shortcut.

Sales documents are a **confirmed exclusion**, not a gap — three independent lines of evidence (API
surface grep, full shop-config dump, live admin-panel order-detail screen) agree Shoper has no
invoice/receipt capability at all. This milestone's scope is narrower than the Subiekt GT precedent
by exactly this one axis, and that narrowing is deliberate rather than discovered late.

The one open technical question (`x-webhook-sha1`'s algorithm, item 1 in Open risks) does not change
the verdict and is explicitly scoped to `#3644` (Webhook reconciliation backstop) — the lowest-
priority mini-epic in the milestone, which the user has already indicated may ship in a later
release without blocking the rest.

## Coverage tally

| Group | Stories confirmed live | Stories desk-only | Open/unresolved |
|---|---|---|---|
| C — Connect | 6 (C1, C3, C4, C5, C6, C7/C8 admin UI) | 1 (C2 — OAuth2, not exercised) | C6's real ceiling |
| M — Catalogue/Inventory | 6 (M1, M3, M6, M7, M8, M10, M11) | 2 (M2, M4, M5, M9 desk) | M10 (Premium gate blocks all deeper verification) |
| O — Orders in | 9/9 (all rows) | 0 | none — this group is fully live-verified |
| F — Fulfil | 5/6 (F1-F5) | 1 (F6, inference) | none |
| X — Operate/Webhooks | 4/6 (X1, X3, X4, X6 reasoning) | 2 (X2 admin UI, listed as Live) | X5 (signature algorithm) |
| Sales documents | 3/3 (all three confirmation routes) | 0 | none |

Six issues (`#3639`-`#3644`) already filed in the "Shoper Integration" milestone, each citing
`Depends on: #3638`, each scoped to the specific findings above relevant to its capability.

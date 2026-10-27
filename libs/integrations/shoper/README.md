# @openlinker/integrations-shoper

OpenLinker adapter for [Shoper](https://www.shoper.pl) (Polish SaaS e-commerce platform), REST API.

**Status:** the "Shoper MVP Integration" milestone is complete (released in v0.16.1). The adapter advertises
six capabilities: `ProductMaster` (#3640: products, variants, categories, tax rate, deletion detection),
`InventoryMaster` (#3641), `OrderProcessorManager` (#3642) with fulfilment writeback as a Shoper parcel (#3643),
`OrderSource` (#3711), `ProductPublisher` (#3712) and `CategoryProvisioner` (#3713). Only `ProductMaster` and
`InventoryMaster` are enabled by default on a new connection; the other four are opt-in. #3806 completed the
capability map on top of that: the shop's category tree, attributes and product status for the publish pickers
(`ShopCategoryBrowser`, `ShopAttributeReader`, `ShopProductStatusReader`), delta and bulk catalogue reads,
fulfilment read-back, signed webhooks (#3644), one shared request budget per shop and product GPSR data. A guided
setup wizard is in the web UI (#3702). See "Known gaps" for what is still open. Evidence base:
`docs/plans/analysis/SPIKE-3638-shoper-rest-api.md` and the live findings recorded in
`docs/plans/implementation-plan-shoper-product-master-read.md`.

| | |
|---|---|
| Adapter key | `shoper.restapi.v1` |
| Platform type | `shoper` |
| Auth | static Bearer token, issued per shop (no OAuth exchange) |
| Sales documents (invoice / receipt) | **out of scope by design** - Shoper's API has none |

## Connection config

```json
{ "baseUrl": "xxxxx.shoparena.pl" }
```

`baseUrl` is the shop's own host. An `https://` URL naming only that host is accepted and normalised.
Rejected: `http://`, a path / query / port / credentials, IP addresses, `localhost`, single-label
hosts and reserved / private suffixes (`.internal`, `.local`, `.lan`, ...). The token travels on every request, so HTTPS is the only transport.

In the web UI, pick Shoper under **New connection**: a guided setup asks for the shop address and the token.
To create the connection through the API instead, send `platformType: "shoper"` and
`adapterKey: "shoper.restapi.v1"`.

## Credentials

```json
{ "token": "<Token API>" }
```

Create it in the shop admin panel: **Dodaj integrację** -> the panel issues a *Client ID* and a *Token API*.
Only the token is stored; it is used directly as `Authorization: Bearer <token>`.

### Permissions to grant

Shoper enforces access per area server-side (`403 insufficient_scope`). In the integration's
**Obszar sklepu x Zakres dostępu** table grant these areas (the capabilities that use each one arrive with
the rest of the milestone, so grant them up front to avoid re-visiting the panel). The connection test
itself needs none of them and its 403 message names none:

produkty, warianty produktów, stany dostępności, kategorie, stawki vat, magazyny, zamówienia, przesyłki,
statusy zamówień, klienci, webhooki, dostawy, płatności

(`SHOPER_REQUIRED_SCOPES` in `src/shoper.constants.ts` is the same list.)

## Connection test

`GET https://<baseUrl>/webapi/rest/application-config` with the Bearer token.

| Result | Meaning |
|---|---|
| `200` | host is a Shoper shop and the token is valid (the body must look like `application-config`; a bare 200, an empty or non-JSON page fails) |
| `401` | token invalid or revoked |
| `403` | the request was refused; this probe needs no area, so check the integration is active and unrestricted |
| `404` | host is not a Shoper shop |

A passing test does **not** prove every area above was granted; each capability reports its own missing area.

## ProductMaster (read)

| Port method | Shoper call |
|---|---|
| `getProduct` | `GET /products/:id` |
| `getProducts` / `searchProducts` | `GET /products` (paged; `filters={"product_id":{"in":[...]}}`, `filters={"translations.name":{"like":"%q%"}}`) |
| `getProductVariants` | `GET /product-stocks?filters[product_id]=:id` (all pages) |
| `listExternalIds` | `GET /products?order=product_id ASC` (paged) |
| `getCategories` | `GET /categories-tree` (structure) + `GET /categories` (names, all pages) |
| `getProductCategories` | `GET /products/:id` -> `categories` ids resolved through `getCategories` |
| `readProductTaxRate` (`ProductTaxRateReader`) | `GET /products/:id` -> `tax_id` -> `GET /taxes` row (table read once per adapter) |

- **Tax rate** (ADR-063) is read by row NAME, never `value` alone: `0%`, `zw.` and `np.` all carry `value: "0"`.
  `23%`->`23`, `8%`->`8`, `5%`->`5`, `0%`->`0`, `zw.`->`zw`, `np.`->`np`. The name is a free label a merchant
  can edit, so it is **cross-checked against `value`** (a percentage name must equal `Number(value)`, an
  exemption must carry 0); a row that contradicts itself is `unreadable`, since two disagreeing fields are a
  guess. `oo` is not mapped: no live row has carried it, and an unrecognised name is `unreadable` anyway.
  No `tax_id` is `not-configured`; so is `tax_id` `"0"`, which is an ASSUMPTION ("no tax group", as in
  PrestaShop) not verified live - the trial shop only carries real tax ids. It errs towards holding the
  document rather than issuing one at a rate nobody chose;
  an unknown `tax_id` or unrecognised name is `unreadable` (not persisted); a transport failure throws. There
  is no fallback to the shop default or to 23%. Tax lives on the product (`readsTaxRatePerVariant()` is false)
  and the table is not country-scoped (`countryIso2: null`). Guard-narrowed, not in the manifest - as for the
  sibling plugins.

- **Categories** live in two resources: `categories-tree` carries ids and children only (no names), and the
  paged `categories` list carries the per-language name and `active`. They are joined by id; a listed category
  missing from the tree is returned without a parent; a tree node with no record, and a category with no name
  in any language, are dropped (no invented label); all three are logged. A tree response that is not an array
  is an error, not "no structure" - only a real `[]` means an empty tree.
  The directory is built once per adapter instance (a promise memo, failures not kept) and `getProduct` /
  `getProductCategories` share one `GET /products/:id`, so resolving categories for many products does not
  re-read the directory per product. `getProductCategories` reads the product through the same translating
  read as `getProduct`, so a product Shoper reports gone is the neutral `MasterProductNotFoundError` there too.

- **Variants:** one `product-stocks` row = one `ProductVariant`, keyed by its real `stock_id`. No synthetic
  variant is minted for a simple product - Shoper already gives it a stock row. A product WITH variants also has a
  base row (`options: []`) no buyer can pick: it is not a variant and its stock is not counted, but variant prices
  and weights are read relative to it (`price_type` / `weight_type`: `0` keep base, `1` own, `2` base plus, `3` base
  minus; an unknown code leaves the value unset).
- **Variant attributes (#3706):** a stock's `options` is `{ "<option_id>": "<ovalue_id>" }` - ids only (live:
  product 127; a stock with none carries `[]`, not `{}`). The names come from `GET /options/:id`
  (`translations[lang].name`) and `GET /option-values?filters[option_id]=:id` (`translations[lang].value`), read once
  per option per adapter and mapped to `ProductVariant.attributes` (`{ Kolor: "biszkoptowy" }`) in the shop language,
  so Erli's explicit variant grouping (#986) gets distinguishing values. **All or nothing**: a variant whose options
  cannot ALL be resolved (unknown option or value, no readable text, two options sharing a name, an option-values
  filter Shoper did not honour) syncs with `attributes: null` and a warning - never a partial set, never a guess. A
  transport failure on those reads propagates rather than wiping attributes a variant already had. `options_non_stock`
  (product add-ons with a price change) and `products.options` (a list of non-default stock ids) are not variant options.
- **Text** is read from `translations[<shop default language>]` (`application-config.default_language_name`);
  the translations' own `isdefault` flag reads `"0"` on every language and is not used.
- **Images:** only the main image, `https://<host>/userdata/public/gfx/<unic_name>.<extension>`.
- **GPSR** (EU 2023/988): the product's `safety_information` ids are resolved against the
  `product-safety-producers` / `-responsibles` / `-importers` / `-certificates` registries into the neutral
  `Product.gpsr` (producer, responsible person, importer, certificate names). A registry is read only when a
  product references it, whole and at most once per adapter instance; a failed or dangling reference leaves
  `gpsr` unknown (the stored value is kept) and logs a warning, never fails the product. Certificate
  descriptions are not product safety text and are not mapped. Modelled from the published API schema, not
  yet seen on a live payload - in particular whether the `/products` LIST embeds `safety_information` (a batch
  prefetch reads it from there) is unverified.
- Writes throw `ShoperNotSupportedException`.

Paging (all observed on a live shop):

- Shoper pages by **page index** and **caps a page at 50 rows; a larger `limit` is silently reduced to 10**.
- The `{limit, offset}` a caller passes is its own **window** (a sweep's budget, 100 by default, up to 500 and
  changeable at runtime), not a Shoper page. The adapter covers any window with pages of 50 and slices, so
  any `limit` up to 1000 and any `offset` is served exactly - nothing is refused and no window is shifted.
  It never sends a page above 50, and stops only on the shop's own last page, never on a short page.
- A bare `order=<field>` sorts descending; the adapter always sends an explicit `ASC`.
- `filters[category_id]` and `filters[code]` are not valid on `products` (the shop answers 404); the
  `categoryIds` and `status` filters are therefore refused rather than ignored.

### Upgrade note: the base stock of a variant product is no longer a variant

Before this release a product with variants also synced its base stock row (`options: []`) as a
`ProductVariant`, although no buyer can pick it. It is now kept aside (see **Variants** above). On an
install that already synced such a product, the change is visible on the first master sync after the
deploy, with no operator action:

- The base-row variant is no longer reported, so the variant prune marks it **stale**.
- Any marketplace offer listed against that variant is **paused** by the stale-variant chain (#1689):
  its quantity is set to 0. That offer was selling an item that does not exist, so this is the intended
  outcome, not a regression.
- **Remediation:** list the product again per colour/size variant (the bulk offer wizard offers each
  real variant). The paused offer stays paused; end it on the marketplace if it should not linger.

Products with no variant rows are unaffected: their base stock stays their single variant.

### Deletion and the catalogue sweeps

- **A deleted product** surfaces from `getProduct` as the neutral `MasterProductNotFoundError`, which core
  turns into stale variants and (via the stale-variant chain) paused offers. The translation is deliberately
  narrow: only a `404` carrying Shoper's own `invalid_request` envelope counts (`ShoperApiError.isResourceNotFound`).
  A bare `404` - a wrong or moved host, a proxy page - stays a plain `ShoperApiError`, because reading it as a
  deletion would stale the whole catalogue on a configuration error. Shoper answers a wrong *path* with `400`,
  so a `404` with the envelope really means "no such resource". A product that resolves but has no stock rows
  is an inferred absence and is not translated.
  A bare `404` is **retryable**, because it is ambiguous: a proxy or maintenance page clears, a wrong `baseUrl`
  does not. The latter is stopped at save time by the connection tester and config validator; if one slips
  through, its jobs end on the ordinary retry ladder instead of staling anything.
- **The same translation applies to every method that reads the product** (`getProduct`,
  `getProductCategories`, `readProductTaxRate`) - they share one read, so core reports the deletion whichever it
  reaches first. The retry classifier agrees with it: a 404 is terminal only when it carries Shoper's envelope;
  a bare 404 (a proxy or maintenance page) is retried.
- **What to re-check if Shoper changes**: the safety of `isResourceNotFound` rests on two live observations
  (SPIKE-3638 M6, re-probed for #3678): a missing resource answers `404` + `{"error":"invalid_request",...}`, and
  a wrong *path* answers `400`, not `404`. The failure mode of getting it wrong is staling a whole catalogue and
  pausing live offers, so if Shoper ever changes the error envelope or the status for a missing resource,
  re-probe `GET /products/999999999`, `GET /products/abc` and `GET /nonexistent/1` first.
- **Offset paging and a mid-cycle delete.** `listExternalIds` pages by offset over an ascending-id collection,
  so a delete during a multi-tick cycle shifts later rows left and the cycle can step over one live product for
  that cycle. That is acceptable only because absence is never a deletion signal: `master.product.reconcile`
  enumerates OpenLinker's own mappings and re-reads each product, and deletion is concluded solely from
  Shoper's explicit 404. A skipped product is picked up by the next cycle; it is never staled for being missing.
- **Batched catalogue reads (`BulkProductReader`).** The catalogue sweep's batch child warms a page of products
  before its per-product loop: per 50 ids one `/products` read (`product_id in`) and one filtered
  `/product-stocks` read, so `getProduct`, the tax-rate read and `getProductVariants` then cost nothing - about
  2-3 requests per 50 products instead of two per product. An id the shop did not return is left unwarmed, so its
  own read still reports a deletion; a failed or filter-ignoring prefetch falls back to per-product reads.
- **The sweeps need no Shoper-specific scheduler code.** `master.product.syncAll`, `master.product.reconcile`
  (the deletion audit) and `master.product.syncDelta` are registered core-side by capability
  (`CORE_CAPABILITY_TASKS`, `capability: 'ProductMaster'`), so declaring `ProductMaster` is what enrols a
  connection. They walk the catalogue through `listExternalIds`, which pages in ascending `product_id` order.
- **Modified-since rung (`ModifiedProductLister`).** `/products` accepts
  `filters={"edit_date":{">=":"YYYY-MM-DD HH:MM:SS"}}` (live-verified), so the opt-in delta pass
  (`OL_MASTER_PRODUCT_DELTA_SYNC_ENABLED`) can read only changed products. The bound is rendered in the shop's
  own zone (`locale_timezone`) and only ever errs early: an unknown zone widens it by 14 h, a DST fall-back
  moves it back an hour. Results are ordered by `product_id`, not `edit_date`, so a product edited mid-cycle
  does not move and cannot shift another one out of the window. `edit_date` bumps on a name or category
  edit, a variant stock/price write through the API, a variant add, a sale and an order line added; it does
  **not** bump on a variant deleted through the API, an image added or removed, or stock returned (an order
  line deleted, "return to stock"). Those reach OpenLinker only through the full pass, which therefore stays.
- **Product webhooks are a trigger (#2647).** With `ProductMaster` enabled, "Configure webhooks" also
  subscribes `product.create`, `product.edit` and `product.delete`; each routes to
  `master.product.syncByExternalId`, which re-reads the product. Nothing in the delivery body is used, and a
  delete is concluded only from the re-read's 404 envelope. A connection installed before this needs install
  re-run to gain the product events. Shoper does not retry a failed delivery, so the periodic `reconcile` audit
  stays the deletion backstop and the sweeps stay the change backstop. A panel stock edit also fires
  `product.edit`; it re-syncs the product, while the stock itself still arrives through the inventory sweep.

## InventoryMaster (read)

Declared as `InventoryMaster` (#3686). Enable it on the connection's `enabledCapabilities` - the list is stamped
at create and never retro-filled, so an existing connection must be edited.

- **One `Inventory` per `product-stocks` row.** The row is the variant grain, keyed by the same `stock_id` the
  ProductMaster already minted a variant for. Stock is pooled and location-less (`locationId` undefined,
  ADR-058) and `reserved` is always 0 - Shoper has no reservation concept.
- `getInventory` returns the FIRST row for a multi-variant product (the WooCommerce contract); use
  `listInventory` for per-variant stock.
- **Multi-warehouse shops are refused** (`application-config.warehouses_enabled` on, or the flag missing or not
  recognisably off): with the module active, `stock` is not known to be the whole pool, and a wrong level would
  be published to marketplaces. The error is terminal. It is raised per product, so on such a shop every product
  in an inventory sweep cycle ends as its own dead job - keep the connection to `ProductMaster` only.
- **Batched stock reads (`BulkInventoryReader`).** The inventory sweep's batch child reads a page's stock rows in
  one filtered `/product-stocks` read per 50 products (`product_id in`). A product with no rows in that answer is
  probed exactly as on the per-product path, so deletion is still decided by the shop's own 404.
  `adjustInventory` never uses the warm copy.
- **An unreadable stock level is an error, never 0** - reading it as zero would zero a live offer. Retryable.
- **Deletion** is reported only when Shoper itself says the product is gone (its own 404 envelope), as the
  neutral `MasterProductNotFoundError`. The product is only probed when its stock listing comes back empty (or
  answers a 404), so a normal sweep costs one request per product, not two.
- **A product with no stock rows is an error from `listInventory` too, never an empty list** - an inferred
  absence, raised as the retryable `ShoperStockNotFoundException`. The inventory sync prunes on an empty
  response, which would stale every variant and pause its offers for a product that still exists; every Shoper
  product carries at least one stock row, so an empty answer is an anomaly.
- **`adjustInventory` is read-modify-write, and not atomic** (#3687). Shoper's `PUT /product-stocks/:id` takes an
  absolute `stock` and has no conditional write or idempotency key, so the adapter reads the row, adds the delta
  and writes the result. A sale between the read and the PUT (Shoper also decrements stock by itself when an
  order line is created) is overwritten, and a retry after a lost response applies the delta twice. The outcome
  is therefore always reported `idempotency: 'unsupported'`, `appliedAt: null`. A decrease below zero is clamped
  to 0 with a warning. A multi-variant product needs `variantId`; without it the write is refused (terminal) rather than
  moved to a guessed variant. The level Shoper holds after the PUT is read back and reported, so a change landing after the write shows up as a
  warning and the real number is what propagates.
- **Known gap (epic #3641): concurrent sale decrements can still oversell.** `adjustInventory` is also called by
  `inventory.saleDecrement` / `inventory.saleReversal` (#3453), not only by return restocking. Two such jobs for one
  Shoper variant can both read the same level and both write it minus one - a lost decrement. Shoper has no atomic
  or conditional stock write, so this is not closable in the adapter, and the read-back does NOT detect it (it runs
  after the PUT and sees only what was written). Do not
  enable OMS routing on a Shoper `InventoryMaster` expecting a safe decrement until a core-side per-position lock
  exists. Multi-warehouse shops are refused, as on the read side. `reason` goes to the log.
- `reserveInventory` / `releaseInventory` are deprecated by
  ADR-061 and throw `ShoperNotSupportedException`.
- `master.inventory.syncAll` walks OL's own product mappings, so run a ProductMaster sync first.

## OrderProcessorManager

Declared as `OrderProcessorManager` (#3692, #3693, #3694). **It is not enabled by default**: a new connection gets only
`ProductMaster` and `InventoryMaster` (`defaultEnabledCapabilities`), because core fans every ingested order out to
every active `OrderProcessorManager` connection and a shop meant as a catalogue / stock master must not start
receiving orders. Enable it explicitly on the connection's `enabledCapabilities` - the list is stamped at create and
never retro-filled. The stock double-deduction policy (#3695) is not decided yet.

`createOrder` resolves everything first and writes second, because Shoper decrements stock as each line is
created: user, variants, taxes, the three required ids, currency and prices are settled before the first write.
Then `POST /orders` (header) and one `POST /order-products` per line, at the buyer-paid **gross** price (ADR-014;
a Shoper line `price` is gross). The result is the Shoper-native order id.

The adapter also declares `OrderCreateStockEffect`: `lowersStockOnOrderCreate()` answers from the shop's own
`shopping_update_stock_on_buy` setting (the cached shop context). Core reads it after the create to decide whether
the order's advisory holds on this shop's stock can be consumed as already absorbed. With the setting on, the shop
lowered its stock and the holds are consumed; with it off (the owner keeps stock in an ERP or WMS), the shop's
stock did not move, so the holds stay until dispatch rather than letting OpenLinker over-promise.

**Header ids** (`shipping_id`, `payment_id`, `status_id`) are ids of rows in the shop's own `/shippings`,
`/payments`, `/statuses`; Shoper has no catch-all, so OpenLinker never guesses one:

- shipping: the operator's carrier mapping for the source delivery method, else `config.defaults.shippingId`;
- status: the operator's order-state mapping, else `config.defaults.statusId`;
- payment: `config.defaults.paymentId` only (the order carries no payment-method name to map);
- with none of these set the order fails before any write, naming the key to set.

The adapter also implements `DestinationOptionsReader` (`GET /shippings`, `/statuses`, `/payments`, every page), so
the connection's Mappings page can offer the shop's own rows when an operator maps a source delivery method or order
state. The mapping value is the Shoper id `createOrder` writes. Payment methods are listed for the same screen but no
payment mapping is consumed yet.

`shipping_tax_id` is read from the chosen shipping method (`GET /shippings/:id`), `currency_id` from `/currencies`
by ISO code, and each line's `tax`/`tax_value` from `/taxes` by the line's rate code. A currency, tax or shipping
method the shop does not have is `ShoperOrderUnbuildableException` (terminal, before any write).

**Net-priced sources:** Shoper amounts are gross and OpenLinker computes no tax (ADR-063), so a net-priced line
needs the source-reported `unitPriceGross`, and net-priced shipping needs `shippingGross` (a zero cost needs none);
without them the order is refused rather than written with a net figure.

**Payment state:** an order the source reports as `paid` is created with `paid` equal to the order sum, which Shoper
reads as paid (verified live: `is_paid: true`). Any other or unknown state sends no `paid` amount, so a cash-on-delivery
or awaiting order stays unpaid in the shop.

**Phone is required** on both Shoper addresses (an empty one is a 400). The address's own is used, else the other
address's. When the source gives no phone at all (Allegro shows it only after payment), the order is created with the
placeholder `100000000` (Shoper validates the format: all zeros are refused; a leading 1 is never a Polish subscriber number), and the order's remarks (`notes`) say the number is a placeholder.
The placeholder is written back: on the next sync after the marketplace provides the phone (for Allegro, once the
order is paid), the adapter's `OrderContactRefresher` reads the shop order (`GET /orders/:id`) and, only for an address
whose phone is still the placeholder, writes the real one (`PUT /orders/:id` with just `phone`; Shoper keeps every
other address field). The remark is cleared at the same time, but only while it is still exactly the placeholder
note, so an operator's own notes are never touched. A phone an operator already fixed by hand is left alone.

**A half-built order is removed.** If a line fails after the header exists, `DELETE /orders/:id` is issued (live:
this restores the stock the lines took). If that fails too, `ShoperPartialOrderException` names the order id; it is
retryable, because the retry finds that header by its marker (below), deletes it and recreates the order.

**No duplicates on retry (#3694).** Shoper has no idempotency of its own: it does not round-trip the order `code`
and accepts two orders with the same one (SPIKE-3638 O5). Two layers cover it:

- core's `OrderSyncService` holds a per-(order, destination) lock and skips when a destination mapping is already
  recorded - no new core seam was needed;
- the window that leaves (the order was created on Shoper but the mapping was never written, or the response was
  lost) is closed here. Every order carries `notes_priv = "OpenLinker order <internalOrderId>"`, and Shoper's
  `GET /orders?filters[notes_priv]=` is an exact-match filter (verified live), so `createOrder` first asks whether
  an order with that marker exists: a **complete** one (its `/order-products` line count equals the lines to be
  created) is returned as the result and nothing is written; an **incomplete** one is deleted - restoring its stock -
  and the order is created afresh, never completed in place, **but only while it is still in the status OpenLinker
  created it in**: a line-count mismatch is also what a merchant editing the order looks like, so an order that
  has left that status is left alone and `ShoperOrderModifiedException` (terminal) names it; **several** are refused with
  `ShoperDuplicateOrderException` (terminal, naming the ids) because picking one silently could keep the wrong one.
  The lookup costs one extra `GET` per order.
- **Limits, stated plainly.** "Complete" compares the NUMBER of lines only, so an order that changed at the source
  between two attempts is returned as it stands - `createOrder` does not re-sync content. An unreadable line count is
  an error (retryable), never "incomplete": the guard does not delete on a value it could not read. The marker lives
  in `notes_priv`, which a merchant can edit or clear in the admin; an edited marker turns recovery into "no hit",
  and the retry then creates a second order. Shoper offers no other round-tripped field to carry it (SPIKE-3638 O5).
- `createOrder` therefore requires `OrderCreate.internalOrderId` and refuses an order without it - with no key a
  retry could not recognise its own order.

**Customer.** Shoper rejects `user_id = 0` and does not provision a guest, so `ShoperCustomerProvisioner` resolves
or creates the user: an existing `Customer` mapping wins; otherwise, under a lock per (connection, email hash),
`POST /users`, and on Shoper's duplicate-email `400` the existing user is found with
`GET /users?filters[email]=` and reused. **There is no guest fallback** (unlike WooCommerce): an order with no
usable buyer email (a source that reports none, or `OL_STORE_PII=false`) fails with
`ShoperCustomerUnresolvableException`, a terminal error.

Verified on a trial shop (2026-10): `POST /users` with `email`, `firstname`, `lastname`, `active` answers the bare
user id; the order payload above creates an order whose `sum` is lines + `shipping_cost`.

**Stock policy (#3695): Shoper decrements its own stock, OpenLinker never does it a second time.** Shoper removes
stock the moment an order line is created (`shopping_update_stock_on_buy`; live: 74 -> 72 for a quantity-2 line,
and back to 74 after `DELETE /orders/:id`). So:

- the only stock write OpenLinker ever makes to a Shoper `InventoryMaster` is `adjustInventory`, whose single
  production caller is a **return restock** - a positive correction for goods that came back, never a sale. The
  closed `InventoryAdjustment.reason` set (`return_restock | manual_correction`) has no sale reason, so core cannot
  express one;
- `createOrder` never writes stock and never compensates for the decrement Shoper made (a spec fails if the order flow
  issues a `PUT` or any non-`GET` to `/product-stocks`; `adjustInventory`, the return restock, legitimately does
  `PUT /product-stocks/:id`);
- the inventory sync is read-only and publishes the master's number as an **absolute** quantity, so after an order
  the already-lowered Shoper figure is simply mirrored - nothing is applied twice;
- a failed or retried order leaves the stock where one order would: a rolled-back header restores it (above), and
  the duplicate recovery of #3694 returns the existing order instead of creating a second one.

**When the shop does not decrement stock itself** (`shopping_update_stock_on_buy` off, e.g. an ERP/WMS does it),
the order is still created and OpenLinker still writes nothing: compensating would be the double deduction the
shop owner chose to avoid elsewhere. A warning naming the config key is logged for each such order, and the shop's
stock - and therefore what OpenLinker mirrors and publishes - stays unchanged until the shop reduces it. A missing
or unrecognised value reads as ON, the shop default.

The advisory reservation ledger (ADR-061) is a separate, core-level mechanism and is not changed here; on the
default `omp_fulfilled` topology its holds are `diagnostic` and subtract nothing.

**Known gap: a cancelled order strands its stock.** OpenLinker cannot cancel or delete the Shoper order when the
source order is cancelled (no Shoper cancel capability yet), so Shoper keeps the units decremented while the
marketplace offer is restored from master availability, which still excludes them. Those units do not return to
sale until someone cancels the order in the shop. Closing it needs a Shoper order-cancellation capability.

**What the tests prove.** `shoper-stock-policy.spec.ts` drives the real adapters against a fake shop that mirrors the
behaviour observed on a trial shop in 2026-10 (decrement when a line is created, restore on `DELETE /orders/:id`).
It proves OpenLinker adds no second decrement; it cannot notice Shoper behaving differently (a plan that decrements
at a status change, or a `DELETE` whose restore depends on order status). The live checks in the PR are the
evidence for the real shop.

Not covered: **pickup points** (a locker order lands as a plain delivery to the buyer's address, so the warehouse
must read the pickup point from the source order), cancelling a Shoper order from OpenLinker (see the gap above).

### Fulfillment writeback (#3643)

When OpenLinker ships an order it pushed into Shoper, the lifecycle relay (ADR-027) sends the Shoper connection a
`dispatched` event like any other order participant, and the adapter records it as a **Shoper parcel**:

- `POST /parcels { order_id, shipping_id, shipping_code, sent: true }`. `shipping_code` is the tracking number;
  `shipping_id` is first the Shoper order's own method (`GET /orders/:id`), so the parcel carries the carrier the
  buyer chose.
- **Fallback method.** Shoper's API refuses a parcel for some carrier-integrated methods (InPost, DPD, ... on the
  trial shop) with a `400` whose description is "Nie znaleziono wartości". On exactly that answer - Shoper created
  nothing - the parcel is written once more under `defaults.parcelShippingId` if set, else the shop's first active
  plain (`personal`) method, else the dispatch is `rejected` naming that config key. Any other `400`, a `5xx` or a
  timeout is reported as `rejected` without a fallback, so a request that may have landed is never repeated.
- **A refused method is remembered** per connection for 24 hours through the host cache
  (`shoper:parcel-shipping-refusal:<connection>:<host>:<shipping id>`), so each method costs at most one refused
  `POST` a day rather than one per dispatch. Without a cache the memory lasts one adapter bag, which degrades to
  "try the order's method, then fall back" on every dispatch.
- **No `products[]`.** Shoper then ships exactly the quantity still unshipped on each line, which is the whole
  order the first time (#3638). Creating the parcel advances the order status per the shop's own
  `shopping_parcel_send_status_id`; no separate status call is made.
- **Idempotent.** The order's parcels are read first (`GET /parcels?filters[order_id]=`). The same tracking number
  already on a parcel, or a dispatch without tracking once a parcel exists, writes nothing. A tracking number
  arriving after the parcel (the late-waybill path, #1947) is attached to the single untracked parcel with
  `PUT /parcels/:id` instead of creating a second one.
- A parcel under **another** tracking number (a carrier change, a reprinted label) is refused as `rejected`:
  without `products[]` a second parcel would ship a remainder of zero, and the event carries no lines to say what
  a second shipment contains.
- A dispatch without a tracking number still creates the parcel with `sent: true`. On Shoper that typically
  advances the order status and may email the buyer, so the buyer can receive a message with an empty number; the
  number arrives later as a silent `PUT`.
- An ignored `filters[order_id]` is detected, not assumed away: a parcel row of another order in the answer proves
  the filter was not honoured, and the write is `rejected` instead of reading it as "no parcels" and creating a
  duplicate. The read is bounded to one page (`limit` 50); an order with more parcels than that is refused too.
- There is no lock around the read-then-write: a conditional relay claim already serialises the triggers -
  `Shipment.waybillRelayedAt` (#1947) for a shipment-grain dispatch, `fulfillment_works.dispatchRelayedAt` (#2401)
  for a router-fulfilled work.
- `cancelled` answers `unsupported` (no Shoper cancel OpenLinker can drive), so the operator sees it, never silence.
- Any failed call answers `rejected` with the reason; the relay surfaces it.

**Not verified live**: the parcel calls follow the #3638 spike as recorded in the issue; `PUT /parcels/:id` and the
`filters[order_id]` filter on `/parcels` were not exercised against a shop from this branch.

**Partial shipment is not expressed.** The `dispatched` event carries no lines, and the line -> `order_product_id`
mapping is not persisted at `createOrder`, so a parcel always ships the remainder. Shoper itself supports
`products: [{ order_product_id, quantity }]`; using it needs both of those first.

## OrderSource

`ShoperOrderSourceAdapter` ingests orders placed in the shop (#3711). It is **opt-in**: `OrderSource` is in
`supportedCapabilities` but not in `defaultEnabledCapabilities`, so a connection that exists only as a catalogue
master never starts polling orders. Once enabled, the `shoper-orders-poll` task backstops webhooks every 10 minutes
(`OL_SHOPER_POLL_SCHEDULER_ENABLED`); the cadence is relaxed because webhooks carry the primary load and the shop's
request budget (about 10 req/s per shop, shared by every integration on it - see *Known gaps*) is better spent on the
work a delivery triggers. Enabling `OrderSource` on a connection still opts it into the core tasks scoped to that capability (automation deadline sweep,
`returns.orphan.reconcile`, the order FX stamp sweep and the tax-rate backfill); none of them calls the shop's API.

- **Feed (`listOrderFeed`)**: an `order_id` keyset - `order=order_id ASC` plus `filters[order_id][>]=<cursor>`
  (both live-verified). The cursor is the highest id seen, so no date, time zone or same-second edge is involved.
  `limit` is capped at 50: Shoper silently answers 10 for anything larger.
- **Order (`getOrder`)**: `GET /orders/:id` plus `GET /order-products?filters[order_id]=:id` - the order row carries
  no lines. A line of another order in the answer proves the filter was ignored and the read is refused.
- **Status**: `GET /statuses` `type` (1 new, 2 processing, 3 shipped, 4 terminal) becomes
  `pending / processing / shipped`. Type 4 covers cancelled, rejected AND returned, so the status labels decide:
  a label in the refund vocabulary (`zwrócone`, `refunded`, `returned`, ...) reads as `refunded`, anything else as
  `cancelled` - the split PrestaShop makes the same way. A terminal status in a language outside that vocabulary
  reads as `cancelled`; an unlisted status reads as `pending` and is warned about. A terminal order reports no
  `paymentStatus`.
- **Events**: an order that is already cancelled or refunded when first seen is reported as `cancelled`, which core
  routes through the cancellation relay instead of the create/update path; everything else is `created`.
- **Payment**: reports `paid` (Shoper's `is_paid`) or `cod` (`is_cash_on_delivery`, the "Pobranie" method) and otherwise
  nothing. `awaiting` is never reported: it blocks shipping labels, and Shoper cannot tell an unpaid prepay order
  from one paid at pickup. A terminal order reports nothing.
- **Price and tax**: a line's `price` is the gross unit price the buyer paid and passes through untouched; the totals
  are declared `inclusive`. A line's tax rate is read from its stored tax name and left **absent** when unreadable.
  The tax in the totals is derived by division and is informational.
- **Time zone**: Shoper timestamps are naive and shop-local. The zone comes from `application-config.locale_timezone`;
  without it they are read as UTC.
- **Buyer tax id**: `tax_identification_number`, blank reads as *unknown*, never as *asserted none*.

**An order OpenLinker created in the shop is not re-ingested.** Core already skips a re-read of an order whose internal
id belongs to another connection (the destination-echo guard, #940). On top of that the feed drops orders carrying
`notes_priv = "OpenLinker order <id>"` (what `OrderProcessorManager` writes), so they cost no `getOrder` job and no
requests; the cursor still advances over them.

**Known limit: the poll sees NEW orders only.** Shoper has no bulk modified-since for orders (`object-mtime` is per
object), so a later edit of an already-read order is not re-observed by a poll. The webhook backstop (#3644) is the
update channel; until it exists, a status change in the shop reaches OpenLinker only through a re-sync of that order.

**Not mapped**: pickup point (locker) data, and the order's payment / delivery method ids beyond the delivery
method label.

## Webhooks

"Configure webhooks" (`POST /connections/:id/webhooks/install`) registers ONE Shoper webhook carrying the order
events (with `OrderSource`) and the product events (with `ProductMaster`). Each install rotates the connection's
webhook secret. A delivery is accepted only when BOTH checks pass:

- **Signature.** The secret is registered as the webhook's `secret`, and Shoper signs every delivery with it:
  `x-webhook-sha1 = hex(sha1(x-webhook-id + ":" + secret + ":" + rawBody))`, over the raw body bytes.
- **URL token.** The delivery URL is `.../webhooks/shoper/<connectionId>?token=<urlToken>`, where
  `urlToken = hex(HMAC-SHA256(key = secret, message = "shoper-webhook-url-token:v1"))`. The secret itself is never
  in the URL: the shop panel lists webhook URLs in plain text and proxies log them, and the token cannot be turned
  back into the secret, so a leaked URL does not let anyone sign a delivery.

A webhook installed before the URL token was derived still carries the raw secret as `?token=`. Its deliveries are
still accepted (the signature still has to verify), but each one logs a warning: re-run "Configure webhooks" on the
connection to rotate the secret, since the old URL has already shown it to anyone who could read it.

## Known gaps

- **Rate limit.** Shoper's limit is per SHOP and shared by every token and integration on it: a
  sustained 10 req/s was answered in full, 15 req/s drew `429`s (an HTML page with no `Retry-After`),
  and two tokens hammering one shop together got about 5 req/s each. OpenLinker therefore paces every
  connection to one shop against ONE shared bucket, keyed by the normalised shop host
  (`shoper:host:<host>`, ADR-038 § Amendment): a shop used as order source on one connection and as
  publish destination on another shares a single budget. That budget is 300 req/min (5 req/s) with 4
  in flight, half the shop's limit, leaving the rest to the merchant's panel and other integrations.
  `config.rateLimit` on a connection can only make it stricter for that connection, never raise the
  shop's budget. A `429` / `503` that reaches a job is deferred penalty-free (60 s / 300 s) instead of
  spending a retry attempt. Still not covered: the merchant's OTHER integrations are invisible to
  OpenLinker, so a busy ERP on the same shop can still push the shop over its limit.
- **`adjustInventory` is a non-atomic read-modify-write** (Shoper has no conditional stock write and no
  idempotency key, so it reports `idempotency: 'unsupported'`): a change landing between the read and the PUT is
  overwritten, and a retry after a lost response applies the delta again. The remedy belongs at the call site: a
  short per-`(connection, stock)` `SyncLockPort` lock around the call, as #2617 does per offer.
- Product `createdAt` / `updatedAt` are not set: Shoper sends zone-less local timestamps and parsing them with
  the process time zone would stamp a wrong instant.
- `getProduct` (what the sync reads) returns the whole gallery from `product-images`: main image first, then the
  shop's gallery order, hidden images left out. It costs one extra call per product (none for a product with no
  main image), one filtered read per page on `getProducts` and one per chunk of 50 in the bulk prefetch. An empty
  gallery keeps the main image; a failed read fails the product read rather than syncing the main image alone.
- `getProduct` also reports `categoryBreadcrumb`, the path of the product's main category (`category_id`, else its
  first category). It is walked over the same category directory `getProductCategories` reads (memoised per adapter,
  and warmed by the bulk prefetch, so a batch page reads it once). A node with no name, a category the tree does
  not place, or a failed read gives no path, never a partial one, and never fails the product read.

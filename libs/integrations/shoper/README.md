# @openlinker/integrations-shoper

OpenLinker adapter for [Shoper](https://www.shoper.pl) (Polish SaaS e-commerce platform), REST API.

**Status:** connection skeleton (#3639) plus the **read side of `ProductMaster`** (#3675): products, variants,
search and id enumeration. Categories (#3676), tax rate (#3677) and deletion detection (#3678) complete
ProductMaster. `InventoryMaster` (#3686, #3687) and the `OrderProcessorManager` skeleton (#3692) are described
below; fulfilment writeback and webhooks land in their own epics of the "Shoper MVP Integration" milestone. Evidence base: `docs/plans/analysis/SPIKE-3638-shoper-rest-api.md`
and the live findings recorded in `docs/plans/implementation-plan-shoper-product-master-read.md`.

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
Rejected: `http://`, a path / query / port / credentials, IP addresses, `localhost` and single-label
hosts. The token travels on every request, so HTTPS is the only transport.

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
  variant is minted for a simple product - Shoper already gives it a stock row.
- **Text** is read from `translations[<shop default language>]` (`application-config.default_language_name`);
  the translations' own `isdefault` flag reads `"0"` on every language and is not used.
- **Images:** only the main image, `https://<host>/userdata/public/gfx/<unic_name>.<extension>`.
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
- **The sweeps need no Shoper-specific scheduler code.** `master.product.syncAll`, `master.product.reconcile`
  (the deletion audit) and `master.product.syncDelta` are registered core-side by capability
  (`CORE_CAPABILITY_TASKS`, `capability: 'ProductMaster'`), so declaring `ProductMaster` is what enrols a
  connection. They walk the catalogue through `listExternalIds`, which pages in ascending `product_id` order.
- **No modified-since rung.** Shoper has no bulk "changed since" query - only a per-object
  `GET /object-mtime/<object>/<id>` (the plural form answers 500) - so `ModifiedProductLister` is not
  implemented and the delta pass skips Shoper connections. The full pass is the only sweep, from day one.
- Webhook-driven deletion detection (a `product.deleted` trigger) belongs to the webhook work (#3644); until
  then the periodic `reconcile` audit is the deletion authority, as for any master without a delete hook.

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

Declared as `OrderProcessorManager` (#3692, #3693). **It is not enabled by default**: a new connection gets only
`ProductMaster` and `InventoryMaster` (`defaultEnabledCapabilities`), because core fans every ingested order out to
every active `OrderProcessorManager` connection and a shop meant as a catalogue / stock master must not start
receiving orders. Enable it explicitly on the connection's `enabledCapabilities` - the list is stamped at create and
never retro-filled. **There is no duplicate-order guard yet (#3694): a retried `createOrder` creates a second Shoper
order, so do not enable the capability on a production connection before that slice lands.**

`createOrder` resolves everything first and writes second, because Shoper decrements stock as each line is
created: user, variants, taxes, the three required ids, currency and prices are settled before the first write.
Then `POST /orders` (header) and one `POST /order-products` per line, at the buyer-paid **gross** price (ADR-014;
a Shoper line `price` is gross). The result is the Shoper-native order id.

**Header ids** (`shipping_id`, `payment_id`, `status_id`) are ids of rows in the shop's own `/shippings`,
`/payments`, `/statuses`; Shoper has no catch-all, so OpenLinker never guesses one:

- shipping: the operator's carrier mapping for the source delivery method, else `config.defaults.shippingId`;
- status: the operator's order-state mapping, else `config.defaults.statusId`;
- payment: `config.defaults.paymentId` only (the order carries no payment-method name to map);
- with none of these set the order fails before any write, naming the key to set.

`shipping_tax_id` is read from the chosen shipping method (`GET /shippings/:id`), `currency_id` from `/currencies`
by ISO code, and each line's `tax`/`tax_value` from `/taxes` by the line's rate code. A currency, tax or shipping
method the shop does not have is `ShoperOrderUnbuildableException` (terminal, before any write).

**Net-priced sources:** Shoper line prices are gross and OpenLinker computes no tax (ADR-063), so a net-priced
line needs the source-reported `unitPriceGross`; without it the order is refused.

**Phone is required** on both Shoper addresses (an empty one is a 400). The address's own is used, else the other
address's; an order with no phone at all is refused rather than given an invented number.

**A half-built order is removed.** If a line fails after the header exists, `DELETE /orders/:id` is issued (live:
this restores the stock the lines took). If that fails too, `ShoperPartialOrderException` names the order id and is
terminal, because a retry would create a second order - delete it in the shop and re-run the sync.

The order's `notes_priv` carries `OpenLinker order <id>` as a recovery marker. It is NOT a dedup key: Shoper does
not round-trip the order `code` and accepts two orders with the same one (SPIKE-3638 O5).

**Customer.** Shoper rejects `user_id = 0` and does not provision a guest, so `ShoperCustomerProvisioner` resolves
or creates the user: an existing `Customer` mapping wins; otherwise, under a lock per (connection, email hash),
`POST /users`, and on Shoper's duplicate-email `400` the existing user is found with
`GET /users?filters[email]=` and reused. **There is no guest fallback** (unlike WooCommerce): an order with no
usable buyer email (a source that reports none, or `OL_STORE_PII=false`) fails with
`ShoperCustomerUnresolvableException`, a terminal error.

Verified on a trial shop (2026-10): `POST /users` with `email`, `firstname`, `lastname`, `active` answers the bare
user id; the order payload above creates an order whose `sum` is lines + `shipping_cost`.

Not covered: the stock double-deduction policy (#3695), pickup points, order status writeback.

## Known gaps

- **No rate limiting or retries yet.** The real request ceiling is unconfirmed (SPIKE-3638 C6); no
  `defaultRateLimit` is declared. Set `config.rateLimit` on the connection if a shop needs a cap.
- The webhook signing algorithm (`x-webhook-sha1`) is unresolved; see #3644.
- **Multi-variant products are not live-verified**: the trial shop has none, so a variant's `options` are not
  mapped to `attributes` yet (they stay `null`) rather than guessed at.
- Product `createdAt` / `updatedAt` are not set: Shoper sends zone-less local timestamps and parsing them with
  the process time zone would stamp a wrong instant.
- Only the main image is exposed; the rest need `product-images` (one extra call per product).

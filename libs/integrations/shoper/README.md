# @openlinker/integrations-shoper

OpenLinker adapter for [Shoper](https://www.shoper.pl) (Polish SaaS e-commerce platform), REST API.

**Status:** connection skeleton (#3639) plus the **read side of `ProductMaster`** (#3675): products, variants,
search and id enumeration. Categories (#3676), tax rate (#3677) and deletion detection (#3678) complete
ProductMaster; InventoryMaster, OrderProcessorManager, fulfilment writeback and webhooks land in their own
epics of the "Shoper MVP Integration" milestone. Evidence base: `docs/plans/analysis/SPIKE-3638-shoper-rest-api.md`
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
the rest of the milestone, so grant them up front to avoid re-visiting the panel):

produkty, warianty produktów, stany dostępności, kategorie, stawki vat, magazyny, zamówienia, przesyłki,
statusy zamówień, klienci, webhooki, dostawy, płatności

(`SHOPER_REQUIRED_SCOPES` in `src/shoper.constants.ts` is the same list.)

## Connection test

`GET https://<baseUrl>/webapi/rest/application-config` with the Bearer token.

| Result | Meaning |
|---|---|
| `200` | host is a Shoper shop and the token is valid |
| `401` | token invalid or revoked |
| `403` | token valid but missing a permission (the message lists the areas above) |
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
  No `tax_id` is `not-configured`;
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

## Known gaps

- **No rate limiting or retries yet.** The real request ceiling is unconfirmed (SPIKE-3638 C6); no
  `defaultRateLimit` is declared. Set `config.rateLimit` on the connection if a shop needs a cap.
- The webhook signing algorithm (`x-webhook-sha1`) is unresolved; see #3644.
- **Multi-variant products are not live-verified**: the trial shop has none, so a variant's `options` are not
  mapped to `attributes` yet (they stay `null`) rather than guessed at.
- Product `createdAt` / `updatedAt` are not set: Shoper sends zone-less local timestamps and parsing them with
  the process time zone would stamp a wrong instant.
- Only the main image is exposed; the rest need `product-images` (one extra call per product).

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
  re-read the directory per product. A 404 inside `getProductCategories` stays a plain `ShoperApiError`:
  deletion is detected at `getProduct`, never as a side effect of a category read.

- **Variants:** one `product-stocks` row = one `ProductVariant`, keyed by its real `stock_id`. No synthetic
  variant is minted for a simple product - Shoper already gives it a stock row.
- **Text** is read from `translations[<shop default language>]` (`application-config.default_language_name`);
  the translations' own `isdefault` flag reads `"0"` on every language and is not used.
- **Images:** only the main image, `https://<host>/userdata/public/gfx/<unic_name>.<extension>`.
- Writes throw `ShoperNotSupportedException`.

Paging rules the adapter enforces (all observed on a live shop):

- Shoper pages by **page index**; an `offset` that is not a multiple of `limit` is refused, never rounded.
- **`limit` is capped at 50, and a larger value is silently reduced to 10** by the shop. The adapter refuses
  anything above 50 rather than sending it, because a silently short page reads as the end of the catalogue.
- A bare `order=<field>` sorts descending; the adapter always sends an explicit `ASC`.
- `filters[category_id]` and `filters[code]` are not valid on `products` (the shop answers 404); the
  `categoryIds` and `status` filters are therefore refused rather than ignored.

## Known gaps

- **No rate limiting or retries yet.** The real request ceiling is unconfirmed (SPIKE-3638 C6); no
  `defaultRateLimit` is declared. Set `config.rateLimit` on the connection if a shop needs a cap.
- The webhook signing algorithm (`x-webhook-sha1`) is unresolved; see #3644.
- **Multi-variant products are not live-verified**: the trial shop has none, so a variant's `options` are not
  mapped to `attributes` yet (they stay `null`) rather than guessed at.
- Product `createdAt` / `updatedAt` are not set: Shoper sends zone-less local timestamps and parsing them with
  the process time zone would stamp a wrong instant.
- Only the main image is exposed; the rest need `product-images` (one extra call per product).

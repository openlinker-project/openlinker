# Shopify development store (local testing)

Shopify is SaaS only. There is no Shopify server image, so unlike PrestaShop and
WooCommerce this stack cannot run Shopify itself. What it gives you instead:

- a free **development store** you own (about 10 minutes to set up, steps below);
- `shopify-tools`, an opt-in container that **seeds** that store with the data
  OpenLinker's flows need (`pnpm dev:stack:seed-shopify`).

Introduced by the capability spike, #3928. Earlier API research: #2879
(`docs/plans/analysis/SPIKE-2879-shopify-admin-api.md`).

## 1. Create the store

1. Sign in to the Shopify Dev Dashboard: <https://dev.shopify.com/dashboard> (a free account is enough).
2. **Dev stores -> Create dev store.** Country: Poland. Name it `ol-dev-<yourname>`.
3. Open the store admin and, **before any order exists** (currency is locked after the first order):
   - Settings -> General -> **Store currency: PLN**.
   - Settings -> Taxes and duties -> **All prices include tax: on** (Polish gross prices, ADR-077).

## 2. Create the app

1. Dev Dashboard -> **Apps -> Create app**, name `OpenLinker local`.
2. **Versions -> Create version**:
   - App URL: `https://example.com` (placeholder; nothing calls it)
   - Allowed redirection URLs: `http://localhost:3456/shopify/callback` (only used if you ever
     fall back to the OAuth install flow)
   - Webhooks API version: `2026-10`
   - Embed in Shopify admin: off
   - Scopes:

   ```text
   read_products, write_products
   read_inventory, write_inventory
   read_locations, write_locations
   read_orders, write_orders
   read_draft_orders, write_draft_orders
   read_order_edits, write_order_edits
   read_customers, write_customers
   read_fulfillments, write_fulfillments
   read_merchant_managed_fulfillment_orders, write_merchant_managed_fulfillment_orders
   read_third_party_fulfillment_orders, write_third_party_fulfillment_orders
   read_assigned_fulfillment_orders, write_assigned_fulfillment_orders
   read_shipping, write_shipping
   read_returns, write_returns
   read_files, write_files
   read_publications, write_publications
   read_metaobjects, write_metaobjects
   ```

   The scope picker mixes Admin API scopes with Customer Account API scopes
   (`customer_read_orders` etc.) under the same heading. Pick the plain ones.
   `read_all_orders` is not in the picker at all and needs a manual Shopify
   review; it is not needed here (a new store has no orders older than 60 days).
3. **Release** the version.
4. Install it from the **app's own page** in the Dev Dashboard, not from the store admin: the
   **Installs** card has **Install app** (also in the **...** menu on the Apps list). Pick your
   dev store and confirm. Until this is done the token request answers `app_not_installed`.

## 3. Get credentials into `.env`

From the app's **Settings** page copy the client ID and secret into the repo-root `.env`:

```dotenv
SHOPIFY_STORE_DOMAIN=ol-dev-yourname.myshopify.com
SHOPIFY_API_VERSION=2026-10
SHOPIFY_CLIENT_ID=...
SHOPIFY_CLIENT_SECRET=...
```

The tooling exchanges these for an Admin API token itself (client-credentials grant). That
works because the dev store and the app belong to the same organization; a store in another
organization answers `shop_not_permitted`. The token lasts about 24 hours and is fetched again
on every run.
If you already have a token from an OAuth install, set `SHOPIFY_ACCESS_TOKEN=` instead;
it takes precedence. `.env` is gitignored; never commit these values.

## 4. Seed

```bash
pnpm dev:stack:seed-shopify
```

Safe to re-run: anything already seeded is skipped, never edited. Wait a minute between two
runs: order lookup goes through Shopify's search index, which lags writes by a few seconds. The first run takes a
minute or two because development stores accept only about 5 `orderCreate` calls a minute;
the tool waits instead of failing.

What you get:

| Kind | Data |
|---|---|
| Locations | the default one + `OL Seed Warehouse` (Poznan) |
| Fulfillment service | `OL Seed 3PL` (its own location, hidden from `locations()`) |
| Products | T-shirt (3 sizes), Sneakers (2 colours x 2 sizes, one with a sale price), Mug (single variant), Poster (no EAN), Gift wrap (stock not tracked) |
| Stock | split across both locations, including zero-stock variants |
| Orders | `paid`, `unpaid`, `cod`, `b2b` (company on the address), `partial` (one of two lines shipped with tracking), `cancelled` |

Every seeded object carries the `ol-seed` tag; orders also carry `ol-seed-order-<key>`.

## Starting over

Delete the store in the Dev Dashboard and create a new one. Seeding a store that already
has unrelated data is fine, but a deleted seeded product is recreated on the next run.

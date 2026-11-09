# @openlinker/integrations-shopify

OpenLinker adapter for [Shopify](https://shopify.dev/docs/api/admin-graphql), Admin GraphQL API **2026-10**.

**Status:** plugin foundation (#3974) and **ProductMaster** (#3975). The plugin registers the connection, the
token handling, the GraphQL client, the connection tester and the retry / auth-failure classifiers. Further
capabilities (InventoryMaster, OrderSource, OrderProcessorManager, ProductPublisher, ...) enter
`supportedCapabilities` together with the adapter that delivers them, in the follow-up issues of the
"Shopify integration" milestone. Evidence base: spike #3928 (`SPIKE-3928-shopify-capabilities.md`) and the first
spike #2879 (`docs/plans/analysis/SPIKE-2879-shopify-admin-api.md`).

| | |
|---|---|
| Adapter key | `shopify.admin.v1` |
| Platform type | `shopify` |
| API | Admin GraphQL, `https://{shop}/admin/api/{version}/graphql.json` |
| Supported API versions | `2026-10` (`SHOPIFY_SUPPORTED_API_VERSIONS`) |

## Connecting a store

Three ways, all stored in the connection's encrypted credentials:

| Mode | Credentials | When |
|---|---|---|
| App credentials | `clientId` + `clientSecret` | A store in the **same organization** as the app (client-credentials grant, ~24 h token minted and cached). |
| Access token | `accessToken` | A token already issued for the store. Used as is, never renewed. |
| OAuth install | written by the install | A store in **another organization**. The operator approves the app on Shopify; OpenLinker stores an expiring offline token and its refresh token (Shopify requires `expiring=1` for new apps) and refreshes them, writing the rotated pair back under a lock. |

Config (`Connection.config`): `storeDomain` (required, `*.myshopify.com`), `apiVersion` (optional, a supported
version), `locationId` (optional, the ONE location stock is read and written at; the primary location when absent;
must exist and be active, checked by the connection test), `unmanagedStockQuantity` (optional, whole number),
`salesCountryIso2` (optional, the country the catalogue's tax rate is computed for; the shop's own billing country
when absent).

Required app scopes: `SHOPIFY_REQUIRED_SCOPES` (the connection test lists any that are missing). `write_draft_orders`
is there for the tax rate read only: `draftOrderCalculate` computes a rate without creating anything, but Shopify
gates it behind that scope.

The OAuth install is started from the web setup page (`/connections/new/shopify`) and lands on
`/integrations/shopify/connect/callback`; register that URL as an allowed redirection URL on the app. The API checks
Shopify's `hmac` and the `shop` of the redirect before it exchanges the code.

## Behaviour worth knowing

- **Connection test** reports shop name, currency, whether prices include tax, and the location. A refused token
  request names its cause: app not installed (K02), store in another organization so OAuth is needed (K03), wrong
  client id / secret (G03). Missing scopes are listed.
- **Pacing.** Every call goes through the connection-bound transport, with ONE bucket per store
  (`shopify:store:{domain}`), because Shopify's budget is per app and store. Query cost is paced from the
  `throttleStatus` Shopify returns (never a hard-coded budget, L-C2).
- **Retry.** `THROTTLED`, the `orderCreate` "Too many attempts" cap (L-X1), 429 and 503 are deferred without
  spending an attempt; `CHANGE_FROM_QUANTITY_STALE` (G05) and network errors (G07) retry normally; a missing scope
  and other user errors are terminal.
- **Re-auth.** A 401 that survives one renewal, the invalid-token GraphQL error, and a grant refused for bad or
  spent credentials set the connection to `needs_reauth`. `app_not_installed` / `shop_not_permitted` do not: the
  credentials are fine.
- **Archive** removes the cached minted token and shop context (K05) through the core connection archive hook.

## ProductMaster (#3975)

Read-only: product writes are refused (`ShopifyNotSupportedException`).

- **Products and variants.** Every Shopify variant is a `ProductVariant` keyed by its own id; options become
  `attributes`, and the "Default Title" variant of a product without options is a simple product (no synthetic
  variant). EAN and GTIN come from `barcode`, weight from `inventoryItem.measurement`, the vendor becomes a feature,
  product and variant pictures are cdn.shopify.com URLs served through OpenLinker's image route.
- **Price.** The gross catalogue price (ADR-077) is the variant's `price`, what the buyer pays in the shop. A shop
  whose prices exclude tax reports no price rather than a net one.
- **Category.** The Standard Product Taxonomy category: `Product.categories` holds the leaf then every ancestor,
  so a category mapping on the leaf or on any parent resolves (A15). The mapping page's source list is the shop's
  directory: the nodes its products use plus their ancestors.
- **Deletion.** `product: null` raises `MasterProductNotFoundError`, which stales the variants (A10).
- **Delta pass** (`ModifiedProductLister`): the union of products and variants whose `updated_at` moved, because a
  variant price edit bumps only the variant (L-M2); pulled back 15 s for the search index lag and the clock gap seen
  live (A19).
- **Batched sweep** (`BulkProductReader`): `nodes(ids:)` warms a batch; enumeration resumes from a cursor checkpoint
  in the host cache instead of walking from the start on every window.
- **Tax rate** (`ProductTaxRateReader`, L-T4): Shopify keeps no rate on a product, so it is computed with
  `draftOrderCalculate` (one variant, quantity 1, an address in the sales country) and cached per variant, country
  and product version for a day. One tax line is the rate; a non-taxable variant is `0`; no tax line, several tax
  lines or a refused calculation is reported as unknown, never as zero.
- **Query cost.** One query may not exceed 1000 points and Shopify no longer publishes how a connection is costed,
  so a product reads its first 50 variants (one picture each) and pages the rest; batch reads start at 10 products
  and halve when Shopify answers `MAX_COST_EXCEEDED`.

### Decisions

| Case | Decision |
|---|---|
| compareAtPrice (A05) | Not carried. `price` is what the buyer pays; `compareAtPrice` is the struck-through "was" price. |
| DRAFT / ARCHIVED (A11) | ARCHIVED counts as removed from sale: left out of the enumeration, and a direct read raises `MasterProductNotFoundError`, so its offers are paused; back to ACTIVE, the next sync restores it. DRAFT and UNLISTED products sync normally. |
| Gift cards (A17) | Skipped: not a physical product and redeemable only at Shopify checkout. Left out of the enumeration, the delta pass and the category directory. |

## Known gaps

- `barcode` is deprecated in 2026-10 in favour of the `barcodes` connection; it still answers the first barcode and
  is used until the next API version.
- A change to a collection tax override does not touch the product, so the cached rate is re-read when its day runs
  out.
- Product webhooks are a separate issue: today the catalogue is kept current by the sweeps and the delta pass.
- Whether a configured location exists is checked by the connection test and at runtime, not when the connection
  is saved (a save has no credentials to ask the shop with).
- Cost pacing is per process: two worker processes share the request-count bucket but each paces cost from its own
  last observation; Shopify's `THROTTLED` answer and the retry classifier cover the rest.

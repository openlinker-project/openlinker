# @openlinker/integrations-shopify

OpenLinker adapter for [Shopify](https://shopify.dev/docs/api/admin-graphql), Admin GraphQL API **2026-10**.

**Status:** plugin foundation (#3974), **ProductMaster** (#3975), **InventoryMaster** (#3976), **OrderSource**
with returns (#3977), **OrderProcessorManager** (#3978) and **inbound webhooks** (#3981). The plugin registers the connection, the
token handling, the GraphQL client, the connection tester and the retry / auth-failure classifiers. Further
capabilities (ProductPublisher, ...) enter
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
must exist and be active, checked by the connection test), `unmanagedStockQuantity` (optional, whole number, the stock reported for a variant whose inventory Shopify does not
track; 1000 when absent, the WooCommerce convention),
`salesCountryIso2` (optional, the country the catalogue's tax rate is computed for; the shop's own billing country
when absent).

App scopes: `SHOPIFY_REQUIRED_SCOPES` (the connection test fails when one is missing) and `SHOPIFY_OPTIONAL_SCOPES`
(asked for at install; the connection test passes and names each missing one with what it switches off):
`write_draft_orders` for the tax rate read (`draftOrderCalculate` computes a rate without creating anything, but Shopify
gates it behind that scope; without it every product's rate stays "not checked"), and `read_shipping` for the
delivery-profile method names in the mapping UI (without it only methods seen on recent orders are offered).

`refundsThroughShopify` (optional, boolean): a refund confirmed in OpenLinker is sent to Shopify (see OrderSource).

`salesCountryIso2` is not on the setup form yet: set it in the connection's config (JSON) when the tax rate should be
computed for a country other than the shop's own.

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
  whose prices exclude tax has its net price grossed up with the rate Shopify computes for the sales country (one
  rate per product, cached for a day), rounded to the cent; an exemption adds nothing. When that rate is unknown (no
  `write_draft_orders` scope, several tax lines, no tax region for the country) the product has no price rather
  than a net one.
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
  `draftOrderCalculate` (one variant, quantity 1, an address in the sales country) and cached per variant and country
  for a day. The cache key holds no `updatedAt`, because a stock change bumps it (L-M2) and would re-run the
  calculation on every stock change. One tax line is the rate; a non-taxable variant is `0`; no tax line, several tax
  lines, a refused calculation or a missing scope is reported as unknown, never as zero.
- **Request budget.** A first sync costs about two requests per product (the product read and the tax calculation)
  against the store's 240 requests a minute: about 8 minutes per 1000 products on top of the sweep. Later syncs read
  the cached rate.
- **Query cost.** One query may not exceed 1000 points and Shopify no longer publishes how a connection is costed,
  so a product reads its first 50 variants (one picture each) and pages the rest; batch reads start at 10 products
  and halve when Shopify answers `MAX_COST_EXCEEDED`.

### Decisions

| Case | Decision |
|---|---|
| compareAtPrice (A05) | Not carried. `price` is what the buyer pays; `compareAtPrice` is the struck-through "was" price. |
| DRAFT / ARCHIVED (A11) | ARCHIVED counts as removed from sale: left out of the enumeration, and a direct read raises `MasterProductNotFoundError`, so its offers are paused; back to ACTIVE, the next sync restores it. DRAFT and UNLISTED products sync normally. The job list labels such a sync "deleted at the master" (`master_deleted`): core has one label for both. |
| Non-taxable variant | `taxable: false` reads as the rate `0`, the shop's own "charge no tax" (the PrestaShop "No tax" precedent). Shopify does not tell 0% from exempt, so a Polish exempt (`zw`) product shows as `0`. |
| Gift cards (A17) | Skipped: not a physical product and redeemable only at Shopify checkout. Left out of the enumeration, the delta pass and the category directory. |

## InventoryMaster (#3976)

- **One location.** Stock is read and written at the connection's `locationId`, or the shop's primary location.
  Stock at other Shopify locations is ignored until a WMS brings multi-location support. Rows are reported pooled
  (no OpenLinker location); map the warehouse with the connection's `stockLocationOverride`.
- **Figures.** `available` is Shopify's sellable number, `committed` is reported as reserved, `on_hand` as the
  physical count. A variant not stocked at the location reports 0; an untracked one reports `unmanagedStockQuantity`.
- **Writes** (manual corrections, sale decrements, return restocks) are a delta on `available` through
  `inventoryAdjustQuantities`, compare-and-set on the level read just before (`changeFromQuantity`) and with
  `@idempotent`. A level that moved in between is refused by Shopify with nothing written
  (`CHANGE_FROM_QUANTITY_STALE`), so the adapter reads it again and retries, up to three attempts. A removal past zero
  stops at zero.
- **Once only.** A caller's idempotency key is remembered in the host cache after the write, so the same key again
  applies nothing and answers `deduplicated` with the original Shopify instant (A18). The Shopify key is derived from
  the caller's key and the attempt number, so a retry after a crash sends the first attempt's key again: if that
  write had landed, Shopify answers a parameter mismatch rather than writing twice.
- **Refusals before anything is written** (variant not named on a multi-variant product, untracked, not stocked at
  the location) are `ShopifyNotSupportedException`, which core records as refused rather than in doubt.
- **Batched sweep** (`BulkInventoryReader`): one `nodes(ids:)` read warms a batch.

## OrderSource (#3977)

Opt-in: not on by default, because ingesting a shop's orders creates them in every destination.

- **Feed.** `orders(query: "updated_at:>=...", sortKey: UPDATED_AT)` with an opaque `(updatedAt, id)` keyset cursor
  under `shopify.orders.cursor`, polled every 5 minutes (`OL_SHOPIFY_POLL_SCHEDULER_ENABLED`). Orders updated in the
  last 30 s wait for the next poll: the search index lags writes by seconds (L-M1, L-S2j). With no cursor yet, the
  first poll reads the shop's whole order history, as every other source does.
- **Order.** Line prices are what the buyer paid per unit after EVERY discount, the order-level and code-based ones
  included (`discountedUnitPriceAfterAllDiscountsSet`), and shipping is the price after discounts
  (`currentShippingPriceSet`), so lines and shipping add up to the order total and an invoice or receipt can be issued.
  Shopify allocates the discount to the lines itself; OpenLinker does not show it as a separate amount (no
  `discountTotal`, which in core means a discount left OUT of the lines). Gross on a tax-inclusive shop; the
  quantity is `currentQuantity` (after order edits), and a line edited down to 0 is dropped. The line's own tax line
  gives the rate. A B2B order carries the company location's tax registration id (C08); a consumer order asserts none.
  Payment method: only Shopify's built-in `Cash on Delivery (COD)` and `Bank Deposit` are recognised; a pending COD
  order is `cod`, not awaiting payment. The buyer's note is carried verbatim.
- **Mapping options** (C13): delivery methods from the delivery profiles (by name, which is what an order carries) plus
  codes seen on recent orders; payment gateways from Shopify's built-ins plus those seen on recent orders (the Admin
  API lists no gateways); neutral order statuses.
- **Status writeback** (L-S3c): `dispatched` fulfils the open fulfillment orders at the configured location with
  tracking number, carrier and URL (the URL is always sent: without it Shopify guessed FedEx for an InPost parcel,
  L-F3). Work Shopify routed to another location is moved to the configured one first (C24). `cancelled` cancels the
  order, restocking and keeping the payment. `delivered` and `in-progress` are declined (not verified live).
- **Returns.** The return feed walks the orders that carry a return in laps, from the newest order down (a return does
  not bump the order's `updatedAt`, and an order keeps its `returned` status for good, so an ascending walk made a new
  return wait behind the shop's whole return history); a cursor from the earlier ascending walk starts a fresh lap.
  A return opened seconds before a poll can miss that lap (the search index lags) and is found on the next. The
  re-read sweep observes status changes; both passes are off by default
  (`OL_SHOPIFY_RETURNS_POLL_SCHEDULER_ENABLED`, `OL_SHOPIFY_RETURNS_STATUS_SYNC_SCHEDULER_ENABLED`). Reasons come from
  `returnReasonDefinition` (`returnReason` is deprecated in 2026-10, C16). A `REQUESTED` return can be declined from
  OpenLinker (`returnDeclineRequest`); an already declined one counts as done.
- **Refunds** (C20): with `refundsThroughShopify: true` a refund confirmed in OpenLinker becomes a `refundCreate` of
  money only, against the order's own transactions, with `@idempotent` and an `[ol:<hash>]` marker in the note so a
  retry after a lost answer finds the first refund. Without the flag a refund is only recorded, as made outside
  OpenLinker.

## OrderProcessorManager (#3978)

Opt-in: not on by default, because it brings every marketplace order into the store. Needs `write_orders` (already
required) and an offline token, which every supported credential mode gives.

- **Create.** `orderCreate` with the price the buyer paid on the source (ADR-014): gross with
  `taxesIncluded: true` unless the source states net prices, a tax line per stated numeric rate (none for `zw`,
  `np` or a missing rate), buyer addresses, phone and email, and `sourceIdentifier` = the OpenLinker order id. The
  order is tagged `openlinker`, Shopify sends the buyer no receipt, and `inventoryBehaviour:
  DECREMENT_OBEYING_POLICY` makes Shopify lower its own stock (`lowersStockOnOrderCreate` answers `true`).
- **Lines.** A line whose variant this connection mapped is created against that variant; any other line becomes a
  custom line (title, SKU, price) that ships but moves no stock, and is logged. `requiresShipping` defaults to false
  on EVERY `orderCreate` line, so every line states it: a variant line takes its own inventory item's
  `requiresShipping` (read in one query; a digital product stays unshipped), a custom line `true`. Without it the
  order reads "shipping not required" and no label can be bought for it (D1).
- **Whole-order discount.** A discount the source applied to the order but to none of its lines
  (`totals.discountTotal`, e.g. an Allegro coupon) is sent as a fixed-amount discount code `OPENLINKER`, so the order
  totals to what the buyer paid and shows the discount; the tax lines are computed on each line's discounted share
  (`distributeOrderDiscount`). A discount at least as large as the lines is not sent and is logged.
- **Exactly once.** `orderCreate` has no `@idempotent` support and does not deduplicate on `sourceIdentifier`. Core
  serialises the create per order and destination; before creating, the adapter looks the order up by
  `source_identifier:` and returns the one it finds. The search index sees an order seconds after it was written, so
  this covers a retry after a lost answer, not two creates at once.
- **Currency.** An order in a currency other than the store's is refused before anything is sent (presentment
  currencies are not used).
- **Pickup point.** Shopify has no pickup-point field: the locker id, name and address go into `customAttributes`,
  one line of the order note, and the shipping line title (`Paczkomaty InPost (GIT01D)`).
- **Payment.** Paid: a successful sale transaction on `manual` (or the mapped gateway). Cash on delivery: a pending
  one on `Cash on Delivery (COD)`. Otherwise no transaction and `PENDING`. A payment that arrives at the source
  after the order was created is not passed on (#3963).
- **Mappings.** The order's source connection's delivery-method and payment mappings (Mappings tab) give the shipping
  line title and code and the gateway; unmapped, the source's own names are used. The options to map onto are the
  same lists the order source shows. Because the mappings are keyed by the source only, a value mapped for another
  destination (a PrestaShop carrier id `1`) reaches Shopify too; a mapped value is used only when it is one of this
  store's own delivery methods or gateways, otherwise it is logged and the source's own name is used (D5).
- **Location.** Shopify's routing picks a location on create; open work assigned elsewhere is moved to the configured
  location right after. A failed move is logged and does not fail the create; the dispatch writeback moves it again.
- **Status.** Dispatch and cancellation go through the same writeback as the order source.

## Inbound webhooks (#3981)

Orders and products reach OpenLinker seconds after a change instead of at the next poll.

- **Configure.** Set `openlinkerCallbackBaseUrl` (a public `https://` URL of OpenLinker; Shopify delivers to https
  only) in the connection config, then `POST /connections/:id/webhooks/install` (the "Configure webhooks" button
  arrives with #3982). The shop is subscribed to `${base}/webhooks/shopify/{connectionId}`: `orders/create`,
  `orders/updated`, `orders/cancelled` when OrderSource is enabled, `products/create`, `products/update`,
  `products/delete` when ProductMaster is. Neither enabled is refused.
- **Idempotent.** Subscriptions already pointing at the current URL stay; missing ones are created; ours on an old
  base URL or for a topic no enabled capability needs are deleted after the new ones exist. Other subscriptions
  are never touched.
- **Signature.** Shopify signs every delivery with the app's client secret (`X-Shopify-Hmac-Sha256`), so install
  stores that secret as the connection's webhook secret. A connection holding only a pre-issued access token has no
  client secret and is refused: add the client id and secret to its credentials. A wrong or missing signature
  answers 401 and writes nothing.
- **Replays.** No timestamp window: Shopify retries a failed delivery up to eight times in four hours with the
  original timestamp, and a 401 on a valid retry would get the subscription removed. `X-Shopify-Webhook-Id` is the
  dedup key, so a replay creates no second job.
- **Trigger only.** Only the order or product id is read from the body; the order or product is re-read through
  the API. `products/update` also re-reads the stock (when InventoryMaster is enabled), because a stock edit in the
  admin arrives as that topic. The orders poll stays on as the backstop for a lost delivery.

## Known gaps

- `defaultEnabledCapabilities` turns ProductMaster on for every new connection. One Shopify store is a master or a
  publish target, never both (L-S2f): when ProductPublisher arrives, a publish-only connection must not get
  ProductMaster by default, or the sweep imports the store's catalogue back.

- Delivery and payment mappings are keyed by the SOURCE connection only, so one source sending orders to Shopify and
  to another shop shares one mapping for both destinations.
- The order processor creates no Shopify customer: the order carries the buyer's email and addresses, and Shopify
  links or creates the customer by email itself.
- `barcode` is deprecated in 2026-10 in favour of the `barcodes` connection; it still answers the first barcode and
  is used until the next API version.
- A change to a collection tax override does not touch the product, so the cached rate is re-read when its day runs
  out.
- `inventory_levels/update` is not subscribed: it is keyed by inventory item and location, not by product. A stock
  change made outside the admin (an app, a POS sale) waits for the inventory sweep.
- A burst of product webhooks shares the realtime lane with order syncs and can delay an order by minutes (spike
  A16); filed as a separate core issue.
- Whether a configured location exists is checked by the connection test and at runtime, not when the connection
  is saved (a save has no credentials to ask the shop with).
- A return's reason is carried as Shopify's raw `returnReasonDefinition` handle; core recognises only its own words,
  so every Shopify return reason is stored as `other` (the same holds for Allegro's reasons).
- A fulfilment made in the Shopify admin (and its tracking number) does not reach OpenLinker: the order source does not
  implement `OrderFulfillmentReadback`, which Allegro and Shoper do.
- A discount Shopify allocated to the lines is visible only as lower line prices; OpenLinker has no field for "a
  discount already inside the line prices" to show it as an amount.
- Cost pacing is per process: two worker processes share the request-count bucket but each paces cost from its own
  last observation; Shopify's `THROTTLED` answer and the retry classifier cover the rest.

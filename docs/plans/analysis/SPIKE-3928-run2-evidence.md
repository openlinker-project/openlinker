# Spike #3928 - run 2 evidence (cases that were "to do" after run 1)

## K06 config validation - part
- storeDomain `shop.example.com` -> 400 `storeDomain: must be the shop's permanent domain`.
- locationId `abc` -> 400 `locationId: must be a Shopify Location id or GID`.
- apiVersion `2026-13` -> ACCEPTED at save; connection test then answers 404 "Shopify Admin API not found - verify the store domain and API version".
- locationId `999999999999` (does not exist) -> ACCEPTED at save AND connection test answers OK. Only the stock sync would fail.
- Verdict: part. Validator checks format, not existence; tester should resolve the configured location.

## K11 disable / archive / restore - pass
- PATCH disable -> status disabled, credentials kept. PATCH archive -> archived, credentialsStored=false, connection absent from GET /connections. PATCH restore -> disabled, credentialsStored=false.

## G03 rejected credentials - pass
- PUT credentials with a bad client id/secret; test -> 400 "Shopify refused the token request - check the app client id and secret, and that the app is installed".
- marketplace.orders.poll -> dead at attempt 0 (not retried) with `client_credentials grant refused: application_cannot_be_found`; connection status -> needs_reauth.

## K03 store in another organization - part
- Connection to `allbirds.myshopify.com` with our app's client credentials; test -> 400 "Shopify refused the token request - check the app client id and secret, and that the app is installed on the store".
- The message is the same as for a wrong secret (G03). The real cause (store outside the app's organization, client-credentials not allowed, OAuth needed) is not named.

## C07 order cancelled in Shopify - pass
- #1017 `orderCancel(reason: CUSTOMER, refund: false, restock: true)`, poll -> `order_records.cancelledAt = 2026-11-04 21:30:48`. Note: snapshot `status` still reads `processing`; cancellation is carried by `cancelledAt`.

## E11 cancel while on the pack bench - pass
- #1022 (Mug x1) routed: work `open/accepted`, PrestaShop Mug 26 -> 25 (sale decrement).
- `orderCancel` in Shopify, poll -> order cancelled, work `cancelled`, PrestaShop Mug 25 -> 26 (decrement reversed).

## C09 order edited in Shopify - fail (fixed in prototype, retest pending)
- #1023 (Soap Lavender x2) routed, work line totalQuantity 2. `orderEditBegin` / `orderEditSetQuantity 1` / `orderEditCommit` -> Shopify total 50.67.
- After poll: OL total 50.67 but item quantity still 2, work line still 2, no order change recorded. A packer would pack 2.
- Cause: the prototype mapped `LineItem.quantity` (original) instead of `currentQuantity` (after edits). Fixed in the prototype (reads `currentQuantity`, drops lines at 0). Retest after rebuild.

## C18 return closed in Shopify - pass
- `returnClose` on #1018-R1 (Shopify status CLOSED); `marketplace.returns.statusSync` (payload `{limit:50, cursorKey:'shopify.returns.scanOffset', lookbackDays:90}`) succeeded; OL `returns.rawStatus` OPEN -> CLOSED. `closedAt` stays null (core writes it from nothing, by design).

## C19 decline a return from OpenLinker - fail before fix, retest pending
- `returnRequest` on #1021 -> Shopify return 39599505689 `REQUESTED`; returns poll ingested it as REQUESTED.
- `POST /returns/:id/decline {reasonCode:'OTHER'}` -> 400 `ReturnDeclineUnsupportedError: the source declares no decline support` (clean refusal, nothing written).
- Shopify supports it: `returnDeclineRequest(input:{id, declineReason: RETURN_PERIOD_ENDED|FINAL_SALE|OTHER, declineNote, notifyCustomer})`. Added `ReturnDecliner` to the prototype order-source adapter (commit 1bbcc7a3a): `declinedAt: null` (Shopify reports no instant), already-DECLINED treated as success.

## D12 master price change reaches Shopify - fail before fix, retest pending
- PrestaShop Mug net 49.00 -> 50.00; product sweep -> OL variant price 60.27 -> 61.50; a price-change episode opened for the Shopify destination (60.27 -> 61.50, +2%, passthrough rule).
- The episode is BLOCKED: `blockReason: destination-currency-unknown`. Shopify still 60.27.
- Cause: the prototype publisher did not implement `ShopCurrencyDeclarer` (matrix row said "would be the first shop adapter to implement it") nor `ShopProductPriceUpdater` (price-only write). Both added (commit b3345236d): currency from `shop.currencyCode`, price via `productVariantsBulkUpdate` on the one variant only.

## C09 retest after the fix - adapter pass, core gap
- #1024 Soap Lavender x2 routed (work line 2). `orderEditSetQuantity 1` + commit (Shopify total 50.67).
- After poll: OL total 50.67 and item quantity 1 (adapter now reads `currentQuantity`).
- The routed FulfillmentWork line stays at totalQuantity 2, cancelledQuantity 0; no order change, no attention entry. Core does not carry a source-side quantity decrease into routed work, so the packer is still told to pack 2. Not Shopify-specific.

## C19 retest - pass
- `POST /returns/:id/decline {reasonCode:'OTHER', comment}` -> `{outcome:'decline-sent', declinedAt:null}`; Shopify return 39599505689 status `DECLINED`. OL rawStatus updates on the next status sweep.

## D12 retest - pass
- The first episode kept its detection-time block (`destination-currency-unknown`) even after the adapter could declare PLN; manual accept answered 422. A second price change (PS net 51.00) re-evaluated the episode: blockReason null, destinationCurrency PLN.
- Accept -> `pricing.propagateToMarketplaces` -> Shopify Mug price 62.73 (51.00 x 1.23), stock untouched.
- Note: a block computed before the currency was known is not re-evaluated by "refresh"; only a new detection clears it.

## D05 re-publish - pass
- Second bulk-shop-publish of the Mug -> `published`, same externalProductId 15488114458905; Shopify `products(query:"title:Handmade*")` returns ONE product; updatedAt moved.

## D15 description HTML - pass
- PS description `<p>Kubek <strong>ręcznie robiony</strong>, zażółć gęślą jaźń.</p><ul>...</ul><table>...</table>` -> Shopify descriptionHtml keeps Polish letters, list and table. (A first attempt showed mojibake because the test wrote to MySQL without utf8mb4; not an OL defect.)

## D09 draft - pass
- bulk-shop-publish Bosch with `status: draft` -> record `draft`, Shopify product 15488530612505 `DRAFT`, `publishedOnPublication(Online Store) = false`.

## D10 category to collection - pass
- Bosch moved to PS category Accessories > Home Accessories, product sweep, re-publish with `status: published` -> Shopify collection `Home Accessories` (handle `accessories-home-accessories`, built from the whole path) created and the product added; product now `ACTIVE` and on the Online Store (draft -> published works).

## D16 product deleted in the master - fail (core)
- PrestaShop product 20 (Bosch) deleted (webservice DELETE answered 500 but the product was gone). `master.product.reconcile` -> `syncFromSweep` business_failure `master_deleted`, variant `isStale = true`, `marketplace.offer.pauseStale` ran: considered=1, stillStale=1, **paused=0**.
- Shopify product 15488530612505 stays `ACTIVE` with 5 in stock. The stale-offer pause covers marketplace `Offer` mappings only, not published `ShopProduct` mappings, so a product deleted at the master keeps selling on every shop channel (Shopify, WooCommerce, Shoper). Core gap.

## E12 order beyond stock - pass
- Shopify's own DENY policy refuses `orderCreate` for more than its stock (`Line items unable to reserve inventory`), so the test order #1025 (Soap Rose x150, PS has 99) was created with `inventoryBehaviour: BYPASS`.
- OL: `fulfillmentBlockReason = routing-refused`, detail "plan-carries-unfulfillable: no surviving location holds enough stock for this line", omsAttention `line-unfulfillable` (producer routing), no FulfillmentWork.

## F05 invoice PDF to Allegro after KSeF - pass
- inFakt invoice cc61d5a2 (order #1016, NIP 8113439670): `regulatoryStatus` submitted -> **accepted** (scheduled `invoicing.regulatoryStatus.reconcile`); `invoice_marketplace_uploads` row `uploaded` to the Allegro connection at 16:00:20, attempts 1.

## A05 compare-at price - part
- Shopify Sneakers BLK: price 249.00, compareAtPrice 299.00; WHT: 249.00, no compare-at. OL variant price 249.00 for all four.
- OL takes the selling price; the compare-at ("was") price is dropped. ADR-077 defines the catalogue price as gross "excluding promotions", so whether Shopify's compareAtPrice is the regular price (and 249 a promotion) is a product decision to record.

## Role switch for A tests
- Shopify connection set back to ProductMaster + InventoryMaster + OrderSource + OrderProcessorManager. The products published from PrestaShop in S2 were then imported a second time as Shopify-mastered products (OL now holds 2 variants with SKU OL-MUG-LIN-300 and 6 for OL-ADIDAS-*), confirming L-S2f.

## A09 price change in Shopify - pass
- `productVariantsBulkUpdate` Mug 38.99 -> 41.99; Shopify product sweep -> OL OL-SEED-MUG price 41.99.

## A10 product deleted in Shopify - pass
- `productDelete` Gift Wrap; `master.product.reconcile` -> `syncFromSweep` business_failure `master_deleted`; OL OL-SEED-WRAP `isStale = true`.

## A11 product set to DRAFT in Shopify - part
- Poster `productUpdate(status: DRAFT)`; after sweep the OL variant is unchanged and not stale. Shopify's product status (ACTIVE / DRAFT / ARCHIVED) is not carried into OL, so a draft product stays sellable on the channels OL feeds. Decide: treat DRAFT/ARCHIVED like inactive (stale) or ignore.

## A13 images - pass
- OL product images = `https://cdn.shopify.com/.../png.png`; `GET /v1/products/:id/images/0` -> 200 image/png 800x800.

## E09 own-shop order not routed (#3487) - pass
- Shopify as ProductMaster + OrderSource with the OMS on; Shopify order #1026 for a Shopify-mastered product -> `fulfillmentRoutingSkipReason = own-shop-order`, 0 FulfillmentWork. (It was also mirrored to PrestaShop as a second destination and failed there on customer provisioning, a test-config artefact: PrestaShop has no such product.)

## K05 token renewal - pass
- Cached token in Redis (`shopify:access-token:<conn>:<domain>:<fp>`, fields token + expiresAtMs) replaced with an invalid value, TTL kept, worker restarted. `master.inventory.syncAll` + 7 propagations succeeded at attempt 0; the cache now holds a new token; connection stays active. The client re-mints on 401 once.
- Side finding: after archiving the two probe connections their cached tokens are still in Redis until the ~24 h TTL. Archive wipes stored credentials but not the minted token.

## A18 (new) manual stock correction written to Shopify - pass
- `POST /inventory/:variantId/adjust {mode:'delta', quantity:2, operatorReason:'found', idempotencyKey:K}` on OL-SEED-MUG (master Shopify): `applied`, 4 -> 6, adjustmentOutcome `{disposition: applied, idempotency: honoured, appliedAt: 2026-11-04T22:07:21Z}` (Shopify's instant). Shopify available 6.
- Same request again (same K): same movementId, `adjustmentOutcome: null`, no second write; Shopify still 6.

## B06 no duplicate after a crash - pass (with the known window)
- Simulated a crash after `orderCreate`: deleted the OL `Order` mapping of #1011 on the Shopify connection and marked its sync `failed`. With OMS routing off, `POST /orders/:id/destinations/:conn/retry` -> adapter log "Shopify already holds order 1011 for ol_order_32ca...; not creating a second one"; syncStatus `synced` with the same externalOrderId 18996077396249; `orders(query: source_identifier:...)` still returns only #1011.
- The lookup relies on the search index, so a crash and retry inside ~10 s could still duplicate (L-O4). The job retry backoff is longer than that.
- While OMS routing was on, the same retry was routed and HELD (`routing-refused`) because the simulated `failed` row removed the #3455 "already mirrored" guard: a test artefact.

## B (Allegro paczkomat order into Shopify, OMS routing off) - L-O6 confirmed
- Two Allegro sandbox orders (Kubek, InPost Paczkomat, 35.85 each; COD not offered by the sandbox seller) ingested and created in Shopify as #1027 and #1028 at the marketplace price.
- OL holds the locker (`orderSnapshot.pickupPoint.id = GIT01D`), but the Shopify order carries no locker anywhere: shipping address = the buyer's home address, shipping line title "Allegro Paczkomaty InPost" with the Allegro delivery-method UUID as code, no note or attribute with the point. A merchant packing in Shopify cannot tell which locker to ship to.
- Fix for the adapter: write the locker id (and its address) into `customAttributes` and the order note, or into the shipping line title.

## B14 payment status into Shopify - pass
- Allegro order paid -> Shopify #1028 `PAID` with a SALE transaction 35.85 on gateway `manual`; Allegro order awaiting payment -> Shopify #1027 `PENDING`, no transaction, no gateway.

## B11 Allegro cancellation -> Shopify - pass
- Buyer/seller cancelled the SZK01G order on Allegro; poll -> OL `cancelledAt = 22:17:07`; Shopify #1028 `cancelledAt 22:17:09`, `cancelReason OTHER`; `marketplace.offer.stockRestore` ran.

## B15 (new) payment after the order was created - fail (core)
- Allegro order GIT01D was unpaid when created in Shopify (#1027 PENDING), then paid on Allegro. OL payment status -> `paid` (and a receipt registration started), but Shopify #1027 stays `PENDING`.
- The lifecycle relay has no "paid" event (`OrderLifecycleEventTypeValues`: dispatched, cancelled, delivered, in-progress), so a later payment never reaches a destination. Shopify supports it (`orderMarkAsPaid`). Core gap, not Shopify-specific.

## F (new) in-doubt receipt reconcile - part
- Receipt for the late-paid Allegro order (GIT01D): eparagony did not confirm within the poll budget -> record `failed / in-doubt`. `POST /fiscal-registrations/:id/reconcile` -> `still-unknown` (the vendor still holds it; honest answer, nothing written). Re-check later.

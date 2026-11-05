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

## Double check of the three core findings (code read by independent agents, 2026-11-04)

- **C09 confirmed, wording corrected.** Re-ingestion does detect the change: `diffOrderAmendment` writes `lastAmendmentChanges` (`line-quantity-changed 2 -> 1`), a warn log and a warning entry "Order changed at the source" on the order timeline. Nothing acts on it: `RoutingCommitService` answers `skipped / already-routed` for a routed order, work line `totalQuantity` is insert-only and only the operator edit path narrows it. Two more effects: the master stock decrement is computed from the work line (2), and the operator cannot repair it with the order-edit API (asking for 1 answers `NOTHING_CHANGED` because the channel quantity is already 1). The reservation narrows to 1 only while still `held`.
- **D16 confirmed.** `StaleOfferPauseService` and `findStaleMappedVariants` read `Offer` mappings only; the `ShopProduct` branch of the propagation has no stale guard and nothing enqueues a propagation on master deletion. Applies to every shop destination.
- **B15 confirmed and wider.** On re-ingestion `createOrderIdempotently` skips an order that already has a destination mapping; there is no update path and no `paid` lifecycle event. Applies to PrestaShop and WooCommerce destinations too (both decide paid/unpaid only at create).

## F12 follow-up
- Second reconcile of the in-doubt receipt -> `not-found` (the vendor reports the document failed, again the sandbox printer). The record stays `failed` and cannot be retried (#3960).

## Probe: concurrent productSet with the same handle (for L-S2b)
- Three concurrent `productSet(synchronous: true, identifier: {handle: "ol-race-probe"}, input: {handle: "ol-race-probe", one variant each})` -> three products, handles `ol-race-probe`, `ol-race-probe-1`, `ol-race-probe-2`, no userErrors. Shopify does not serialise creates by handle; it suffixes. `products(query: tag:...)` right after listed 1 of 3 (index lag). Probe products deleted.
- A deterministic handle is therefore not a lock for the variant-group race.

## Run 3: the known gaps implemented in the prototype and tested live (2026-11-05)

Prototype branch `local/shopify-prototype` (local only). Each item below was implemented there first, then run against the dev store.

### A15 category mapping Shopify -> Allegro - pass
- Shopify products carry their Standard Product Taxonomy category. The adapter reports it as the leaf plus its ancestors (`products.categories = ["hg-11-10-5-5","hg-11-10-5","hg-11-10","hg-11","hg"]`, breadcrumb Home & Garden > Kitchen & Dining > Tableware > Drinkware > Mugs), and the mapping source list (`/mappings/options/destination/categories` on the Shopify connection) offers the 19 nodes the shop uses, not the whole taxonomy.
- Mapping `Mugs (hg-11-10-5-5) -> Allegro 110886 Kubki` saved on the Allegro connection. `POST /listings/connections/<allegro>/categories/resolve` -> `{"allegroCategoryId":"110886","method":"category_mapping"}`; the bulk-wizard batch resolve gives the same for the Mug variant.
- Mapping only the parent (`Drinkware`) also resolves the Mug, because the ancestors are on the product.
- Note: a product synced before the change kept the leaf only until it was re-synced.

### C13 delivery and payment methods, both directions - pass
- Shopify as a SOURCE (`/mappings/options/source/*` on the Shopify connection): delivery methods from the delivery profiles (Standard, Express) plus codes seen on the last orders; gateways (manual, Cash on Delivery (COD), Bank Deposit); neutral statuses.
- Shopify as a DESTINATION was missing: `/mappings/options/destination/carriers` on the Allegro connection answered `501 ... does not implement DestinationOptionsReader`. Added: the same lists, and `createOrder` now applies the source connection's carrier and payment mappings.
- Live: mapped `Allegro Paczkomaty InPost -> Standard` and `ONLINE -> Bank Deposit`, recreated the Allegro GIT01D order in Shopify -> #1029: shipping line `title "Standard (GIT01D)", code "Standard"`, transaction `SALE SUCCESS 35.85` on `Bank Deposit`, `displayFinancialStatus PAID`.
- Note (core naming): the mapping API still names the fields `prestashopCarrierId` / `prestashopPaymentModule`; they hold Shopify method and gateway names here.

### B16 pickup point into Shopify - pass
- #1029 carries `customAttributes` `Pickup point = GIT01D`, `Pickup point name = Paczkomat GIT01D`, `Pickup point address = Dom Archidiecezjalny`, the note line `Pickup point: GIT01D - Paczkomat GIT01D, Dom Archidiecezjalny`, and the locker id in the shipping line title. Before the change (#1027) none of these existed.
- Note: a destination retry with OMS sourcing on sends the order into routing (held, `plan-carries-unfulfillable`) and leaves the destination row `pending`; the recreate was done with sourcing off for the test.

### Delta catalogue sync (ModifiedProductLister) - pass
- First `master.product.syncDelta` stamps the watermark and lists nothing (as designed).
- Changed only the Mug variant price in Shopify (41.99 -> 43.49), ran the delta again: one `master.product.syncFromSweep` child for that product only, OL variant price 43.49.
- The variant's `updatedAt` from Shopify was 14 s EARLIER than OL's watermark taken just before the edit (clock difference), so the 15 s lookback the adapter adds is needed, not decorative.

### Publish parameters as metafields - pass
- Published the 3-size Resin Ring with parameters `Material=Resin`, `Stone=[Pressed flowers, Gold leaf]`, `test_data.binding_mount=Burton EST`. Shopify product: `openlinker.material` single_line_text_field "Resin", `openlinker.stone` list.single_line_text_field `["Pressed flowers","Gold leaf"]`, and the shop's own definition `test_data.binding_mount` "Burton EST". `ShopAttributeReader` lists the shop's writable definitions (`test_data.binding_mount`).
- Note: images on the internal `http://prestashop` host are not sent (Shopify cannot fetch them); the publish reports it as a warning.

### Variant group race on publish - fail, fixed in the prototype, then pass
- Run 1: one batch of the 3 Ring sizes, three `shop.product.publish` jobs at the same second. One created the product, the other two FAILED with `HANDLE_NOT_UNIQUE: Handle '...-olc1808c97' already in use`. With `identifier: null` and an explicit handle, Shopify refuses a duplicate handle; the earlier probe (`identifier: {handle}`) got suffixed copies instead. So there were no duplicate products, but two sizes were missing.
- Fix: a sibling refused on the group handle reads the product holding it and, if it carries the `openlinker.variant_group` marker of the same group, adds its variant there.
- Run 2 (all 3 sizes at once): one product, 3 variants, stock 3/4/5, every mapping on the same parent. In this run the master reads spread the jobs out (finished at :20, :25, :30), so the race path was not taken.
- Deterministic check: created the "winner" by hand (group handle + marker, size 18mm), then published only 16mm from OL. Log: `handle ... already held by gid://shopify/Product/15488892436761; adding variant`. Result: one product with 18mm + 16mm, OL mapping for the 16mm and the parent point to that product.

### Refund through Shopify (RefundExecutor, opt-in) - pass
- Connection config `refundsThroughShopify: true`. `POST /returns/<#1018 return>/refund {amount 60.27, reason withdrawal}` -> `moneyState refunded`, `moneyMoved true`, ceiling check `within 146.61`.
- Shopify #1018: `REFUND SUCCESS 60.27` on gateway `manual`, order `PARTIALLY_REFUNDED`, refund note `OpenLinker refund [ol:580e4e4db6a6aacc] - withdrawal - ...`. OL `refund_records`: 60.27 PLN, `executedBy refund_executor`, linked to the return.
- A second confirm answers 409 `ReturnRefundBlockedError` (every line already refunded): no second refund.
- Without the flag the same call only records an out-of-band refund (earlier runs), so the shop owner chooses who moves the money.

### Other notes from run 3
- The publish builder reads the price from the master; PrestaShop product 24 reports price 0 in PL (a test-data problem in the PS stack, not Shopify), so the Ring was published with an explicit price.
- Rebuilding the stack from a shell that had the spike's `.env` loaded replaced the stack's encryption key and every stored credential failed to decrypt (`Unsupported state or unable to authenticate data`). Restarting the containers with only `--env-file stack.env` fixed it. Worth a line in the docker README.

## Run 4 (2026-11-05): tunnel, PR retests, faults, webhooks

Stack: branch `3928-shopify-prototype` (prototype + PRs #3964/#3965/#3969 merged locally). Results per case are in the test report (run4: tags); issues #3974-#3991 in milestone "Shopify integration".

- C21 (PR #3964) pass: Shopify-only order -> job ok on the first attempt, reason `no-destination-configured`, receipt registered.
- F04 (PR #3965) pass: refused receipt -> `outcome new-attempt`, key `:r1`, new document at the vendor; a registered receipt is refused.
- E07 (PR #3969) pass in the UI: Shipping step, "Yes" writes `autoDispatch`, label ordered by itself on an accepted work (InPost refused: sandbox trucker id); "Stop buying labels" works. G06 still fails: `carrier-refused` is retried (#3987).
- D06 pass via cloudflared tunnel + path-filtering proxy: Shopify fetched the PS image, gallery READY on cdn.shopify.com.
- Webhooks (prototype commit e5113db1d): K08 6 subscriptions, old URI removed on change; C10 order in OL ~8.5 s after creation; K09 wrong/missing HMAC -> 401, same webhook id twice -> one job.
- G07 pass (no network: retried, recovered), G05 pass (`CHANGE_FROM_QUANTITY_STALE`, retryable).
- B13/G02 part: 2 of 7 orders hit "Too many attempts", stayed `failed`, no automatic retry (#3984); manual retry created both, no duplicates.
- C12 part: PS order 11 has `payment = ps_wirepayment` but `module = ps_checkpayment` (#3988). C23: PS refuses a name with digits (#3989).
- A20: Shopify with ProductMaster + ProductPublisher re-imported the published Ring twice; orders resolved to the copy (#3985).
- F10 pass: DPD sandbox label 0000899580926Q for Shopify order #1045; C24: relay first rejected (fulfillment order at another location), after the fix (5ef7b1093) #1045 FULFILLED with DPD tracking + URL.
- A16: 1000 products seeded in 196 s; 1000 `products/create` webhooks enqueued, drained at ~64/min; an order during the drain took ~3 min instead of ~8.5 s (#3986). Full sweep: 500 products per run (budget) in 5 batches of 100, ~2 min 50 s.

## Stage 2 (2026-11-05): offers through the OpenLinker UI (Playwright, screenshots under scratchpad ev/ui)

- Category mapping page works only when opened from the master connection (opened with the marketplace id it shows the raw error `Adapter allegro.publicapi.v1 does not support capability: ProductMaster`). Column header says "PRESTASHOP CATEGORIES" although the master is Shopify.
- BUG: the page saves the mapping under the MASTER connection id (`category_mappings.destination_connection_id` = Shopify), but category resolution looks it up under the MARKETPLACE id (`resolveDestinationCategory(destinationConnectionId=Allegro)`). Mappings made in the UI are never used: Sneakers stayed "NO CATALOG MATCH"; the same mapping written under the Allegro id resolved it at once.
- BUG: EAN auto-detect beats the operator's category mapping and is not shown. The seed EAN of T-shirt S/L matched an Allegro catalogue card in "Elektronika > Telefony i Akcesoria > Powerbanki" (`method auto_detect`, category 252023); the wizard marked the rows READY and sent category 252023 although T-Shirts was mapped to "T-shirty".
- Attribute rules (Size -> Rozmiar, Color -> Kolor with Black=czarny/White=biały, fixed Stan/Marka/Materiał) saved fine in the UI, but they do not pre-fill the wizard and do not lift its required-parameter gate (rules run in the worker only), so the operator still types every required parameter.
- UX: the variant panel shows "NEEDS ATTENTION / needs attention. Resolve this blocker..." twice without naming the blocker or the missing fields (Model, Kod producenta were the missing ones).
- Per-variant data sent correctly: price 249 / 84.99 / 79.98, stock 6 / 10 (from Shopify), Rozmiar 42/43 and Kolor czarny/biały per variant, EAN per variant, Stan/Marka/Materiał/Model/Kod producenta from the shared base.
- Allegro sandbox account is blocked for selling (`OfferAccessDeniedException`, `SellerAccountWithSellBlockadeException`). The batch page shows Allegro's Polish text per variant with a "Fix this one" button, although it is an account-level state. A new sandbox seller account is needed to continue.

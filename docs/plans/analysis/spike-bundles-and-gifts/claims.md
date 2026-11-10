# Claim register (stage 0)

Load-bearing claims from rounds 1 and 2 (2026-11-04). Each claim: ID | claim | where it came from | what decision it supports | current status.
Status before rounds 3-5: `2src` = confirmed by both rounds independently, `1src` = one round or one source, `code` = from reading code only, `live` = live test, `disputed` = rounds disagree.

## Channels: Allegro
- C-001 | A `productSet` offer arrives as ONE checkout-form `lineItems[]` entry with `offer.productSet.products[]{id (catalogue UUID), quantity}`, one price, one `tax.rate` | R1 ALG, R2 ALG (swagger) | B-04, D3b | 2src
- C-002 | OL's Allegro order mapper reads only offer.id, quantity, price, name, tax; ignores productSet, originalPrice, discounts[], selectedAdditionalServices (`allegro-order-source.adapter.ts:~998-1015`) | R1 integ, R2 code-B, R2 ALG | live defect, fix-now | 2src code
- C-003 | `LineItemDiscount` carries only `{type}`; no amount, no bundle id | R2 ALG | X-01 (amount = originalPrice - price) | 1src
- C-004 | Discount type BUNDLE also appears on Allegro-created bundles and bundles with no price change | R1, R2 ALG | do not read BUNDLE as "seller discount" | 2src
- C-005 | Allegro single-offer MULTIPACK promotions end 2027-01-12; CROSS_MULTIPACK stays; replacement is a multipack offer (productSet quantity > 1) | R2 ALG (news 15-10-2026) | scope priority of productSet | 1src
- C-006 | `/sale/bundles` is fully deprecated; flexible bundles are the only bundle API | R2 ALG | do not build on /sale/bundles | 1src
- C-007 | A 100% multipack unit is priced 0.01 zl with minimum commission (0.25 zl in 2020 help) | R1, R2 ALG, R1 voice | G-03, Q2 | 2src (amount unverified)
- C-008 | Allegro has no gift feature; gifts are mostly promised in the description and absent from the order | R1, R2 ALG, voice | G-04, operator/rule gifts | 2src
- C-009 | Waybill submission (`/order/.../shipments`) takes lineItems ids only, no quantity, no component | R2 ALG | B-21 | 1src
- C-010 | Customer returns are keyed by offerId + quantity, no component level | R1, R2 ALG | B-15 | 2src

## Channels: shops and ERP
- C-011 | PrestaShop sends a pack as ONE order row; composition only from `products/{id}` `associations.product_bundle` | R1, R2 own-shops | B-04 | 2src
- C-012 | PrestaShop cart-rule gift is folded into the ordinary row at full price; value sits in `order_cart_rules` / `total_discounts`; no separate 0-price row in the order | R2 own-shops (source code), R1 hinted | G-03, mapper comment wrong | disputed (OL mapper comment says separate row)
- C-013 | PrestaShop does not freeze pack composition per order (issue #37423) | R2 own-shops | B-10 snapshot | 1src
- C-014 | PrestaShop `pack_stock_type=0` is read as "shop default" in 8.1.7-9.0.2 (empty() bug), fixed on develop (#42079) | R2 own-shops | B-20 | 1src
- C-015 | WooCommerce Product Bundles: container + child lines linked via `bundled_by`/`bundled_items`; children often total 0 when not priced individually | R1, R2 | B-05, B-19 | 2src
- C-016 | WPC (woosb) bundles link children by meta only (`_woosb_parent_id`), no REST link fields; auto pricing gives a 0-price parent | R2 | B-05 | 1src
- C-017 | Shopify native bundles arrive as component lines only, grouped by `lineItemGroup`; no parent line; price allocated by an unpublished weighted method; tax per component | R1, R2, R2 competitors | B-06, B-19 | 2src
- C-018 | Shoper order line has `type:"1"` with nested `children[]` carrying stock_id, quantity, price, tax per child | R1, R2 (SDK) | B-05 | 2src (from SDK, not live)
- C-019 | OL's Shoper adapter ignores `type`/`children` in orders and in the product master | R1, R2 | live defect | 2src code
- C-020 | IdoSell flags gifts per line `orderSalesMode:"gift"` (also "money", "points"); sets via `bundleId` | R1, R2 | G-01 | 2src
- C-021 | Sky-Shop shows the gift on the order PDF but not on the VAT invoice; sets invoiced as one line with one VAT rate | R1, R2 | anti-pattern | 2src (help only)
- C-022 | Subiekt GT komplet has its own stock only after assembly ("Zmontuj"); OL's GT bridge publishes SUM(st_Stan) so an unassembled komplet shows 0 | R2 PL-SaaS | B-03, Q4 | 1src
- C-023 | Erli has product-level `productSets`/`externalProductSets`; order line has `unitPriceBeforeRebate` (typed in OL, never read) and orders can be EUR / market de | R2 marketplaces, R2 code-B | X-01, Erli type fix | 1src
- C-024 | Mirakl (Empik) is the only marketplace that declares free units explicitly (`promotions[].offered_quantity`, FREE_ITEMS) | R1, R2 | G-01 | 2src
- C-025 | Kaufland sends one `order_unit` per piece | R1, R2 | X-02 | 2src
- C-026 | Amazon `IsGift` means gift wrap/message, not a free item | R1, R2 | G-14 | 2src
- C-027 | No marketplace sends bundle composition on the order | R1, R2 | D3b recognise by SKU | 2src

## Fiscal and tax
- C-028 | eparagony accepts a 0.00 gift line and a 100% per-line rebate (`rebatesMarkups`) only if another line has a positive value at the same VAT letter; otherwise HTTP 400 errorCode 41 before the printer | R1 live probe (sandbox, printer 7783) | G-10, LineAdjustmentRenderingDeclarer | live
- C-029 | A document-level REBATE without taxRate on eparagony spreads across rates and prints wrong VAT | R1 live probe | never use doc rebate for gifts | live
- C-030 | OL core refuses a receipt whose lines do not sum to the total beyond a minor-unit epsilon, so an order-level discount blocks the receipt (line-total-mismatch) | R1 code | correction of earlier claim | code
- C-031 | Kas rejestrujących rozporządzenie 2019 par. 25 requires showing rebates when they occur and per-rate totals after them; silent on 0.00 lines | R1 law | G-10 | 1src
- C-032 | Comarch Optima refuses to fiscalise lines priced 0 | R1 law, R1 voice | G-10 | 2src (vendor docs)
- C-033 | A gift that is part of a paid sale is one supply (tax base = amount paid, art. 29a); a separate free transfer is art. 7 ust. 2 and recorded on an internal document, not the buyer's receipt | R1 law | country-agnostic typed reason | 1src (KIS-dependent)
- C-034 | Small-gift exclusion: up to 20 zl net per unit without records, up to 100 zl per person per year with records (art. 7 ust. 3-4) | R1 law, R2 voice (said 10 zl) | G-12 | disputed (10 vs 20 zl)
- C-035 | BFH XI R 19/23 (2025): split a bundle price by individual selling prices, never above a component's own price | R2 marketplaces | B-14, cap warning | 1src
- C-036 | Italy distinguishes sconto merce (outside VAT base) from omaggio (separate regime) | R2 marketplaces | typed reason | 1src
- C-037 | KSeF FA(3) builder never emits P_10; schema has it | R1 code, R2 code-B | G-10 | 2src code
- C-038 | Subiekt bridge already has a before/after rebate pair on the ZK order path but sets both equal on receipt and invoice | R1 code | G-10 | code

## Competitors
- C-039 | BaseLinker: bundle stock = lowest component stock, per warehouse then summed; one global split switch; no nesting; no pre-built kits | R1, R2 | patterns | 2src
- C-040 | BaseLinker recognises a gift only by price 0; IdoSell gift flag becomes 0.01 zl with value moved to other lines | R1, R2 | G-01 anti-pattern | 2src
- C-041 | Apilo: in-set price per component in the set editor; proportional re-pricing when the channel price differs; set stock recalculated every 15 min | R1, R2 | D3a | 2src
- C-042 | Sellasist: "Dodaj pozycję rabatującą" puts the gift at list price + a "Rabat" line per VAT rate; hide-from-picking flag; dynamic sets with buyer choice after purchase | R1, R2 | G-10, G-09, B-09 | 2src
- C-043 | Linnworks: integrations declare post-sale capability flags (CanCancelOrderLines, CanAttachRefundToItem...), UI adapts; nothing standard for bundles/gifts; Magento-only ignore-children toggle | R2 | standard as advantage | 1src
- C-044 | Shopify: apps declare bundles on the variant (`requiresComponents`); one order shape for all apps | R2 | standard pattern | 1src
- C-045 | Brightpearl: parent row carries whole price, components 0.00; first component shipped marks the bundle shipped to Amazon/Shopify | R1, R2 | anti-pattern, D3f | 2src (archived docs)
- C-046 | Cin7: one BOM object with modes (manual, auto-assembly, pick-for-kitting); per-integration named settings; free-item deals never add the item | R1, R2 | B-03 pattern | 2src
- C-047 | No competitor has a gift out-of-stock swap/notify policy | R1, R2 | G-08 differentiator | 2src
- C-048 | No competitor offers a common, integration-declared standard for bundles and gifts | R2 synthesis | standard as advantage | synthesis

## OpenLinker code
- C-049 | Sale decrement idempotency key is `sale:{owner}:{workId}:{orderLineId}`; two components of one bundle line collide and the second is treated as a replay | R2 code-C | D3c fulfilmentLineId | code
- C-050 | `fulfillment_work_lines` unique on (workId, orderLineId); `shipment_lines` unique on (shipmentId, orderId, lineId) | R2 code-B | D3c | code
- C-051 | `closeForOrder` on the first settled component closes sibling holds | R2 code-C | D3c | code
- C-052 | Routing quantity-conservation check is keyed by order line and would accept a plan mixing components | R2 code-C | D3c | code
- C-053 | Item resolution is all-or-nothing; an unmapped line puts the whole order in awaiting_mapping | R1 core, R2 code-B | gift/bundle ingestion | 2src code
- C-054 | `IncomingOrderTotals` type has no discountTotal although Allegro and PrestaShop emit it | R2 code-B | stage 0 fix | code
- C-055 | A new order-line field must be added in 4 core places + PrestaShop pass-through; fields were lost this way twice | R2 code-B | contract risk | code
- C-056 | Discount-rounding and delivery-spread remainders can land on a 0-priced line | R1 code, R2 code-B | fix-now | 2src code
- C-057 | Operator edits can only lower quantities; no add-line | R1, R2 | G-05 needs add-line | 2src code
- C-058 | Sub-capability declaration patterns: guard-only is the default for new capabilities because enabledCapabilities is never back-filled (#2085); ADR-046 probe-not-trust | R2 code-A | capability design | code
- C-059 | `OrderCreateStockEffect` answers per ORDER, not per line; Woo/Shoper "lowers stock" covers the whole order | R2 code-C | OrderCreateLineStockEffect | code
- C-060 | PrestaShop `adjustInventory` writes only the pack's own stock row, never components | R2 code-C | B-20 | code
- C-061 | Variants come only from master sync; an OL-only bundle variant has no source | R2 code-C | Q3 | code
- C-062 | `order.received` fires before reservation/routing on an order computed from the overlay | R2 code-C | gift rule timing | code

## Merchant voice
- C-063 | Top pain: bundle/component stock drift and oversell | R1, R2 | B-02 priority | 2src
- C-064 | Top pain: refund amount for part of a discounted set | R1, R2 | B-15 | 2src
- C-065 | Top pain: gift not on the order, so no proof, disputes on return | R1, R2 | G-05, G-11 | 2src
- C-066 | Gift running out mid-promotion is frequent and regulators have ruled on it (UK ASA, Superdrug) | R2 | G-08 | 1src
- C-067 | Per-customer gift limits are bypassed with new emails | R2 | G-15 | 1src

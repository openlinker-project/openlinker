# Free gifts (gratisy): detailed use cases

Spike: bundles and gifts, 2026-11-04. Research only. Source of every statement is in the case's Evidence list; paths are relative to `docs/plans/analysis/spike-bundles-and-gifts/` unless they start with `docs/` or `libs/`. Claim ids (C-xxx) are in `claims.md`. Machine-readable twin: `gifts.json`.

## Reading guide

Proposed neutral model used below: order adjustments with `source` (channel | operator | rule), `trigger` (condition-of-sale | discretionary | redemption | unknown), `funder` (seller | channel | other | unknown), `form` (amount | free-units) and `qualifyingLineIds`; lines with `listUnitPriceGross` (nullable = unknown), `taxRate` and `allocations`. "Gift" is a derived view, never a stored tax class (r5/3-marketplaces-countries.md section 4). How a gift appears on documents is an operator setting; device limits are adapter declarations (ADR-082 pattern).

Priorities (r5/7-scope-overengineering.md): stage0 = fix now, independent of scope; pilot = needed for the OMS pilot stack (Allegro routed + PrestaShop or Shoper + eparagony or Subiekt); later = post-pilot (the G20 gift epic, stage 3); out = not a separate feature.

| Priority | Cases |
|---|---|
| stage0 (3) | G-17, G-18, G-20 |
| pilot (1) | G-14 |
| later (16) | G-01, G-02, G-03, G-04, G-05, G-06, G-07, G-08, G-09, G-10, G-11, G-12, G-15, G-16, G-19, G-21 |
| out (1) | G-13 |

## Where the evidence disagrees with the proposed model

- **Document treatment is a separate choice, not derivable from `trigger`.** KIS 0114-KDIP1-1.4012.876.2025.2.IZ (23.01.2026) classed a 0 zl / 100%-rebate gift as a free supply (art. 7 ust. 2) even though it was promised as part of a paid order, while 2015/2016 rulings treat a gift priced into the paid goods as a paid supply at its own rate. So a condition-of-sale gift can end up either way; the model needs a stored `treatment` (priced-in | symbolic | gratuitous | zero-line) chosen by the operator (r5/8-tax-fiscal.md C-033, section 5; G-10).
- **"List price + 100% rebate" is the riskiest rendering, not the safe default** the spike proposed (r5/8-tax-fiscal.md Headline; G-10).
- **An allocation needs a unit count.** A PrestaShop gift of a product the buyer also bought is one row with quantity paid+1 (verify/prestashop-live.md Q2); "one of two units free" cannot be expressed by an amount alone (r5/2-shops-erp.md counterargument 4; G-03).
- **`trigger` cannot be read from `source`.** An operator-added gift may be a promised condition of sale or an apology (r5/3-marketplaces-countries.md A2; G-04).
- **`listUnitPriceGross` from Allegro `originalPrice` is a false claim** on CAMPAIGN and ALLEGRO_PRICES lines, so the field must stay null there (r5/1-allegro-pl.md; G-02).
- **Small-gift thresholds key on purchase cost, not list price** (r5/8-tax-fiscal.md C-034; G-12).

## Cases added or merged

- Added: G-17, G-18, G-19, G-20, G-21 (marked NEW).
- Merged: X-04 (gift added after the order exists): the PrestaShop back-office case is an alternative flow of G-03; the OpenLinker case is G-05.
- Merged: r5/6 N-1 (order.received never fires after awaiting_mapping): folded into G-06 and G-16 alternative flows.
- Merged: Allegro single-offer MULTIPACK free unit: folded into G-02 (amount-less discount), no separate case.

## G-01 Gift flagged by the channel

**Priority:** later. No pilot channel flags gifts (Allegro C-008, PrestaShop C-012, Shoper PLS-05) and the two channels that do (IdoSell, Mirakl) have no in-tree adapter.

**Confidence:** confirmed. **Mechanism:** field.

**Actor:** System (order ingestion through the source adapter)

**Trigger:** An order arrives with a line the channel itself marks as free (IdoSell `orderSalesMode: gift`, WooCommerce GIFTiT meta `_free_gift=yes`, Mirakl FREE_ITEMS promotion).

**Preconditions**

- The connection is an OrderSource and its adapter knows the channel's flag field.
- The gift line resolves to an OpenLinker variant (otherwise the whole order waits in awaiting_mapping, C-053).

**Main flow**

1. The adapter reads the line and the channel flag.
2. The adapter emits the line with the paid unit price exactly as sent, `listUnitPriceGross` only when the channel states a real pre-discount price (otherwise null), and `taxRate`.
3. The adapter emits one order adjustment {source: channel, trigger: condition-of-sale, funder: as stated or unknown, form: free-units, qualifyingLineIds: as stated or unknown} with an allocation on the gift line.
4. Core persists line and adjustment; 'gift' is a derived view (line value fully covered by allocations, or form free-units), never a stored tax class (r5/3-marketplaces-countries.md section 4).
5. Reservation, routing and sale decrement treat the gift as an ordinary line; it has its own channel line id and is safe on every key (r4/code/B-line-identity-traced.md section 0).
6. The pack bench shows the derived gift badge (G-09).

**Alternative flows and exceptions**

- Mirakl: free units may sit inside the same line's `quantity` (unknown). The adapter allocates `offered_quantity` units on that line and never invents a second line.
- Flag present but price > 0 (GIFTiT `_price_for_gift`): the paid price is kept; the line is not shown as a free gift because allocations do not cover its value.
- Gift SKU unmapped: the order goes to awaiting_mapping naming the gift line (C-053); a later automation on order.received will not fire for it (r5/6-design-and-code.md N-1, see G-06).
- Unknown flag value (for example IdoSell `points`): not a gift. `points` is a redemption (trigger: redemption) or a payment, never an error (r5/3-marketplaces-countries.md A1).

**What each channel sends**

- idosell: `productsResults[].orderSalesMode: "gift"` (also money, points); `bundleId` for sets; write side uses `productFree`. Whether a gift line's price is 0 or the real price is unknown (r4/phase1/3-pl-saas-and-erp.md PLS-07, PLS-12, line 143). No in-tree OL adapter (docs/architecture-overview.md, Module Organization).
- woocommerce: Core: a 100% product coupon gives a line with `subtotal` = regular, `total` = 0, plus `coupon_lines[]` with no link to the line (SHOP-10). GIFTiT plugin: own line priced `_price_for_gift` (default 0, may be > 0), meta `_free_gift=yes`, `_free_gift_type`, `_rule_id_free_gift`; regular price not stored (SHOP-14, r4/phase1/2-own-shops.md section 5). OL's adapter reads neither `subtotal` nor `meta_data` (r4/code/B-line-identity-traced.md section 3).
- mirakl: `order_lines.promotions[]` with `configuration.type: FREE_ITEMS`, `offered_quantity`, `deduced_amount`, `apportioned`; whether `quantity` includes the free units is unknown (r4/phase1/4-marketplaces-and-law.md 1.5, C-024). Empik seller enablement unknown (r5/3 C-024 row). No in-tree OL adapter.
- allegro: Not applicable: no gift flag (C-008).
- prestashop: Not applicable: no flag; see G-03.

**OpenLinker behaviour**

Adapter work only: map the flag into the neutral adjustment and allocation. Core stores the adjustment and derives the gift view. No capability: absence of the field means 'channel did not say', and an adapter that does not read the flag simply emits none. Today no in-tree adapter reads any gift flag; IdoSell and Mirakl have no in-tree adapter at all (docs/architecture-overview.md, Module Organization), and the WooCommerce adapter does not read `meta_data` (r4/code/B-line-identity-traced.md section 3).

**Acceptance criteria**

- Given a WooCommerce order with a GIFTiT line (`_free_gift=yes`, price 0.00) and one paid line, when the order is ingested, then the gift line carries an allocation of an adjustment with source channel and form free-units, `listUnitPriceGross` is null, and the order total equals the channel total.
- Given a flagged gift line whose SKU has no mapping, when the order is ingested, then the order is awaiting_mapping and the unresolved reference names the gift line.
- Given a GIFTiT line flagged as gift with `_price_for_gift` 5.00, when the order is ingested, then the line keeps its 5.00 paid price and is not shown as a free gift.

**Evidence**

- C-020
- C-024
- C-040
- r4/phase1/3-pl-saas-and-erp.md PLS-07, PLS-12
- r4/phase1/2-own-shops.md SHOP-14
- r4/phase1/4-marketplaces-and-law.md 1.5
- r5/3-marketplaces-countries.md C-024 row
- r4/code/B-line-identity-traced.md section 0

**Risks**

- Mirakl `quantity` vs `offered_quantity` semantics unknown: a wrong guess double-counts or drops free units.
- BaseLinker anti-pattern to avoid: turning an IdoSell gift into 0.01 and moving value onto other lines (C-040).
- IdoSell gift line price (0 or real) unknown; the adapter must not assume.

## G-02 Gift not flagged: 0.00 line, one minor unit, or full price with a 100% discount

**Priority:** later. Detection is differentiation, not damage prevention; the fiscal damage a zero line causes today is handled by stage0 cases G-17 and G-18 (r5/7-scope-overengineering.md section 5).

**Confidence:** probable. **Mechanism:** field.

**Actor:** System (order ingestion)

**Trigger:** A line arrives whose paid value is zero or nominal, or whose discount equals its list value, with no channel gift flag.

**Preconditions**

- The adapter reads whatever pre-discount price and discount amounts the channel sends.

**Main flow**

1. The adapter emits the paid unit price as sent and `listUnitPriceGross` only when the channel states a real pre-discount price (Shopify `originalUnitPriceSet`, eBay `lineItemCost`, WooCommerce `subtotal`).
2. The adapter emits one adjustment per channel promotion (id when sent, else synthetic) and allocations with an amount when the channel gives one (Shopify, eBay, Mirakl, Kaufland) or null when it does not (Allegro).
3. Core runs a pure classifier that labels the line `inferred-zero`, `inferred-nominal` (one minor unit via `minorUnitExponentFor`, never a literal 0.01) or `inferred-full-rebate` (r3/code/A-capability-design.md 2.2).
4. The label drives UI and the pack bench only; an inference never changes a fiscal document on its own (r3/code/A-capability-design.md 2.2, lesson P11).

**Alternative flows and exceptions**

- Allegro CAMPAIGN or ALLEGRO_PRICES: `originalPrice` equals `price` although a reduction happened, so `listUnitPriceGross` must be null, not `originalPrice` (r5/1-allegro-pl.md C-003 row and B).
- Allegro ALLEGRO_PRICES with `reconciliation`: the platform-funded part is recorded with funder channel (r5/1-allegro-pl.md point 5, r5/3 A1 Art. 73).
- Allegro 100% multipack unit inside a quantity > 1 line: probably averaged into `price`, so no zero line exists and no inference is possible (C-007 unverified edge).
- Several discounts on one line (Allegro `discounts[]` is an array): several adjustments, per-reason amount null, never pick one reason (r5/1-allegro-pl.md C).
- Allegro discount type BUNDLE does not mean a seller discount (C-004).
- Allegro `price` and `originalPrice` are UNIT prices (verify/allegro-line-price.md Q1); how an n-th-unit MULTIPACK discount is expressed in one unit price is undocumented (same file, caveat).

**What each channel sends**

- allegro: No gift field or gift line in the checkout form; the only 'gift' string is the paid service GIFT_WRAP (C-008, r5/1-allegro-pl.md C-008 row). A free unit exists only as a MULTIPACK / CROSS_MULTIPACK discount up to 100%, reported as `lineItems[].discounts[{type: UNIT_PERCENTAGE_DISCOUNT}]` with no amount (C-003, r4/phase1/1-allegro.md ALG-07/08). A 100% unit was 0.01 zl with a minimum commission in a 2020 moderator post (C-007, probable, amount unverified for 2026). Single-offer MULTIPACK ends 2027-01-12, CROSS_MULTIPACK stays (C-005).
- shopify: BXGY free item is a normal line at full `originalUnitPriceSet` with `discountAllocations` equal to its value; no gift flag; the buyer adds it manually (r4/phase1/2-own-shops.md SHOP-16). No in-tree OL adapter.
- woocommerce: Core: a 100% product coupon gives a line with `subtotal` = regular, `total` = 0, plus `coupon_lines[]` with no link to the line (SHOP-10). GIFTiT plugin: own line priced `_price_for_gift` (default 0, may be > 0), meta `_free_gift=yes`, `_free_gift_type`, `_rule_id_free_gift`; regular price not stored (SHOP-14, r4/phase1/2-own-shops.md section 5). OL's adapter reads neither `subtotal` nor `meta_data` (r4/code/B-line-identity-traced.md section 3).
- ebay: `lineItemCost` before discounts, `appliedPromotions[]{discountAmount, promotionId}`; `giftDetails` is digital gift cards only (r4/phase1/4-marketplaces-and-law.md 1.6). No in-tree OL adapter.
- amazon: `PromotionDiscount`, `PromotionIds` (v0); `ItemPromotionBreakdown.promotionId` (2026-01-01); no free-quantity field; `IsGift` is gift wrap / message (C-026, r4/phase1/4-marketplaces-and-law.md 1.2-1.3). No in-tree OL adapter.
- kaufland: One `order_unit` per piece; `discounts[]{usage_type, discount_value}` carries seller-funded discounts only, Kaufland-funded promotions are invisible (r4/phase1/4-marketplaces-and-law.md 1.4, C-025). No in-tree OL adapter.
- erli: No gift, free-quantity or bundle field (grep 0 hits). Line `unitPriceBeforeRebate`, order-level `rebate{id,name,code}` with no amount (r4/phase1/4-marketplaces-and-law.md 1.1). `unitPriceBeforeRebate` is not a list price (r5/3-marketplaces-countries.md C-023 notes). Typed in OL, never read (C-023).

**OpenLinker behaviour**

Adapter fills neutral fields (field mechanism, three-state: null = unknown). Core owns one pure classifier. Today the Allegro wire type does not even declare `originalPrice` or `discounts` (r4/code/B-line-identity-traced.md section 3, C-002), so nothing is detected.

**Acceptance criteria**

- Given a line with list price 50.00 and a discount allocation of 50.00, when the order is ingested, then the line is labelled inferred-full-rebate, the order total is unchanged, and no document setting changes because of the label alone.
- Given an Allegro line with `discounts:[{type: CAMPAIGN}]` and `originalPrice` equal to `price`, when the order is ingested, then `listUnitPriceGross` is null, not equal to `originalPrice`.
- Given a PLN line priced one grosz, when the order is ingested, then the line is labelled inferred-nominal and is never treated as a channel-asserted gift.

**Evidence**

- C-002
- C-003
- C-004
- C-007
- r4/phase1/2-own-shops.md SHOP-10, SHOP-16
- r4/phase1/4-marketplaces-and-law.md 1.2-1.6
- r5/1-allegro-pl.md C-003 row, B, C, F
- r3/code/A-capability-design.md 2.2
- verify/allegro-line-price.md Q1

**Risks**

- False positive: a genuinely cheap product at one minor unit labelled as a gift.
- Filling `listUnitPriceGross` from Allegro `originalPrice` states a false 'no reduction' on CAMPAIGN and ALLEGRO_PRICES lines (r5/1-allegro-pl.md).
- An OL operator discount rewrites `unitPriceGross` (#3543), so a reduction derived as list minus paid would mix channel and OL discounts (r5/6-design-and-code.md N-3).

## G-03 Gift folded into a paid line (PrestaShop cart-rule gift)

**Priority:** later. Damage today is a visible document refusal rather than silent damage (C-030), stock is safe for unrouted own-shop orders, and whether the pilot client uses cart-rule gifts is an open client question (docs/plans/spike-bundles-and-gifts.md open questions).

**Confidence:** confirmed. **Mechanism:** field.

**Actor:** System (PrestaShop source adapter)

**Trigger:** A PrestaShop order is ingested whose applied cart rule has a `gift_product`, or a 100% `reduction_product`.

**Preconditions**

- The cart rule still exists when OL reads it, or a module snapshot of applied rules exists (r5/2-shops-erp.md section 2).
- The gift product maps to an OL variant.

**Main flow**

1. The adapter reads order rows (`id_order_detail`) and `order_cart_rules`.
2. For each applied rule the adapter reads `cart_rules/{id}`: `gift_product` / `gift_product_attribute`, or `reduction_product` with `reduction_percent` 100.
3. Gift product also bought: the adapter keeps the ONE merged row (quantity paid+1, full unit price) and adds an allocation of one unit's value with form free-units and quantity 1; it does not split the row (r5/2-shops-erp.md counterargument 4, verify/prestashop-live.md Q2).
4. Gift product not otherwise bought: its own row at full price gets an allocation equal to the row value (verify/prestashop-live.md Q1).
5. The order-level `discountTotal` is reduced by what was attributed, so lines plus remaining order discount reconcile to `total_paid_tax_incl` within the rounding tolerance.

**Alternative flows and exceptions**

- 100% `reduction_product` rule without `gift_product`: same shape live (both rows at full price, value only in `order_cart_rule`), target product only on the cart rule (verify/prestashop-live.md Q3).
- One rule carries gift plus a percentage reduction: `order_cart_rule.value` is one sum; the gift part equals the gift's unit price (`CartRule.php:1555-1566`), the rest stays an order-level adjustment (SHOP-07).
- Rule edited or deleted before OL reads it: the join is lost; the discount stays order-level, no gift is asserted, and the reason is recorded (r5/2-shops-erp.md extra cases).
- A back-office edit adds a gift row after the order exists (`AddProductToOrderHandler.php:261-262`): detection must also run on order updates (r5/2-shops-erp.md, X-04).
- `validateOrder` crashed mid-way: rows exist but no `order_cart_rule` row, so the gift cannot be detected at all (verify/prestashop-live.md order 6).
- Rows minus discount differ from `total_paid_tax_incl` by one grosz (29.28 - 14.64 vs 14.63) and gift-rule value is 14.637 vs 14.640 for a percentage rule (verify/prestashop-live.md surprise 2): reconciliation must use a minor-unit tolerance.

**What each channel sends**

- prestashop: Cart-rule gift is a real `order_detail` row at FULL unit price with no gift marker; if the gift product is also bought it is the SAME row with quantity paid+1. Value only in `order_cart_rules.value` / `value_tax_excl` and `total_discounts_tax_incl`; the gift product only via `cart_rules/{id}.gift_product` (C-012; live on 9.0.2: verify/prestashop-live.md Q1-Q3). `orders.gift` is gift wrapping (verify/prestashop-live.md Q6).

**OpenLinker behaviour**

Adapter-only detection. Core must accept an allocation covering some units of a line: the proposed allocation needs a unit count for 'one of two units free' (r5/2 proposes `giftQuantity`), which the neutral model does not yet carry. Today the cart-rule discount stays order-level and 'never reaches a line' (r4/code/B-line-identity-traced.md section 3, `prestashop-order.mapper.ts:136-139`), and the mapper comment claiming a separate gift row is wrong for core PrestaShop (C-012, live-confirmed). A discount on no line fails the core line-sum check, so such an order's receipt is blocked, not wrong (C-030 confirmed in r5/8-tax-fiscal.md, `order-to-register-transaction-command.mapper.ts:136`). Own-shop orders are not routed (#3487), so stock is not at risk (r5/7-scope-overengineering.md D3).

**Acceptance criteria**

- Given a PrestaShop order with 1 paid unit of X plus a cart-rule gift of X, when the order is ingested, then there is one line with quantity 2 and an allocation covering 1 unit, and no extra line.
- Given a cart-rule gift of Y not otherwise bought, when the order is ingested, then Y's line keeps its full unit price with an allocation equal to its value and is shown as a gift.
- Given a 100% `reduction_product` rule on Z, when the order is ingested, then Z's line carries an allocation equal to its value from that rule.
- Given the cart rule was deleted before ingestion, when the order is ingested, then the discount stays order-level, no gift is asserted, and the order records why.

**Evidence**

- C-012
- C-030
- verify/prestashop-live.md Q1, Q2, Q3, surprises
- verify/standard-stress-test.md hole 11, D7 (allocation needs `targetLineId` + `freeQuantity`)
- r5/2-shops-erp.md sections 1 and 8
- r4/phase1/2-own-shops.md SHOP-04..08
- r4/code/B-line-identity-traced.md section 3
- r5/8-tax-fiscal.md C-030
- r4/phase1/5-merchant-voice.md PAIN-10, PAIN-11

**Risks**

- Returns cannot tell the free unit from the paid unit of a merged row.
- PrestaShop prorates tax across gift and paid units (upstream #34085, r5/2-shops-erp.md line 43); OL must not copy that split onto documents.
- The cart-rule join is fragile; the PrestaShop module snapshot at `actionValidateOrderAfter` is the exact alternative but needs a module release (r5/2-shops-erp.md section 2).
- Live probe ran on 9.0.2 only; older versions rest on source reading (r5/2-shops-erp.md).

## G-04 Gift promised only in the listing, absent from the order

**Priority:** later. The pilot covers this with the zero-code G-20 process; a structured add needs an add-line writer that does not exist (C-057, r5/7-scope-overengineering.md section 5).

**Confidence:** confirmed. **Mechanism:** core.

**Actor:** Operator, or an automation rule

**Trigger:** An order arrives for an offer whose description promises a gift; the order has no gift line.

**Preconditions**

- The gift SKU exists in the master and has a stock position.
- OL knows which offers promise which gift (operator knowledge, or a gift reference on the offer mapping).

**Main flow**

1. The order arrives without the gift (C-008).
2. The operator (G-05) or a rule keyed on offer or variant (G-06) adds the gift line with source operator or rule, funder seller, form free-units.
3. Whoever adds it chooses the trigger: condition-of-sale (promised in the listing) or discretionary.
4. The gift is reserved, routed and decremented like any line; the bench shows it.

**Alternative flows and exceptions**

- Pilot: no add-line exists; the interim process G-20 (packer note plus manual stock correction) applies.
- Allegro writebacks (waybill, refunds, returns) must skip the OL-added line (G-21).
- Apilo pattern: the listed product becomes a set with the gift as a component, so every order carries it (r4/phase2/2-apilo.md G-04); in OL that is G-07.

**What each channel sends**

- allegro: No gift field or gift line in the checkout form; the only 'gift' string is the paid service GIFT_WRAP (C-008, r5/1-allegro-pl.md C-008 row). A free unit exists only as a MULTIPACK / CROSS_MULTIPACK discount up to 100%, reported as `lineItems[].discounts[{type: UNIT_PERCENTAGE_DISCOUNT}]` with no amount (C-003, r4/phase1/1-allegro.md ALG-07/08). A 100% unit was 0.01 zl with a minimum commission in a 2020 moderator post (C-007, probable, amount unverified for 2026). Single-offer MULTIPACK ends 2027-01-12, CROSS_MULTIPACK stays (C-005). A description-only gift leaves no trace in the checkout form (r4/phase1/1-allegro.md ALG-15).

**OpenLinker behaviour**

Core only (an OL-added line); no adapter change. The trigger axis cannot be read from where the line came from: an operator-added gift can be a condition of the sale or an apology (r5/3-marketplaces-countries.md A2), so the operator states it.

**Acceptance criteria**

- Given an Allegro order for an offer mapped with gift SKU X and an active rule, when the order is ingested, then a line X with source rule and trigger condition-of-sale exists before the reservation runs.
- Given an order with an OL-added gift line, when the waybill is relayed to Allegro, then only Allegro `lineItems` ids are sent.
- Given the pilot without add-line, when the operator writes a packer note naming the gift, then the note is visible on the pack bench for that parcel.

**Evidence**

- C-008
- C-065
- r4/phase1/1-allegro.md ALG-15
- r5/7-scope-overengineering.md D7 and section 5
- r4/phase2/2-apilo.md G-04
- r4/phase2/3-sellasist.md G-04

**Risks**

- Allegro rules on gifts in thumbnails and on choosing recipients (r4/phase1/1-allegro.md S9, r4/phase1/5-merchant-voice.md section on thumbnails): an OL rule must not pick recipients at random.
- Pilot-period gift orders leave no structured history (r5/7-scope-overengineering.md section 7 point 8).

## G-05 Operator adds a gift line to an order

**Priority:** later. No add-line exists anywhere and the writer must move into core; r5/7 sizes G-05 alone as an L (r5/7-scope-overengineering.md section 5).

**Confidence:** confirmed. **Mechanism:** core.

**Actor:** Operator (admin)

**Trigger:** The operator uses an 'add gift' action on order detail.

**Preconditions**

- The order is ready, not shipped and not packed.
- The gift variant has a stock position.
- The order has no open amendment and no bought label (same gates as other edits).

**Main flow**

1. The operator picks variant, quantity, trigger (condition-of-sale or discretionary) and optionally the qualifying lines.
2. Core writes an `addedLines` entry in the edit overlay; `orderSnapshot` stays the channel original (#3542 invariant, r5/6-design-and-code.md section 4).
3. The effective order gets a new line with paid price 0, `listUnitPriceGross` from the catalogue, and an adjustment {source: operator, form: free-units, funder: seller}.
4. A reservation is taken for the new line id.
5. On a routed order the line is added to the open work, or the edit is refused when the work is accepted or packed.
6. A timeline entry records who added what (X-06).

**Alternative flows and exceptions**

- Gift has no available-to-promise: refuse with a stock reason, or follow the G-08 policy.
- Order already invoiced: totals do not change (price 0); only the G-10 treatment setting decides whether a new document shows it.
- Operator removes the gift before packing: overlay entry removed, hold released.

**What each channel sends**

- all: None; the line exists only in OpenLinker.

**OpenLinker behaviour**

Core: a new overlay section and merge, an add-line method on the fulfilment work repository (none today, r4/code/C-stock-flows-traced.md (d)), and the edit writer moved from apps/api into core so automation can reuse it (r5/6-design-and-code.md N-2). Edits today can only lower quantities (C-057). No capability.

**Acceptance criteria**

- Given a ready, unpacked order, when the operator adds gift X quantity 1, then `orderSnapshot` is unchanged, the effective order has a new 0.00 line X, and a hold exists for X.
- Given a packed order, when the operator adds a gift, then the edit is refused with ORDER_PACKED and nothing is written.
- Given an order with an added gift, when an invoice is issued, then the invoice total equals the order total.

**Evidence**

- C-057
- r4/code/C-stock-flows-traced.md (d)
- r5/6-design-and-code.md N-2, section 4
- r5/7-scope-overengineering.md sections 5 and 8
- C-065
- r4/phase2/2-apilo.md G-05
- r5/4-competitors-pl.md G-05 rows

**Risks**

- A line added after routing never reaches the bench without an add-to-work path (r4/code/C-stock-flows-traced.md (d) point 3).
- Channel writebacks naming an OL-only line id fail (G-21).
- Analytics rows are positional and cost carry-forward is keyed by productId|variantId, so a gift and a paid line of the same variant collide (r3/code/B-order-lines-and-documents.md line 243).

## G-06 Automation rule adds a gift

**Priority:** later. Automation has no line action, line facts or reliable timing today (N-1); r5/7 places the gift epic in stage 3 (r5/7-scope-overengineering.md section 8).

**Confidence:** confirmed. **Mechanism:** core.

**Actor:** System (automation)

**Trigger:** order.received (T9) for an order matching the rule's conditions.

**Preconditions**

- An active rule with conditions (basket value, SKU in basket, channel, campaign dates) and a gift variant.
- The order is ready (items resolved).

**Main flow**

1. T9 fires after the effective order is computed and before reservation and routing (C-062, r4/code/C-stock-flows-traced.md (d)).
2. Conditions are evaluated; basket value and channel exist today, SKU-in-basket, per-line quantity and campaign window do not (r4/code/C-stock-flows-traced.md (d)).
3. A new action 'add line' writes the overlay entry with source rule, ruleId, trigger condition-of-sale and qualifyingLineIds.
4. Ingestion recomputes the effective order before reservation and routing, so the gift is reserved and routed with the rest.
5. The action is idempotent per (rule, order): a re-poll never adds a second gift.

**Alternative flows and exceptions**

- Order first parked in awaiting_mapping: T9 never fires on the retry today (r5/6-design-and-code.md N-1); the rule must run once when the order first becomes ready.
- Gift per qualifying unit ('buy 2 TVs, get 2 soundbars', PrestaShop #32324 via r4/phase1/5-merchant-voice.md PAIN-12): quantity derived from qualifying quantity.
- Order cancelled or reduced below the threshold before packing: the gift is removed (r3/phase1/5-merchant-voice.md PAIN-08).
- Gift out of stock: G-08. Rule error: G-16.

**What each channel sends**

- all: None; conditions read OpenLinker's own order facts.

**OpenLinker behaviour**

Core automation: new action in `AutomationActionValues`, an irreversibility entry, legality on order.received, new condition fields and line facts (r4/code/C-stock-flows-traced.md (d)). No adapter work. Reuses the G-05 core writer.

**Acceptance criteria**

- Given a rule 'order total >= 200 PLN adds X' and an order of 250 PLN, when the order is ingested, then exactly one X line with source rule exists before the reservation.
- Given the same order re-polled, when ingestion runs again, then no second X line is added.
- Given an order first in awaiting_mapping that later becomes ready, when it becomes ready, then the rule runs once.

**Evidence**

- r4/code/C-stock-flows-traced.md (d)
- C-062
- r5/6-design-and-code.md N-1
- verify/standard-stress-test.md hole 12
- r4/phase2/3-sellasist.md G-06
- r5/5-competitors-global.md G-06 Brightpearl row
- r3/phase1/5-merchant-voice.md PAIN-08
- r4/phase1/5-merchant-voice.md PAIN-12, PAIN-14

**Risks**

- A silent miss on a qualifying order is a regulatory exposure (UK ASA Superdrug 2018, r4/phase1/5-merchant-voice.md PAIN-14); C-066's 'frequent' claim is disputed (r5/1-allegro-pl.md C-066 row).
- Threshold before or after discounts is ambiguous for merchants (r4/phase1/5-merchant-voice.md PAIN-13).

## G-07 Gift as a bundle component

**Priority:** later. D3d is deferred; only the id role segment must be reserved in stage 1 (r5/7-scope-overengineering.md section 5).

**Confidence:** probable. **Mechanism:** core.

**Actor:** Operator (bundle definition), system (expansion)

**Trigger:** A bundle line is ordered whose OpenLinker definition includes a gift component.

**Preconditions**

- Stage 1 bundle definitions exist (#3607).
- The component is marked as gift with in-set price 0.

**Main flow**

1. Expansion derives a component line id `{lineId}~g:{variantId}`; the role segment keeps it distinct from a paid component of the same variant (r5/7-scope-overengineering.md 4c).
2. The gift component is reserved, picked and decremented like other components.
3. Documents keep the bundle line (decided D3); the gift does not appear on documents by default.

**Alternative flows and exceptions**

- Gift component out of stock: bundle availability becomes 0 and the offer stops selling (Apilo side effect, r4/phase2/2-apilo.md G-08), unless a G-08 policy lets the bundle ship without it.
- Component documents (D3c) later: the gift then needs the G-10 treatment setting.
- IdoSell forbids the reverse (a gift that is itself a set: 'Towar Gratisowy nie moze byc zestawem'); Shopify limits a bundle by its scarcest component (verify/nested-and-gift-stockout.md surprise 5).

**What each channel sends**

- all: None; the composition is OpenLinker's own definition (C-027 as corrected: Allegro sends catalogue UUIDs only, r5/1-allegro-pl.md C-027 row).

**OpenLinker behaviour**

Core (bundle expansion). The only decision needed now is the `~g:` role segment in the derived id format, because ids land in terminal reservation rows and unique decrement keys (r5/7-scope-overengineering.md 4c, section 7 point 1).

**Acceptance criteria**

- Given a bundle defined as A + B + gift G, when one bundle is ordered, then three component lines exist with ids ending `~c:A`, `~c:B`, `~g:G` and G is reserved.
- Given a bundle whose paid and gift components are the same variant, when it is expanded, then the two component ids differ and both decrement once.

**Evidence**

- r5/7-scope-overengineering.md 4c, section 5
- r4/code/C-stock-flows-traced.md (d) point 4
- r4/phase2/2-apilo.md G-07
- r5/4-competitors-pl.md G-07 rows
- r5/5-competitors-global.md G-07 rows
- verify/nested-and-gift-stockout.md claim 2 (Apilo row)

**Risks**

- A cheap gift component that runs out stops sales of the whole bundle.
- No competitor documents a zero-price component guarantee (r5/4-competitors-pl.md G-07 rows).

## G-08 Gift runs out during a promotion

**Priority:** later. Depends on G-05/G-06; several competitors already stop or block, so only substitution and visibility are a gap (verify/nested-and-gift-stockout.md claim 2).

**Confidence:** confirmed. **Mechanism:** setting.

**Actor:** System (rule or add-line), operator

**Trigger:** A rule or operator tries to add a gift whose available-to-promise is below the needed quantity.

**Preconditions**

- G-05 or G-06 exists.
- The rule declares an out-of-stock policy.

**Main flow**

1. Available-to-promise is checked when the gift is added.
2. The rule's policy applies: stop (no gift, attention plus timeline entry), substitute (a declared substitute variant), or allow (add and let the hold go short).
3. The outcome is never silent: the order shows which rule did not deliver and why.
4. Optionally the rule pauses itself once its gift pool is empty and tells the operator.

**Alternative flows and exceptions**

- Substitute also out of stock: falls back to stop.
- The listing still advertises the gift (Allegro thread 1050074, r3/phase1/5-merchant-voice.md PAIN-07): the attention text asks the operator to update the offer.
- Buyer notification: out of scope; no competitor substitutes a gift or tells the buyer (verify/nested-and-gift-stockout.md claim 2).
- Competitor policies seen: stop the offer (Shopify, IdoSell, Apilo set), block the action (Sellasist), wait silently (Brightpearl), add regardless (Linnworks) (verify/nested-and-gift-stockout.md surprise 4).

**What each channel sends**

- all: None.

**OpenLinker behaviour**

Core plus a per-rule setting. Reuses available-to-promise (`IAvailabilityService`).

**Acceptance criteria**

- Given a rule with policy stop and gift ATP 0, when a qualifying order arrives, then no gift line is added and the order carries a visible attention entry naming the rule.
- Given a rule with substitute S and gift ATP 0, S in stock, when a qualifying order arrives, then S is added with the same adjustment.

**Evidence**

- C-047 (disputed as worded)
- verify/nested-and-gift-stockout.md claim 2
- r5/4-competitors-pl.md G-08 rows and C-047
- r5/5-competitors-global.md SH7 and C-047
- r4/phase2/3-sellasist.md G-08
- r3/phase1/5-merchant-voice.md PAIN-07
- r4/phase1/5-merchant-voice.md PAIN-14
- C-066 (disputed)

**Risks**

- 'Never silent' needs an attention reason that clears correctly; a stale reason is noise.

## G-09 Gift visible on the pack bench and packing slip

**Priority:** later. Comes almost free once gift lines exist; the pilot uses packer notes (r5/7-scope-overengineering.md section 5).

**Confidence:** confirmed. **Mechanism:** core.

**Actor:** Packer

**Trigger:** A parcel containing a gift line is opened on the bench or a packing slip is printed.

**Preconditions**

- The gift is a line on the order (G-01, G-03, G-05, G-06) or a bundle component (G-07).

**Main flow**

1. The bench shows the gift line with a 'Gift' badge from the derived view and its quantity.
2. The gift must be scanned like any item; the parcel cannot close short (same logic as a missing bundle component, r5/7-scope-overengineering.md section 5).
3. The packing slip lists the gift without a price.

**Alternative flows and exceptions**

- Pilot: the gift is a packer note (`BenchParcelView.packerNotes`, `showToPacker`), not a line (G-20).
- Hiding a gift from picking must be per line, never per product (Sellasist's product-level flag hides the product everywhere, r5/4-competitors-pl.md line 62).

**What each channel sends**

- all: None.

**OpenLinker behaviour**

Core bench view plus frontend; reads the derived gift view.

**Acceptance criteria**

- Given a parcel with a gift line, when the packer opens it, then the gift line shows a Gift badge and must be scanned before the parcel closes.
- Given a product sold both normally and as a gift, when two parcels are packed, then only the gift line carries the badge.

**Evidence**

- r5/7-scope-overengineering.md section 5 (packerNotes)
- r4/phase2/3-sellasist.md G-09
- r5/4-competitors-pl.md lines 62, 84
- r5/5-competitors-global.md G-09 row
- r3/phase1/5-merchant-voice.md PAIN-06

**Risks**

- A gift that is only a note cannot be enforced at close.

## G-10 Gift treatment on invoice and receipt (operator setting)

**Priority:** later. Rulings conflict (KIS 2026 vs 2015/2016) and the merchant's treatment needs a tax adviser; the minimum fiscal safety for the pilot is stage0 G-18 (r5/8-tax-fiscal.md, r5/7-scope-overengineering.md section 8 stage 3).

**Confidence:** disputed. **Mechanism:** setting.

**Actor:** Operator (chooses the treatment, with a tax adviser), system (issues the document)

**Trigger:** A sales document is issued for an order containing a derived gift line.

**Preconditions**

- A per-connection or per-rule setting `giftTreatment` with the four neutral values below, the ADR-082 `freeDelivery` shape (r5/6-design-and-code.md 3.7). Treatment values (r5/8-tax-fiscal.md section 5 and A1-A3): `priced-in` (the gift carries a positive share of what the buyer paid, split by list price, never above its own list price), `symbolic` (gift line at one minor unit), `gratuitous` (no line on the buyer's document, internal art. 7 ust. 2 record), `zero-line` (0.00 line or list price with a 100% rebate on the buyer's document).
- The document provider declares its device limits: per-line rebate, zero line, zero-value rate group (r3/code/A-capability-design.md `LineRebateSupport`).
- The gift line carries list price, its own VAT rate, purchase cost and the qualifying lines (r5/8-tax-fiscal.md section 5).

**Main flow**

1. The mapper reads the treatment and the provider's declared limits.
2. priced-in: a pure allocator splits the paid total proportionally by list price over the paid lines and the gift, never above the gift's own list price, remainder never leaving a rate bucket at 0.00; every line is a normal positive line at its own rate (r5/8-tax-fiscal.md A1, section 4; KIS 2015/2016 S7/S8; BFH XI R 19/23).
3. symbolic: the gift line is priced at one minor unit at its own rate (two 2026 KIS rulings accept 1 grosz as the base, r5/8-tax-fiscal.md S9; eparagony accepts it, probe d1).
4. gratuitous: the gift is left off the buyer's invoice and receipt and goes to the internal record of G-19.
5. zero-line: the gift is printed at 0.00 or at list price with a 100% line rebate (eparagony `rebatesMarkups` or `REBATE` with `taxRate`; KSeF `P_10`), only where the provider declares it and the gift's rate has positive paid value on the same document.
6. Any combination the provider cannot render is held with a named reason; nothing is guessed (ADR-041, r3/code/A-capability-design.md).

**Alternative flows and exceptions**

- zero-line is the highest-risk treatment: KIS 0114-KDIP1-1.4012.876.2025.2.IZ (23.01.2026) classed exactly this shape (0 zl / 100% rebate, 'gratisy beda dokumentowane ... jako produkty z rabatem 100%') as a free supply under art. 7 ust. 2, taxed on purchase price at the gift's own rate and not documented by an invoice (r5/8-tax-fiscal.md C-033, Headline). Offer it only behind an explicit adviser acknowledgement.
- Omitting the gift or moving its value onto a paid line without the gratuitous treatment: harmless when the gift shares the paid line's rate, over-declares when the gift's rate is lower, under-declares when it is higher. When rates differ the document is refused with a named reason (r5/8-tax-fiscal.md section 'The proposed rule, tested' (2), A3; verify/eparagony-gift-forms.md test 2).
- A document-level `REBATE` without `taxRate` spreads proportionally across rates; that is right only for a priced-in gift and the merchant cannot choose the split (C-029 disputed in r5/8-tax-fiscal.md). Use rate-scoped `REBATE` lines.
- Do `P_10` in KSeF for ordinary discounts only; gifts use allocated prices (r5/8-tax-fiscal.md A5).
- Italy taxes a contractual free good at a higher rate than the goods sold and renders it as full value plus a negative line; country rules live in config or adapters, never core (r5/3-marketplaces-countries.md A2, A6; r5/8-tax-fiscal.md C-036).

**What each channel sends**

- all: Document providers, not channels: eparagony `lines[].rebatesMarkups`, `REBATE` with `taxRate` A-G, zero-bucket refusal errorCode 41 (verify/eparagony-gift-forms.md, r5/8-tax-fiscal.md C-028); KSeF FA(3) `P_9A`/`P_11` may be 0, `P_10` exists but OL never emits it (C-037); Subiekt rebate pair only on the ZK order path (C-038). Receipt content: Dz.U. 2025 poz. 845 par. 26 for kasy with copy, Dz.U. 2024 poz. 1654 par. 22 for on-line kasy (r5/8-tax-fiscal.md C-031).

**OpenLinker behaviour**

Setting decides the treatment; core owns one pure allocator for priced-in and symbolic (beside `reconcileDiscountRounding`); providers declare device limits. r5/6 argues the limits should be a required method on `InvoicingPort` and `FiscalizationPort`, not an optional guard-only capability, because absence must not license silent omission (r5/6-design-and-code.md 3.6, section 4). The treatment names are neutral; no national vocabulary enters core (r5/8-tax-fiscal.md A2). Until an operator chooses, the default is today's behaviour plus the G-18 guards; a tax treatment is never a core default (verify/standard-stress-test.md B, ADR-063, ADR-026).

**Acceptance criteria**

- Given treatment priced-in, paid A 100.00 at 23% (list 100) and a gift at 8% with list 25.00, when a receipt is issued, then A prints 80.00 at 23%, the gift prints 20.00 at 8%, the total is 100.00 and no line exceeds its list price.
- Given treatment symbolic and a gift at 8% with a paid line at 23%, when a receipt is issued, then the gift prints at 0.01 at 8% and the paid line is reduced by 0.01 so the total equals what the buyer paid.
- Given treatment gratuitous, when an invoice is issued, then the invoice has no gift line and the gift appears in the G-19 record with purchase cost and its own rate.
- Given no gratuitous treatment and a gift whose rate differs from every paid line, when the mapper would omit or merge it, then the document is held with a named reason and no request reaches the provider.

**Evidence**

- r5/8-tax-fiscal.md Headline, C-028, C-029, C-031, C-033, C-037, 'The proposed rule, tested', A1-A6
- r4/phase1/4-marketplaces-and-law.md 2.1-2.4 and section 3
- verify/eparagony-gift-forms.md
- C-028
- C-029 (disputed)
- C-031 (refuted as cited)
- C-032
- C-035
- C-037
- C-038
- C-042
- C-021
- r5/6-design-and-code.md 3.6, 3.7, section 4
- r5/3-marketplaces-countries.md A2, A6
- verify/standard-stress-test.md B

**Risks**

- Whether a proportionally allocated gift price is a real price or an artificial split under art. 29a is unresolved (r5/8-tax-fiscal.md conflicts).
- priced-in changes what operators and buyers see (the gift is no longer '0 zl') and needs a list price for every gift (r5/8-tax-fiscal.md A1).
- ADR-082 decision 7 says a receipt never carries a zero line (docs/architecture/adrs/082-delivery-line-on-sales-documents.md:21), which argues against zero-line on receipts.
- Novitus kills a product name whose rate goes down then up; gift names must keep one rate (verify/eparagony-gift-forms.md header).
- Comarch Optima refuses 0 lines (C-032); a symbolic or allocated price travels further (r5/8-tax-fiscal.md C-032).

## G-11 Gift and returns

**Priority:** later. The legal answer is unknown (r4/phase1/5-merchant-voice.md open question 1) and no competitor automates it (r5/4-competitors-pl.md G-11 rows).

**Confidence:** disputed. **Mechanism:** core.

**Actor:** Operator

**Trigger:** A return of goods that qualified for a gift, with the gift kept or returned.

**Preconditions**

- The gift is a line with a declared list value and qualifyingLineIds.

**Main flow**

1. The return resolves to channel lines as today.
2. The refund proposal shows the gift's declared value, the qualifying lines and whether the gift came back.
3. The operator decides any deduction; OL never deducts automatically.
4. A returned gift is restocked like any line.

**Alternative flows and exceptions**

- Allegro returns are keyed by offerId and quantity (C-010); an OL-added gift has no offerId and never appears in a channel return, so its custody is recorded in OL only.
- Withdrawal vs complaint: Allegro moderators say the gift must come back on withdrawal only if the offer said so (r4/phase1/5-merchant-voice.md PAIN-16); buyers argue otherwise.
- Partial return drops the order below the threshold (Allegro multipack thread, r4/phase1/5-merchant-voice.md PAIN-17 area).

**What each channel sends**

- allegro: Returns: `CustomerReturnItem{offerId, quantity, ...}`, no gift concept (r4/phase1/1-allegro.md, C-010).
- erli: Returns by positional item index with quantity (r4/phase1/4-marketplaces-and-law.md 1.1).
- kaufland: Returns per order unit, refund amount per unit (r4/phase1/4-marketplaces-and-law.md 1.4).

**OpenLinker behaviour**

Core (returns and refund proposal) reading the adjustment links. No adapter change.

**Acceptance criteria**

- Given an order with a paid line and a rule gift, the buyer returns the paid line only, when the refund proposal is built, then it shows the gift's declared value as a possible deduction and proposes none by default.
- Given an Allegro return of the paid offer on an order with an OL-added gift, when the return is ingested, then the return names only the channel line and the gift's custody is recorded separately in OL.

**Evidence**

- C-010
- C-064
- C-065
- r4/phase1/5-merchant-voice.md PAIN-16 and open question 1
- r3/phase1/5-merchant-voice.md PAIN-10
- r5/4-competitors-pl.md G-11 rows
- r5/5-competitors-global.md G-11 row

**Risks**

- Any automatic deduction may be unlawful for a non-conformity claim.

## G-12 Gift reporting and small-gift records

**Priority:** later. Needs gift lines and a treatment first; no merchant asked for a gift-cost report (r3/phase1/5-merchant-voice.md PAIN-18).

**Confidence:** confirmed. **Mechanism:** core.

**Actor:** Operator, accountant

**Trigger:** A report or export is requested for gifts given in a period, campaign or rule.

**Preconditions**

- Gifts are lines with adjustments (not notes).
- A purchase cost exists for the gift variant (ADR-080 `netUnitCost` / `unitCostNet` snapshot).

**Main flow**

1. OL lists gift lines per rule, campaign or operator with quantity, list value, purchase cost at transfer date, rate, recipient key and date.
2. OL exports per-recipient yearly totals of purchase cost; thresholds are not in core.
3. A country policy (operator config) applies thresholds; for Poland the small-gift exclusion is 20 zl net purchase cost per unit without a register (since 1.01.2021, SLIM VAT) or 100 zl net per person per year with a register (art. 7 ust. 3-4, Dz.U. 2026 poz. 1263; r5/8-tax-fiscal.md C-034).
4. The exclusion only matters for gifts with the gratuitous treatment; a priced-in gift is a paid supply (r5/8-tax-fiscal.md C-034 precision b).

**Alternative flows and exceptions**

- Cost missing: the gift reads 'cost unknown', never 'under 20 zl' (r5/8-tax-fiscal.md A4); a line ingested without cost stays no-cost (#3588, r5/7-scope-overengineering.md section 7).
- Allegro buyer email is a per-transaction alias, so the recipient key must be the resolved customer, not the email (r5/1-allegro-pl.md C-067 row).
- `OL_STORE_PII=false` (hash-only): a named per-person register conflicts with it and needs a design decision (r5/8-tax-fiscal.md section 5).

**What each channel sends**

- all: None.

**OpenLinker behaviour**

Core read model over adjustments and the existing cost snapshot, keyed on cost not list price; thresholds in operator config or a country pack (r5/3-marketplaces-countries.md A5, r5/8-tax-fiscal.md A4).

**Acceptance criteria**

- Given three gratuitous gifts with purchase cost 12.00 net each for one customer in 2026, when the gift report is run, then it shows three gifts, the customer's yearly total of 36.00 net cost, and the treatment of each.
- Given a gift variant without a recorded cost, when the report is run, then the gift shows 'cost unknown' and is not counted as under any threshold.

**Evidence**

- r5/8-tax-fiscal.md C-034, A4, section 5
- r4/phase1/4-marketplaces-and-law.md 2.1 and section 3
- C-034 (resolved: 20 zl since 2021, on purchase cost)
- r5/3-marketplaces-countries.md A5
- r5/7-scope-overengineering.md section 7 point 8
- r3/code/B-order-lines-and-documents.md line 243
- r5/4-competitors-pl.md G-12 rows

**Risks**

- Cost carry-forward keyed productId|variantId collides when a gift and a paid line share a variant (r3/code/B-order-lines-and-documents.md line 243).
- A per-person register stores PII that hash-only installs refuse to keep.

## G-13 Buyer chooses the gift

**Priority:** out. A chosen gift already arrives as a line where a channel supports choice, and Allegro offers no structured field, so there is nothing separate to build.

**Confidence:** unverified. **Mechanism:** process.

**Actor:** Buyer (in the channel), operator

**Trigger:** The buyer states which gift they want.

**Preconditions**

- The channel offers a choice.

**Main flow**

1. A shop that offers the choice in the basket sends the chosen gift as a line (IdoSell, r4/phase1/3-pl-saas-and-erp.md 2.5); G-01 handles it.
2. On Allegro the only route is `messageToSeller`; the operator reads it and adds the gift via G-05.

**Alternative flows and exceptions**

- No structured gift choice on Allegro; moderators forwarded the idea in 2025 (r4/phase1/5-merchant-voice.md PAIN-19).

**What each channel sends**

- allegro: `messageToSeller` can be required in some categories (`MessageToSellerSettings`); use for gifts unverified (r5/1-allegro-pl.md point 9).
- idosell: Basket choice; arrives as a gift line (r4/phase1/3-pl-saas-and-erp.md line 141).

**OpenLinker behaviour**

Nothing new; covered by G-01 and G-05.

**Acceptance criteria**

- Given an IdoSell order where the buyer chose gift Y, when the order is ingested, then Y arrives as an ordinary flagged gift line (G-01).
- Given an Allegro order whose buyer names a gift in `messageToSeller`, when the operator reads it, then the gift is added through G-05 and no separate choice feature is involved.

**Evidence**

- r4/phase1/3-pl-saas-and-erp.md 2.5
- r5/1-allegro-pl.md point 9
- r4/phase1/5-merchant-voice.md PAIN-19
- r4/phase2/3-sellasist.md G-13

**Risks**

- Free-text choices in messages are missed without a packer-visible note.

## G-14 Gift wrap and 'is a gift' order (not a free item)

**Priority:** pilot. Allegro and PrestaShop are pilot channels and by code reading a paid wrap charge falls outside the lines, which either blocks or misstates the document; one live order per channel should confirm before building.

**Confidence:** probable. **Mechanism:** field.

**Actor:** System (ingestion), packer

**Trigger:** An order carries a paid gift-wrap service or an 'is a gift' flag with a message.

**Preconditions**

- The adapter reads the service or flag.

**Main flow**

1. Allegro: the adapter maps `selectedAdditionalServices[{definitionId: GIFT_WRAP, price (per unit), quantity}]` to a service charge (price x quantity) so lines plus charges reconcile to `summary.totalToPay` (verify/allegro-line-price.md Q1 arithmetic 76.00 x 2 + 10.00 x 2 + 15.87 = 187.87).
2. PrestaShop: `orders.gift`, `gift_message` and the order-level `total_wrapping_tax_incl` / `_tax_excl` are mapped to a packing instruction plus a service charge (verify/prestashop-live.md Q6).
3. Amazon `IsGift` / `giftOption`: packing instruction and message only, never a free item.
4. The bench shows the wrap instruction and message; documents carry the paid service.

**Alternative flows and exceptions**

- Today the Allegro wire type does not declare `selectedAdditionalServices`; the wrap money surfaces only as a shipping fallback (when `delivery.cost` is absent) or as a negative gap that `discountTotal` ignores (verify/allegro-line-price.md code section, r5/1-allegro-pl.md point 6). Code reading; not tested on a live order.
- PrestaShop: the OL mapper reads `total_paid_tax_incl` and `total_shipping_tax_incl` but no wrapping field is listed among what it reads (r4/code/B-line-identity-traced.md section 3), so the wrap charge is probably outside the lines too (inference, unverified).

**What each channel sends**

- allegro: `selectedAdditionalServices[{definitionId: GIFT_WRAP, name: 'Zapakuj na prezent', price (unit), quantity}]` (r4/phase1/1-allegro.md ALG-09, verify/allegro-line-price.md Q1).
- prestashop: `orders.gift = 1`, `gift_message`, `total_wrapping`, `total_wrapping_tax_incl`, `total_wrapping_tax_excl`; no line created (verify/prestashop-live.md Q6).
- amazon: `IsGift`, `BuyerInfo.GiftWrapPrice`, `GiftMessageText` (v0); `giftOption` (2026-01-01) = wrap and message (C-026, r4/phase1/4-marketplaces-and-law.md 1.2-1.3).

**OpenLinker behaviour**

Adapter fields: a neutral order charge (service) and a packing instruction. Core documents render the charge like delivery (ADR-082 shape). No capability.

**Acceptance criteria**

- Given an Allegro order with one 50.00 item and GIFT_WRAP 10.00 x 1, when a receipt is issued, then the receipt totals 60.00 and shows the wrap service.
- Given a PrestaShop order with `gift=1`, a message and `total_wrapping_tax_incl` 2.46, when the order is ingested and the packer opens the parcel, then the order carries a 2.46 service charge, the packer sees the wrap instruction and message, and no free item is created.

**Evidence**

- C-026
- C-002
- verify/allegro-line-price.md Q1 and code section
- verify/prestashop-live.md Q6
- r4/phase1/1-allegro.md ALG-09
- r5/1-allegro-pl.md C-002 row and point 6
- r4/code/B-line-identity-traced.md section 3
- r4/phase1/4-marketplaces-and-law.md 1.2-1.3

**Risks**

- The wrap service's VAT rate is not on the Allegro payload; rate resolution for a service charge is undefined (PrestaShop has `PS_GIFT_WRAPPING_TAX_RULES_GROUP`, verify/prestashop-live.md Q6).
- Not live-tested on OL; the defect may surface as a blocked document (C-030) rather than a wrong one.

## G-15 Per-customer gift limit across repeat orders

**Priority:** later. The only evidence is Shopify community posts and it does not apply to Allegro, the pilot channel (r5/1-allegro-pl.md C-067 row).

**Confidence:** unverified. **Mechanism:** core.

**Actor:** System (rule)

**Trigger:** A rule with a 'once per customer' limit evaluates a qualifying order.

**Preconditions**

- G-06 exists.
- A stable customer key exists.

**Main flow**

1. The rule looks up earlier gifts of the same rule for the resolved customer.
2. If the limit is reached the gift is not added and the order shows why.

**Alternative flows and exceptions**

- Allegro: the email is a per-transaction alias, so an email-keyed limit is meaningless there (r5/1-allegro-pl.md C-067 row).
- Shops: match on phone or tax id as well as email, as Sellasist's customer-data condition does (r5/4-competitors-pl.md line 94).

**What each channel sends**

- all: Customer identity only; see Customers context (identity modes).

**OpenLinker behaviour**

Core rule condition over the customer projection.

**Acceptance criteria**

- Given a once-per-customer rule and a customer who already got the gift, when they order again with a new email but the same phone, then no gift is added and the order states the limit.
- Given an Allegro order whose buyer email is a per-transaction alias, when the limit is evaluated, then the lookup uses the resolved customer, never the alias email.

**Evidence**

- C-067
- r5/1-allegro-pl.md C-067 row
- r3/phase1/5-merchant-voice.md PAIN-09
- r5/4-competitors-pl.md line 94

**Risks**

- Over-matching (shared family phone) refuses legitimate gifts.

## G-16 A gift rule that fails is visible and does not stall the order

**Priority:** later. Ships with G-06; nothing to fail before rules can add gifts.

**Confidence:** probable. **Mechanism:** core.

**Actor:** System (automation), operator

**Trigger:** A gift rule throws, or its gift cannot be added.

**Preconditions**

- G-06 exists.

**Main flow**

1. The failure is recorded per firing with the rule, order and reason.
2. The order continues to reservation and routing without the gift.
3. An attention entry lets the operator retry or add the gift by hand.

**Alternative flows and exceptions**

- The order was never ready when T9 would have fired (N-1): the firing is recorded as missed, not silently skipped.

**What each channel sends**

- all: None.

**OpenLinker behaviour**

Core automation run log plus an attention reason (prior art: Sellasist failed-action log with manual retry, r5/4-competitors-pl.md line 92).

**Acceptance criteria**

- Given a gift rule whose gift variant was deleted, when a qualifying order arrives, then the order is reserved and routed without the gift and carries an attention entry naming the rule.
- Given a failed gift firing, when the operator retries it before packing, then the gift is added once and the attention entry clears.

**Evidence**

- r5/4-competitors-pl.md line 92
- r5/6-design-and-code.md N-1
- r4/phase1/5-merchant-voice.md PAIN-14

**Risks**

- Retry after packing must not add a gift to a closed parcel.

## G-17 NEW Rounding and delivery remainders must not land on a zero-priced gift line

**Priority:** stage0. A live wrong document on the pilot stack today (a free item printed at 0.01), fixed in a few lines (r5/7-scope-overengineering.md D5 and section 6).

**Confidence:** confirmed. **Mechanism:** core.

**Actor:** System (sales-document mappers)

**Trigger:** A receipt or invoice is built for an order with a 0.00 line and either a discount rounding gap or a delivery spread remainder.

**Preconditions**

- The order has at least one line whose paid gross is 0.

**Main flow**

1. `reconcileDiscountRounding` picks the first quantity-1 goods line whose paid gross is greater than 0 (today it accepts a 0.00 line when the gap is positive, `discount-rounding.types.ts:65-67`).
2. `spreadDeliveryAcrossLines` picks the largest paid quantity-1 line and never a 0.00 line (today a gift that is the only quantity-1 line gets the remainder, `delivery-line.types.ts:581-587`).
3. If no paid candidate exists, the document is held with a named reason instead of putting the cent on the free line.

**Alternative flows and exceptions**

- The stray cent today accidentally keeps eparagony from refusing a zero rate bucket; removing it without G-18 turns a wrong receipt into a blocked one (r5/6-design-and-code.md C-056 row). Ship together with G-18.

**What each channel sends**

- all: Any channel that sends a 0.00 line (WooCommerce, GIFTiT, Shoper apps) or any OL-added gift.

**OpenLinker behaviour**

Core pure functions in sales-documents; about ten lines plus tests (r5/7-scope-overengineering.md section 5).

**Acceptance criteria**

- Given paid line A 10.00 quantity 2, gift G 0.00 quantity 1 listed first, and a discount with a positive 1-grosz rounding gap, when a receipt is built, then G stays 0.00 and the grosz lands on A.
- Given delivery spread mode where G is the only quantity-1 line, when a receipt is built, then the remainder does not land on G.
- Given an order whose only quantity-1 lines are 0.00 and a remainder exists, when a document is built, then the document is held with a named reason.

**Evidence**

- C-056
- verify/standard-stress-test.md C (stage 0)
- r4/code/B-line-identity-traced.md H5
- r5/6-design-and-code.md C-056 row
- r5/7-scope-overengineering.md D5, sections 5 and 6

**Risks**

- Narrower than first stated: only when the gift is the first quantity-1 line with a positive gap, or the only quantity-1 line in spread mode (r5/6-design-and-code.md C-056 row).
- Without G-18 the fix exposes errorCode 41.

## G-18 NEW A zero-value gift on a fiscal receipt: never send a zero VAT bucket, refuse cross-rate omission with a named reason

**Priority:** stage0. The pilot fiscal provider today refuses a receipt with a cross-rate gift behind an opaque error (C-028 live, r5/7-scope-overengineering.md D6); a named reason and a harmless same-rate omission are a few lines.

**Confidence:** confirmed. **Mechanism:** core.

**Actor:** System (receipt mapper and eparagony adapter), operator

**Trigger:** A receipt is built for an order containing a goods line whose paid value is 0, or a rebate that would zero a VAT rate.

**Preconditions**

- The fiscal provider is eparagony (pilot) or another receipt adapter.
- No gift treatment setting exists yet (G-10 is later).

**Main flow**

1. The mapper computes the paid value per VAT rate after rebates.
2. A zero-value line that shares its rate with a positive paid line is left off the receipt and the order timeline records it. The tax effect is the same as printing it (r5/8-tax-fiscal.md 'The proposed rule, tested' (2): same rate is harmless); omission matches ADR-082 decision 7 ('A receipt never carries a zero line', docs/architecture/adrs/082-delivery-line-on-sales-documents.md:21) and art. 7 ust. 2 supplies are exempt from the kasa (Dz.U. 2024 poz. 1902 zal. poz. 46, r5/8-tax-fiscal.md C-033).
3. A zero-value line alone in its rate (no paid line at that rate) is not omitted and not sent: the receipt is held with a named, operator-readable reason ('gift in a different VAT rate than the paid goods: choose how to document it'), because omission would over- or under-declare VAT (r5/8-tax-fiscal.md section (2) and A3).
4. Before calling eparagony the adapter refuses any payload in which a VAT rate's value after rebates is <= 0, so the raw HTTP 400 errorCode 41 never reaches the operator (verify/eparagony-gift-forms.md, r5/8-tax-fiscal.md C-028).
5. Basket discounts are sent only as `REBATE` lines carrying `taxRate` (verify/eparagony-gift-forms.md test 4).

**Alternative flows and exceptions**

- Never 'move value' onto the gift (verify/eparagony-gift-forms.md test 2) and never leave 0.01 in the gift's rate as a side effect (test 3b): accepted by eparagony but they misstate VAT or the total. A deliberate 1-grosz gift line is the G-10 `symbolic` treatment, not this case.
- Held receipt: the operator can issue it after choosing a treatment (G-10 later) or by hand; during the pilot this is no worse than today, where eparagony refuses the same receipt (C-028).
- Other receipt providers: zero-line behaviour unverified; Comarch Optima refuses 0 lines (C-032).
- Invoices are out of this case: KSeF `P_11` may be 0 (r5/8-tax-fiscal.md C-037); see G-10.

**What each channel sends**

- all: Document provider eparagony: refuses a VAT letter whose sales total would be 0.00 with HTTP 400 errorCode 41 'Incorrectly calculated value of eReceipt.lines[n]'; accepts a 0.00 line or 100% line rebate when a positive line shares its letter (probes a1, b1, a8, b8; verify/eparagony-gift-forms.md tests 1-5; r5/8-tax-fiscal.md C-028). This is provider behaviour, not law: Dz.U. 2024 poz. 1654 par. 35 pkt 3 bans only a negative per-rate value (r5/8-tax-fiscal.md C-028).

**OpenLinker behaviour**

Core receipt mapper rule plus a new named block reason (one more `SalesDocumentBlockOutcome` value, r5/8-tax-fiscal.md A3), and an adapter pre-call guard in the eparagony package (ADR-082 decision 9 shape). No new capability for stage0.

**Acceptance criteria**

- Given paid A 10.00 at 23% and a 0.00 gift also at 23%, when an eparagony receipt is issued, then the receipt carries only A, totals 10.00, and the order timeline says the gift was not printed.
- Given paid A 10.00 at 23% and a 0.00 gift at 8%, when a receipt is requested, then no request is sent to eparagony and the receipt is held with the named cross-rate reason.
- Given any payload where one VAT rate nets to 0 after rebates, when the adapter is about to call eparagony, then no request is sent and the operator sees a readable reason instead of errorCode 41.

**Evidence**

- C-028
- C-029
- verify/eparagony-gift-forms.md
- r5/8-tax-fiscal.md C-028, C-031, C-033, 'The proposed rule, tested' (2), A3
- r5/7-scope-overengineering.md D6, sections 5 and 6
- verify/standard-stress-test.md C (stage 0), D5
- docs/architecture/adrs/082-delivery-line-on-sales-documents.md:21

**Risks**

- Same-rate omission is tax-neutral, but if the merchant's facts look like KIS 2026 and the gift costs more than 20 zl, VAT on the gift itself may still be due under art. 7 ust. 2; omission does not cure that (r5/8-tax-fiscal.md section (2)); see G-19.
- Held cross-rate receipts need an operator path until G-10 exists.
- The stress test (written before r5/8) calls omission the only safe receipt option (verify/standard-stress-test.md D5); r5/8 narrows that to same-rate gifts or a declared gratuitous treatment, which is why cross-rate omission is refused here.
- ADR-082 decision 7 is written for delivery lines; applying it to goods lines is a reading (r5/6-design-and-code.md section 4).

## G-19 NEW Gratuitous gift recorded outside the buyer's documents (art. 7 ust. 2 record)

**Priority:** later. Depends on the G-10 treatment choice and a tax adviser; individual rulings bind only the applicant and conflict (r5/8-tax-fiscal.md conflicts).

**Confidence:** disputed. **Mechanism:** setting.

**Actor:** Accountant, operator

**Trigger:** A gift has the gratuitous treatment (G-10), for example a merchant who follows KIS 2026 or a discretionary apology gift.

**Preconditions**

- Gift lines carry list price, purchase cost at transfer date, own VAT rate, recipient and date (G-12).

**Main flow**

1. The gift is not printed on the buyer's invoice or receipt: KIS 2026 says art. 7 ust. 2 supplies are not documented by an invoice, and they are exempt from the kasa (Dz.U. 2024 poz. 1902 zal. poz. 46, until 31.12.2027) (r5/8-tax-fiscal.md C-033).
2. OL produces an internal record per gift: base = purchase price or production cost at transfer (art. 29a ust. 2), the gift's own VAT rate, recipient key, date, promotion id and terms version, treatment and who chose it (r5/8-tax-fiscal.md section 5).
3. The small-gift exclusion (20 zl purchase cost per unit, or 100 zl yearly with a register) is applied by the operator's country policy, outside core (G-12).
4. The record is exported for the accounting system or JPK; OL computes no tax.

**Alternative flows and exceptions**

- The operator chooses priced-in or symbolic instead: no record; the gift is a paid supply on the documents (G-10).
- Italy routes own-stock free goods to a self-invoice (TD27) and excludes contractual sconto merce unless the gift's rate is higher (r5/3-marketplaces-countries.md A6, r4/phase1/4-marketplaces-and-law.md 2.7).

**What each channel sends**

- all: None.

**OpenLinker behaviour**

Core export over adjustments and cost snapshots; the treatment is operator config, the thresholds a country pack (r5/3-marketplaces-countries.md A5, r5/8-tax-fiscal.md A2).

**Acceptance criteria**

- Given a gratuitous gift with purchase cost 12.00 net at 8%, when the internal record export runs, then it lists the gift with base 12.00, rate 8%, the recipient key and the promotion.
- Given a gratuitous gift, when the buyer's receipt and invoice are issued, then neither carries the gift line.

**Evidence**

- r5/8-tax-fiscal.md C-033, C-034, section 5
- r4/phase1/4-marketplaces-and-law.md 2.1, 2.4(a)(b), 2.7, section 3
- r5/3-marketplaces-countries.md A5, A6
- C-033

**Risks**

- KIS 2026 vs KIS 2015/2016 reach opposite results on similar facts; no court ruling found (r5/8-tax-fiscal.md conflicts).
- Gratuitous gifts above 20 zl cost create output VAT with no revenue; the merchant must see that cost (r5/8-tax-fiscal.md section (2)).

## G-20 NEW Interim pilot gift process: packer note plus manual stock correction

**Priority:** stage0. Zero code and it prevents the pilot's missed-packing risk for description-only gifts (r5/7-scope-overengineering.md D7, section 6 item 4).

**Confidence:** confirmed. **Mechanism:** process.

**Actor:** Operator, packer

**Trigger:** During the pilot an order needs a gift that is not on the order.

**Preconditions**

- Order notes with `showToPacker` and manual stock correction (#3566) are available.

**Main flow**

1. The operator adds an order note naming the gift with `showToPacker` on.
2. The packer sees it in `BenchParcelView.packerNotes` and puts the gift in the parcel.
3. The operator records a manual stock correction for the gift SKU with a reason.
4. The process is written down for the pilot client.

**Alternative flows and exceptions**

- Correction forgotten: gift stock drifts until the next master sync or count.

**What each channel sends**

- all: None.

**OpenLinker behaviour**

No code; uses shipped notes and manual correction (docs/architecture-overview.md: order notes `showToPacker`, manual stock correction #3566).

**Acceptance criteria**

- Given an order note with `showToPacker`, when the packer opens the parcel, then the note is visible.
- Given a manual correction of -1 on the gift SKU, when the movement history is read, then it shows a manual_correction row with the operator's reason.

**Evidence**

- r5/7-scope-overengineering.md D7, sections 5, 6 and 7
- verify/standard-stress-test.md C (cheapest safe pilot)
- C-008
- C-065

**Risks**

- No structured gift history; G-12 starts empty (r5/7-scope-overengineering.md section 7 point 8).
- Notes are free text; a later G-05 imports nothing from them.

## G-21 NEW OpenLinker-added gift lines are skipped by channel writebacks

**Priority:** later. Only reachable once OL can add lines (G-05/G-06).

**Confidence:** probable. **Mechanism:** core.

**Actor:** System (writebacks)

**Trigger:** Any writeback that names order lines runs for an order with an OL-added line (waybill relay, refunds, returns, commission refund).

**Preconditions**

- G-05 or G-06 added a line that the channel does not know.

**Main flow**

1. Writebacks build their line list from the channel snapshot only.
2. OL-added lines are filtered out before any call.
3. The OL-added line's shipment and return are tracked in OL only.

**Alternative flows and exceptions**

- Destination mirror (a PrestaShop order created by OL): whether the gift is sent as a 0.00 line is a destination question, unverified; under OMS routing the sale decrement lowers its stock instead.
- Allegro waybill without `lineItems` means 'every item' (C-009), so omission is safe.

**What each channel sends**

- allegro: Waybill `lineItems[]{id}` only (C-009); returns by offerId (C-010); `RefundClaimRequest` by `lineItem.id` (r5/1-allegro-pl.md C-010 row).

**OpenLinker behaviour**

Core filter in three writebacks reading `channelSnapshot` (the #3542 split already forces this distinction).

**Acceptance criteria**

- Given an Allegro order with one channel line and one OL-added gift, when the waybill is relayed, then the request names only the channel line id and succeeds.
- Given a buyer return on Allegro for an order with an OL-added gift, when a refund is written back, then no OL-only line id is sent to Allegro.

**Evidence**

- r5/1-allegro-pl.md F
- C-009
- C-010
- r5/6-design-and-code.md section 4 (#3542 invariant)

**Risks**

- A writeback that reads effective lines would send an id the channel rejects (loud, not silent).

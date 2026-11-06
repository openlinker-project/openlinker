# R5 red team 3: non-Allegro marketplaces and country-agnostic claims

Date: 2026-11-04. Area: C-023..C-027, C-035, C-036, the proposed typed reason "discount-in-goods vs gift" (K-02, G-10 in `r2/use-cases-v2.md:37`) and the principle "no amounts / thresholds in core".
Method: re-checked every claim against primary specs (Erli swagger re-downloaded live today, Amazon SP-API models + Amazon migration guide, Kaufland swagger + Kaufland orders page, Mirakl OAS, eBay Fulfillment OAS, Allegro swagger), the VAT Directive text, the BFH ruling text, and the new Italian VAT code. Not legal advice.

Source kinds: [P] primary spec / statute / court text, [O] official vendor doc page, [S] secondary (commentary, law-firm note), [C] OpenLinker code.

---

## 1. Verdicts

| ID | Claim (short) | Verdict | Key evidence |
|---|---|---|---|
| C-023 | Erli: product-level `productSets`; `unitPriceBeforeRebate` typed in OL, never read; EUR / market de | **Confirmed, and worse than stated** | swagger + CHANGELOG + `erli-order.mapper.ts:207-238` |
| C-024 | Mirakl (Empik) is the only marketplace declaring free units (`offered_quantity`, FREE_ITEMS) | **Probable** (true for the 6 specs read; Empik enablement Unknown) | Mirakl OAS OR11 |
| C-025 | Kaufland sends one `order_unit` per piece | **Confirmed** | Kaufland orders page + swagger |
| C-026 | Amazon `IsGift` = gift wrap/message, not a free item | **Confirmed** (by the migration guide, not by the v0 field text) | Amazon migration guide |
| C-027 | No marketplace sends bundle composition on the order | **Refuted as worded** (Allegro does); true for Erli, Amazon, Kaufland, Mirakl, eBay | Allegro swagger `OfferProductSetReference` |
| C-035 | BFH XI R 19/23: split by individual selling prices, never above a component's own price | **Probable, overstated** | BFH 22.01.2025 text (via omnilex) |
| C-036 | Italy: sconto merce outside VAT base vs omaggio separate regime | **Confirmed with 3 corrections** (new legal basis from 2027; conditional exclusion; receipt rendering) | TU IVA art. 29 c.1 lett. b; ecnews on circ. 3/E/2022 |
| K-02 / G-10 | A two-value typed reason (discount-in-goods vs gift) is enough per country | **Disputed** - misses at least 3 EU cases | VAT Directive Art. 73, 79, 16, 30a |
| principle | No amounts / thresholds in core | **Confirmed as a rule, incomplete as a design** - core must still store the facts thresholds are computed from | Erli EUR orders; IT/PL/UK thresholds are on cost and per recipient |

---

## 2. Claim by claim

### C-023 Erli - confirmed, plus three defects the claim missed

Evidence:
- [P] Erli swagger, re-downloaded live today from `https://erli.pl/svc/shop-api/doc/swagger.json`; identical to the R2 copy except example timestamps. `ProductCreate.productSets`: `{"items":[{"metaProductId":int,"quantity":int}]}`, `externalProductSets`: `{"externalMetaProductId":string,"quantity":int}`. No description strings, so semantics stay Unknown.
- [P] `Order.items[]` properties: `id, externalId, quantity, weight, unitPrice, unitPriceBeforeRebate, name, slug, ean, sku, taxRate, dispatchTime`. No component list. `Order.currency`: `{"enum":["PLN","EUR"],"description":"Waluta zamówienia"}`; `Order.market`: `{"enum":["pl","de"],"description":"Market zamówienia"}`.
- [P] Erli CHANGELOG `https://erli.pl/svc/shop-api/doc/CHANGELOG.txt`: 2020-06-08 "dodanie pól "rebate" oraz "items.X.unitPriceBeforeRebate" w zamówieniu"; 2026-08-19 "dodanie pola `market` (`pl`, `de`) do obiektu Order ... pole było wysyłane od 2026-05-20"; same entry "zamówienia nie zawierają już nieudokumentowanych pól wewnętrznych (rebate.donorType, ...)".
- [P] CHANGELOG (latest block): "`taxRatesByMarket` ... (np. `{ "pl": ["TAX_23"], "de": ["TAX_19"] }`)".
- [C] `libs/integrations/erli/src/infrastructure/adapters/erli-order.mapper.ts:207` maps `price: toMajorUnits(item.unitPrice)` only; `:210` stamps `taxRateCountry: 'PL'` on every line; `:238` hardcodes `currency: 'PLN'`. `unitPriceBeforeRebate` appears only in `erli-order.types.ts:74`.

What the claim missed:
1. **EUR orders are booked as PLN today.** A `market: "de"` order of 50.00 EUR is ingested as 50.00 PLN (`erli-order.mapper.ts:238`). This is a live money defect, independent of bundles and gifts, and it also feeds invoices and analytics.
2. **German rates are labelled as Polish.** `erli-tax-rate.mapper.ts:23` says "Erli's `TAX_7` / `TAX_19` are historical PL rates". Poland never had a 19% VAT rate; Erli's own changelog shows `TAX_19` is the `de` market rate. The mapper then stamps `taxRateCountry: 'PL'` on a DE 19% line. Provenance is "only" provenance (`incoming-order.types.ts:221`), but any document or country policy reading it gets the wrong country.
3. **`unitPriceBeforeRebate` is not a list price.** It was added together with the order-level `rebate` (same changelog line, 2020-06-08). The seller's own timed discount (`POST /products/{externalId}/discount`) just lowers `unitPrice` with no before-price, and the strike-through price is the product field `cataloguePrice`, which is not on the order. So mapping `unitPriceBeforeRebate` to `commercial.listUnitPriceGross` (as the CHANNELS table and G-02/03 propose) is a semantic error: it is "price before the Erli rebate/coupon", and is absent for every other kind of reduction.
4. **Who funded the Erli rebate is no longer visible.** `rebate.donorType` was removed from orders on 2026-08-19. Erli runs a rebate reserve: `POST /billing/company/rebates` = "rezerwa i historia rabatów firmy", whose entries carry `rebateOrigin[{amount, rebateReason}]`. So whether a rebate reduced the seller's own price or was paid by Erli (third-party consideration, see section 3) can only be resolved from billing, not from the order. Rating: funder = Unknown on the order.

### C-024 Mirakl free units - probable

- [P] Mirakl MMP Seller OAS (R2 download, OR11): `offered_quantity` - "The quantity of free items offered by the promotion for this line. Only applicable when promotion is of type FREE_ITEMS, null otherwise." `apportioned` - "true when the promotion's reward amount is divided and allocated proportionally to multiple order lines", "false when the entire reward amount is allocated to one order line, or when the same discount percentage is applied to several order lines". `origin_unit_price` - "The original unit price of the offer associated with the order line".
- Negative checks on the other specs (grep for free/gift/bundle/promotion fields): Amazon v0 has `PromotionDiscount` ("The total of all promotional discounts in the offer"), `PromotionIds`; Amazon 2026 `ItemPromotionBreakdown` has only `promotionId`; eBay `AppliedPromotion` = `{description, discountAmount, promotionId}`; Kaufland `discounts[]` = `{usage_type, discount_value}`; Allegro `LineItemDiscount.type` enum `BUNDLE, UNIT_PERCENTAGE_DISCOUNT, WHOLESALE_PRICE_LIST, LARGE_ORDER_DISCOUNT, TURNOVER_DISCOUNT, COUPON, CAMPAIGN`. None declares free units. So "only" holds within these six.
- Qualifications: (a) it is a Mirakl platform feature, so it also covers other Mirakl marketplaces, not "Empik" specifically; (b) whether Empik lets sellers create FREE_ITEMS promotions is Unknown (searched; Empik's public pages describe Empik-run campaigns, not seller promotion setup); (c) whether `offered_quantity` is inside or outside the line `quantity` is Unknown (no sample order).

### C-025 Kaufland per piece - confirmed

- [O] `https://sellerapi.kaufland.com/?page=orders`: "Each order is composed of one or more order units, each corresponding to a unit." and "If the same unit gets ordered several times, several order units are created."
- [P] swagger `OrderUnit` has no quantity field. Extra detail R2 missed: `discounts[].usage_type` description "Currently possible values are "voucher" and "volume"" - `volume` is a quantity-tier discount, so a multibuy shows up per piece as a discount, never as a free unit.

### C-026 Amazon IsGift - confirmed, but only through the migration guide

- [P] v0 field text is ambiguous on its own: `IsGift` - "Indicates whether the item is a gift." That alone does not prove "wrap, not free".
- [O] Orders API migration guide `https://developer-docs.amazon/sp-api/docs/orders-api-migration-guide`: v0 `IsGift` maps to "`Order.orderItems[].fulfillment.packing.giftOption`". In the 2026 model `GiftOption` = "Gift wrapping and personalization options selected by the customer for an order item." That settles it: packing option, not a free item.
- Same guide, useful for design: `PromotionDiscount` maps to "`orderItems[].proceeds.breakdowns[].subtotal` with the filter `type == DISCOUNT`", while `PromotionIds` map to "`Order.orderItems[].promotion.breakdowns[].promotionId`" - id and amount live in two places, so a per-promotion amount is not recoverable with 2+ promotions on one item (R2 was right).

### C-027 bundle composition - refuted as worded

- [P] Allegro swagger (R2 copy, `r2/phase1/dl/swagger.yaml:30244-30270`): `OfferReference.productSet` -> `OfferProductSetReference`: "If the offer was a product set, you can see a list of component products (product id with quantity)." Allegro is a marketplace, so "no marketplace" is false, and the spike's own key finding 1 contradicts C-001.
- True for the rest: Erli (composition only on the product, `productSets`), Amazon (`AssociatedOrderItem.associationType` only `VALUE_ADD_SERVICE` / `WARRANTY`), Kaufland (no bundle field), Mirakl (none), eBay (`linkedOrderLineItems` = "line items related to the corresponding order, but not a part of that order").
- Why it matters: Allegro's composition is catalogue UUIDs + quantity, no price and no seller SKU, so OL still needs its own definition for price split and SKU mapping. But OL can use it as a **check**: if the channel-declared composition differs from the OL definition, hold the order instead of silently packing the OL definition. The current D3b only "maps channel SKU to OL bundle".
- Unverified extra shape: Amazon Virtual Product Bundles reportedly put each component ASIN on the order as a separate item with no group key (R1/R2, secondary only). If true, that is a fourth shape ("children only, ungrouped") that SKU recognition cannot detect at all.

### C-035 BFH XI R 19/23 - probable, overstated

- [P] BFH, judgment of 22.01.2025, XI R 19/23 (read via `https://app.omnilex.ai/de/sources/court-decision/de-rii--stre202520153/bfh-2025-01-22-xi-r-1923`; the tool only returns short quotes):
  - Facts: fast-food franchisee, "Spar-Menüs" of food (reduced rate) and drinks (standard rate) at one price.
  - Rz 30: "ein einheitlicher Gesamtpreis auf (mindestens) zwei Lieferungen aufgeteilt werden muss".
  - Rz 31-32: use the "einfachstmögliche" method; "Als einfachstmögliche Methode sieht der BFH dabei die Aufteilung nach Marktwerten beziehungsweise Einzelverkaufspreisen an".
  - Rz 36-38: exceptions not excluded; other methods (e.g. Wareneinsatz) only if equally simple and "zumindest ebenso sachgerecht".
  - Leitsatz (paraphrase by the tool): a method is not appropriate if it gives a product in a discounted set a share above its individual selling price. Rz 44: such a result "widerspricht der wirtschaftlichen und geschäftlichen Realität".
- Corrections to the claim:
  1. "Split by individual selling prices" is the **default**, not the only allowed method.
  2. "Never above a component's own price" is a **test that disqualifies a method**, not a free-standing rule.
  3. It applies only when the set is **several supplies**. A single composite supply takes one rate: ECJ C-463/16 Stadion Amsterdam (18.01.2018), as quoted by Simmons & Simmons [S]: "the supply must be taxed solely at the rate of VAT applying to the single supply" and "That is the case even if the price of each element within the full price paid by the customer can be identified." So "default to components when VAT rates differ" (D3c) is only right when the components are separate supplies (a book and an apron: yes; a phone with its charger: likely not).
- Design hit on D3a: an **operator-typed in-set price fixed at definition** can exceed the component's own selling price (Apilo/Sellasist let you type it), and it drifts as component prices change. BFH ties the split to selling prices at the time of supply. Minimum: validate in-set price <= current standalone price, and snapshot both at order time so a policy can re-split.

### C-036 Italy - confirmed, with three corrections

1. **Legal basis moves on 1 January 2027.** [P] Normattiva shows art. 15 DPR 633/72 as "ARTICOLO ABROGATO DAL D.LGS. 19 GENNAIO 2026, N. 10". The rule continues as Testo unico IVA art. 29 c.1 lett. b) (via `https://miolegale.it/testi-unici/iva/art-29/`, a consolidated-text site [S]): "il valore normale dei beni ceduti a titolo di sconto, premio o abbuono in conformità alle originarie condizioni contrattuali, tranne quelli la cui cessione è soggetta ad aliquota più elevata". Any doc/code comment citing "art. 15 DPR 633/72" is stale from 2027.
2. **The exclusion is conditional, and the condition is computable.** Two conditions: (a) promised in the original terms of the sale; (b) the free goods' rate is not higher than the goods sold. If the gift's rate is higher, its normal value is taxable. Core can supply both inputs only if it keeps, on the free line, the **list (normal) value and the tax rate**, and the **link to the qualifying paid lines**.
3. **Receipt rendering matches "list price + line rebate".** [S] ecnews.it, 14.03.2022, on Agenzia delle Entrate circ. 3/E/2022: on the documento commerciale the free item can appear as its own line at full value followed by a negative discount line; example "Bene C" 30,00 then "Bene C SCONTO" "Importo (-) 30,00". On an e-invoice the excluded value is reported with natura code N1 (same source). R2's mention of "N2" for omaggi is unverified; the sources found point to TD27 (self-invoice for free supplies "senza rivalsa") for taxable omaggi.
- Omaggio threshold: R2's "25.82 vs 50 EUR" conflict is resolved by secondary sources: 25.82 EUR is the old limit; current text "costo unitario non superiore ad euro cinquanta", and that exclusion applies only to goods **outside** the business's own trade. A shop giving away goods it sells is a taxable free supply regardless of value (secondary sources; not checked against the 2027 TU text, Unknown whether the article number moved).

---

## 3. Attacks on the design

### A1. A two-value reason (discount-in-goods vs gift) is not enough

EU law has at least four different treatments for "the buyer did not pay full list price", and the two values cover two:

| Case | EU basis [P] | Why the 2-value enum fails |
|---|---|---|
| Reduction granted at the time of sale (coupon, multibuy, BOGO, gift-with-purchase, bundle discount) | Art. 79(b): taxable amount excludes "price discounts and rebates granted to the customer and obtained by him at the time of the supply" | covered ("discount-in-goods") |
| Free supply outside any sale | Art. 16: disposal free of charge "shall be treated as a supply of goods for consideration", except "samples or ... gifts of small value" | covered ("gift") |
| **Reduction paid by the platform or a third party** | Art. 73: taxable amount includes consideration "from the customer or a third party, including subsidies directly linked to the price" | not covered. An Allegro `CAMPAIGN`/`COUPON` or Erli rebate funded by the platform does NOT reduce the seller's VAT base. Treating it as a discount under-declares VAT. Funder is invisible on Erli orders since 2026-08-19 and on Allegro `LineItemDiscount`. |
| **Paid with a voucher / loyalty points** | Art. 30a: a voucher is "an instrument where there is an obligation to accept it as consideration or part consideration" | not covered. A multi-purpose voucher or gift card is a means of PAYMENT, not a reduction; the line keeps its full price. IdoSell `orderSalesMode: "points"`/`"money"` (C-020) and eBay gift-card lines are this. ECJ C-48/97 Kuwait Petroleum (goods redeemed for collected vouchers taxed as a free supply under the Art. 16 predecessor) is the other branch [S, primary text not retrieved]. |

Also not captured: the **link** between the free unit and the paid lines that earned it. Italy needs it for the rate comparison, the UK needs it to apportion "link-save" offers [O gov.uk: "Use 'apportionment' to work out the VAT, unless the free or discounted item: has a resale value of less than £1 ... has a sale value of less than £5 ... costs you less than 20% of the total of the other items in the offer ..."], and Mirakl/eBay/Amazon all send a promotion id that is exactly this link.

### A2. The reason must be a commercial fact, not a tax conclusion

"Discount-in-goods vs gift" is Italian tax vocabulary (sconto merce / omaggio) placed in core, which the brief forbids. Worse, the same commercial event flips category by country and by evidence:
- A gift promised in an Allegro listing description, added by the operator after the order, is a condition of the sale (part of the paid supply) even though OL's evidence says "dodany przez operatora". A gift the operator adds as an apology is discretionary. Same origin, opposite tax category.
- UK and (likely, unverified) DE treat a gift-with-purchase as part of the paid price and **apportion the paid price onto the free line** when rates differ, so the free line carries a POSITIVE taxable share. PL/IT-retail render it at list price with a 100% line rebate. A fixed "list + 100% rebate" in core picks one country's answer.

So core should store observable facts and let a per-country document policy (adapter or policy plugin) derive the treatment.

### A3. A single `reduction` per line cannot hold real orders

Allegro `discounts[]`, Mirakl `promotions[]`, eBay `appliedPromotions[]` and Amazon `promotion.breakdowns[]` are all arrays; a line can carry a platform coupon and a seller campaign at once, with different funders. The proposed `commercial.reduction` is one object per line. Alternative: a list of adjustments per order + per-line allocations (A4).

### A4. Shopify-style "list price + allocations" is simpler and more neutral - with three additions

Shopify [O]: `DiscountAllocation` = "The actual amount discounted on a line item or shipping line"; `discountApplication` = "The discount application that the allocated amount originated from"; `DiscountApplication.allocationMethod` = "The method by which the discount's value is applied to its entitled items", `targetSelection` = "How the discount amount is distributed on the discounted lines".

Mapping check against the channels read: Mirakl (`id`, `deduced_amount`, `apportioned`) = application + allocations + method; eBay (`promotionId`, `discountAmount`) = allocation; Amazon v0 (`PromotionIds`, `PromotionDiscount`) = applications + one summed allocation; Kaufland (`usage_type`, `discount_value`) = allocation with typed application, no id; Allegro (`discounts[].type`, amount only as `originalPrice - price`) = applications with an unknown split; Erli (order `rebate{id,name,code}`, line before/after) = one application + derived allocations. Every channel fits; nothing country-specific is needed.

What allocations alone miss, and must be added:
1. `source` of the application: channel / operator / rule (an OL-added gift has no channel discount).
2. `funder`: seller / channel / other / unknown (Art. 73).
3. `trigger`: condition-of-sale / discretionary / redemption / unknown (Art. 79 vs Art. 16 vs voucher).
A "gift" is then a **derived view**: a line whose list value is fully covered by applications. The pack-bench badge, gift-cost report and document policy read the derived view.

Cost: an order-level adjustments list and a per-line allocation list instead of one field; adapters must emit application ids (or a synthetic one). It also unifies existing OL code that already does order-level discount spreading (`libs/core/src/orders/domain/types/order-discount-split.types.ts`, the #3543 operator discount) instead of adding a third discount concept. Risk: more structure for adapters that know only "before vs after" (Erli) - they emit one application with `funder: unknown` and one allocation per line.

### A5. "No amounts / thresholds in core" - right rule, missing data

Thresholds are national and in different bases: PL per unit and per person per year (C-034), IT "costo unitario" 50 EUR for goods outside own trade, UK "£1 resale", "£5 sale value", "20% of cost". Erli already sends EUR orders, so a PLN amount in core would be wrong anyway. Keep numbers out of core. But core must keep what the policies compute from:
- per free line: list (normal) value, tax rate, currency, **unit cost** (OL already snapshots `unitCostNet` on `order_line_items`, `order-line-item.orm-entity.ts:99`), qualifying line ids;
- per recipient: a stable customer key and dates, so a per-person-per-year sum can be computed (PL art. 7 ust. 4 style records);
- a way to route a free supply to a **separate internal document** (PL internal record, IT TD27 self-invoice / omaggi register) instead of the buyer's receipt. Today's G-10 only renders on the buyer's document.

### A6. Does any country require something core would then need?

| Requirement | Country | Core must keep |
|---|---|---|
| Free line shown at full value + negative line | IT retail (circ. 3/E/2022) [S]; PL rebates shown per rate (C-031) | per-line list value, rate |
| Rate comparison gift vs goods sold | IT TU IVA art. 29 c.1 b | rate on free line + link to qualifying lines |
| Apportion paid price onto free item when rates differ | UK [O]; DE likely (unverified) | link + list values (for the split) |
| Split set price by standalone selling prices, cap at own price | DE BFH XI R 19/23 [P] | component standalone price snapshot at order time |
| One rate for a single composite supply | EU C-463/16 [S] | per-bundle tax setting (split vs principal-element rate) |
| Separate self-supply document for free goods | IT omaggi (TD27) [S]; PL art. 7 ust. 2 (C-033) | route gift to internal document |
| Platform subsidy is part of seller's base | EU Art. 73 [P] | funder per reduction |
| Marketplace is deemed supplier / issues invoice | Kaufland `is_marketplace_deemed_supplier` [P], eBay `ebayCollectAndRemitTaxes` [P], Amazon VCS | "who issues the document" per order, before any gift rendering |

---

## 4. Recommended neutral vocabulary

Order-level `adjustments[]`, each:
- `id` (channel promotion/coupon id, or OL-generated), `label` (channel text, display only)
- `source`: `channel | operator | rule`
- `trigger`: `condition-of-sale | discretionary | redemption | unknown`
  - condition-of-sale = promised before or as part of this purchase (coupon, campaign, multibuy, BOGO, bundle discount, gift promised in the listing)
  - discretionary = given at the seller's choice, not promised (apology gift, operator goodwill)
  - redemption = earned earlier (points, prior-purchase voucher); a payment voucher / gift card is NOT an adjustment and goes to payments
- `funder`: `seller | channel | other | unknown`
- `form`: `amount | free-units` (`free-units` only when the channel says so, e.g. Mirakl FREE_ITEMS, or OL added the line)
- `qualifyingLineIds[]` (may be empty or unknown)
- `allocationMethod`: `per-line | spread | unknown` (Mirakl `apportioned`)

Per line: `listUnitPriceGross` (nullable = unknown; Erli maps it ONLY when the rebate is the only reduction, otherwise null), `taxRate`, `allocations[] {adjustmentId, amount | null}`, plus the existing composition fields.

Why these values: each is observable (a channel field or OL's own action), none names a national regime, and the three axes (trigger x funder x form) reproduce every case in section 3: Art. 79 reduction, Art. 16 free supply, Art. 73 third-party subsidy, voucher/points redemption, IT sconto merce vs omaggio, UK link-save, PL "part of the supply" vs art. 7 ust. 2. "Gift" stays a derived flag for UI and reports, not a stored tax class.

Unknown must be allowed on every axis; a document policy must refuse (or hold for the operator) rather than guess when `funder` or `trigger` is unknown and the result would change the tax base.

---

## 5. Fix-now items found during the check (outside the bundle/gift scope)

1. Erli `market: "de"` / `currency: "EUR"` orders are ingested as PLN (`erli-order.mapper.ts:238`).
2. Erli `TAX_19`/`TAX_7` labelled "historical PL rates" and stamped `taxRateCountry: 'PL'` (`erli-tax-rate.mapper.ts:23`, `erli-order.mapper.ts:210`).
3. Spike text: "No marketplace sends a component list" contradicts C-001; reword to "no marketplace except Allegro (catalogue ids only, no prices)".
4. Any reference to "art. 15 DPR 633/72" goes stale on 2027-01-01 (TU IVA art. 29).

## 6. Open / Unknown
- Erli `productSets` semantics (stock link or catalogue only): Unknown.
- Funder of an Erli order rebate: Unknown from the order; only billing `rebateOrigin`.
- Empik: are seller FREE_ITEMS promotions enabled; is `offered_quantity` inside `quantity`: Unknown.
- DE: is a gift-with-purchase apportioned like UK: unverified (no primary source read).
- ECJ C-48/97 primary text not retrieved (EUR-Lex/curia blocked); cited from secondary summaries only.
- Amazon VPB order shape: unverified (secondary).

## Sources
- Erli swagger https://erli.pl/svc/shop-api/doc/swagger.json [P]; CHANGELOG https://erli.pl/svc/shop-api/doc/CHANGELOG.txt [P]
- Mirakl MMP seller OAS (R2 copy `r2/phase1/dl-mirakl/oas.json`) [P]
- Amazon models `r2/phase1/dl-amz/` [P]; migration guide https://developer-docs.amazon/sp-api/docs/orders-api-migration-guide [O]
- Kaufland swagger `r2/phase1/dl-kl/sw.json` [P]; orders page https://sellerapi.kaufland.com/?page=orders [O]
- eBay Fulfillment OAS `r2/phase1/dl-ebay/ff.json` [P]
- Allegro swagger `r2/phase1/dl/swagger.yaml` [P]
- VAT Directive Art. 16, 30a, 73, 79 via https://www.legislation.gov.uk/eudr/2006/112/ (copy of 2006/112/EC as at 2020) [P]
- BFH XI R 19/23 https://app.omnilex.ai/de/sources/court-decision/de-rii--stre202520153/bfh-2025-01-22-xi-r-1923 [P via aggregator]
- Stadion Amsterdam C-463/16 https://www.simmons-simmons.com/en/publications/ck0an2bte6uci0b94af8kg0zx/260118-ecj-confirms-single-supply-treatment [S]
- Normattiva art. 15 DPR 633/72 https://www.normattiva.it/uri-res/N2Ls?urn:nir:presidente.repubblica:decreto:1972-10-26;633~art15 [P]
- TU IVA art. 29 https://miolegale.it/testi-unici/iva/art-29/ [S]; D.Lgs. 10/2026 overview https://www.fiscoetasse.com/normativa-prassi/13548-nuovo-testo-unico-iva-in-vigore-dal-2027-il-testo-pubblicato-in-gu.html [S]
- ecnews "Gli sconti merce tra fatture e scontrini" https://www.ecnews.it/fiscale/fisco-e-patrimonio/iva/gli-sconti-merce-tra-fatture-e-scontrini/ [S]
- gov.uk VAT on discounts and gifts https://www.gov.uk/charge-reclaim-record-vat/vat-on-discounts-and-gifts [O]
- Shopify DiscountAllocation / DiscountApplication https://shopify.dev/docs/api/admin-graphql/latest/objects/DiscountAllocation [O]
- OpenLinker code: `libs/integrations/erli/src/infrastructure/adapters/erli-order.mapper.ts`, `erli-tax-rate.mapper.ts`, `erli-order.types.ts`, `libs/core/src/orders/domain/types/incoming-order.types.ts`, `order-line-item.orm-entity.ts` [C]

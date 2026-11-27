# R5 red team 1 - Allegro and Polish marketplace claims

Date: 2026-11-04. Read-only. Area: C-001..C-010, C-023, C-027, C-063..C-067.

## Sources used (and their kind)
- **Allegro OpenAPI spec**, primary: https://developer.allegro.pl/swagger.yaml, downloaded 2026-11-04. SHA1 `70f6d2d7...` is identical to the round-1 copy in `r1/phase1/dl/swagger.yaml`, so the round-1/2 line numbers still hold.
- **Allegro developer news**, primary: 13-12-2023 (productSet in orders), 15-10-2026 and 19-10-2026 (MULTIPACK withdrawal).
- **Allegro developer tutorial "jak obsługiwać zamówienia"**, primary. Only the first 100k characters were read.
- **Allegro staff answers on github.com/allegro/allegro-api**, primary for "how the API behaves": issues #7487, #8589, #9790, #12768, #13348. Staff accounts: MaciejFrackowiak, MartaNowaczyk, PrzemyslawLukanowski.
- **Moderator answers on spolecznosc.allegro.pl**, official but secondary: thread 49695 (2020).
- **Erli Shop API swagger.json** (primary), round-2 copy in `r2/phase1/dl-erli/swagger.json`.
- **ASA ruling**, primary: https://asa.org.uk/rulings/superdrug-stores-plc-a18-451479.html
- **OL code**: `libs/integrations/allegro/src/infrastructure/adapters/allegro-order-source.adapter.ts`, `libs/integrations/erli/src/infrastructure/adapters/erli-order.types.ts`

## 1. Verdicts

| Claim | Verdict | Evidence |
|---|---|---|
| C-001 productSet on the order line | **Confirmed, with three caveats** | **Spec** `OfferReference.productSet` (swagger L30244-30266): "If the offer was a product set, you can see a list of component products (product id with quantity)." The item is `{id (uuid), quantity}` only.<br>**News** 13-12-2023 https://developer.allegro.pl/news/zamowienia-dodalismy-informacje-o-zestawach-produktow-7GWeDzwWMfv: "dodaliśmy nowy obiekt "productSet"" on `GET /order/checkout-forms[/{id}]`.<br>**Staff** (#8589, MartaNowaczyk, 2024-03-05): "ID produktu zwracamy tylko wtedy, gdy zdefiniowany jest zestaw produktowy."<br>**Caveat (a)**: it is null on single-product offers. #12768 shows `"productSet" : null`.<br>**Caveat (b)**: the ids are Allegro **catalogue** UUIDs, and those UUIDs are NOT stable. In #7487 (2023-08-11) MaciejFrackowiak says: "Product with id=b700f3b8... was deleted from our database because it was a duplicate." On whether this can happen at any time: "Yes, we can do it." He also says a deleted product can come back as a 404, not as a new id. The asker measured this on "like 20 products out of 1000 (2%)".<br>**Caveat (c)**: there is no per-component price, EAN or SKU. Whether a multipack (1 product, qty > 1) also carries productSet is **unverified**. |
| C-002 OL mapper ignores these fields | **Confirmed, and wider than stated** | **Code** `allegro-order-source.adapter.ts:998-1016`. It maps `id`, `productRef: {type:'offer', externalId: lineItem.offer.id}`, `quantity`, `price`, `sku: lineItem.offer.id`, `name` and `taxRate`.<br>**Also ignored**: `offer.external.id` (the seller signature, i.e. Allegro's "SKU"), `deposit`, `reconciliation` and `vouchers`.<br>**Consequence for gift wrap**: the `GIFT_WRAP` service price is in `summary.totalToPay` but not in any line. So `discountGap = subtotal + shipping - total` (L970) goes negative and is dropped as a "surcharge". The paid gift wrap then vanishes from documents. This is from code reading; it is not live-tested. |
| C-003 LineItemDiscount = {type} | **Schema confirmed; the X-01 corollary is disputed** | **Spec** L31255: `LineItemDiscount` has only `type`. Grep finds no `bundleId` in any checkout-form schema.<br>**But** "amount = originalPrice - price" is wrong for two discount types, CAMPAIGN and ALLEGRO_PRICES.<br>**CAMPAIGN**, #13348 (2026-04-30, staff): "The values are the same, because the buyer sees the item with the price visible on the offer". For the base price, "You should use GET /sale/product-offers/{offerId}". That call returns the current price, not the price at order time.<br>**CAMPAIGN**, #12768 (2025-12-02): originalPrice = price = 85.49 with `discounts:[{type:"CAMPAIGN"}]` while the struck-through price was 89.99. Staff: "Tak, jest to zamierzone."<br>**ALLEGRO_PRICES**, #9790 (2024-09, staff): "lineItems.originalPrice.amount also will be the discounted price". The Allegro-funded part is in `reconciliation.value` per unit ("offer ... 67.96, the Allegro Price is 59.99 ... reconciliation.value.amount we return 7.97"). |
| C-004 BUNDLE also on Allegro-created / no-price-change bundles | **Confirmed** | **Spec** L31270: "`BUNDLE` - a bundle discount (used also for bundles with no price change)".<br>**Spec** `/sale/flexible-bundles` response examples (L3774, L3838, L4078) carry `createdBy: "ALLEGRO"`. |
| C-005 MULTIPACK ends 2027-01-12 | **Confirmed. Scope is wider; the spec lags** | **News** 15-10-2026 (…-4R3MoYWrPi5): the cut-off is "12 stycznia 2027". Creating a multipack for one offer is blocked, and so is the GET filter. Also: "Wszystkie rabaty typu multipack zostaną usunięte z systemu". Cross-offer multipack "pozostanie bez zmian". The replacement is productSet with `quantity.value` > 1.<br>**News** 19-10-2026 (…-3ALR4dZPmS7): "Zmieniliśmy datę wycofania rabatów typu multipack z 30 listopada 2026 na 12 stycznia 2027".<br>**The spec** still documents single-offer Multipack creation with no deprecation marker (L4447-4449).<br>**Not stated anywhere**: historic checkout forms still carry `UNIT_PERCENTAGE_DISCOUNT`, so the adapter must keep handling it. |
| C-006 /sale/bundles fully deprecated | **Confirmed. The wording "only bundle API" is wrong** | **Spec**: GET list, GET by id, DELETE and PUT discount all have `deprecated: true` (L3013-3251). There is no create operation.<br>**Wording**: flexible bundles are the only API for multi-offer bundles. productSet offers (`/sale/product-offers`) are a second, live bundle API. |
| C-007 100% unit = 0.01 zł + min commission | **Probable (old source)** | **Spec** L4447: the percentage must be "lower than or equal to 100".<br>**Moderator** nat_not (29-07-2020), quoting the help article: "Jeśli udzielisz 100% rabatu, obniżymy cenę przedmiotu do 0,01 zł i naliczymy minimalną prowizję w wysokości 0,25 zł". The 2026 amount is unverified.<br>**Unverified edge**: when the free unit sits in a line with quantity > 1, it is probably averaged into `price`. In that case no 0.01 line exists at all.<br>**After 12-01-2027** only CROSS_MULTIPACK and the flexible-bundle SLOT_DISCOUNT (no max % in spec, L28393) remain. |
| C-008 no gift feature on Allegro | **Confirmed** | **Spec**: grep for "gift" finds only the paid additional service `GIFT_WRAP` (L23338, L25439). There is no gift flag, gift line or gift promotion type.<br>**Moderator** (2020, thread 49695): "Nie pobieramy prowizji od gratisów rozumianych jako darmowe przedmioty, które oferujesz jako dodatek w swoich ofertach."<br>**Zero-price offers**: the spec states no allowance anywhere, so it is Unknown. Allegro Lokalnie is C2C classifieds with no API in OL's scope, so it is not a counterexample. |
| C-009 waybill per lineItem ids, no qty | **Confirmed, and stronger than stated** | **Spec** `CheckoutFormAddWaybillRequest` (L31690): `lineItems[]{id}` only. "When list is not provided or it is empty it means that every item from an order is included in shipment."<br>**Spec** `ShipmentCreateRequestDto` ("Wysyłam z Allegro", L39674) has no line items at all, only `packages`. |
| C-010 returns by offerId + qty | **Confirmed** | **Spec** `CustomerReturnItem`: `offerId, quantity, name, price, url, reason, serialNumbers`. There is no lineItem id and no component. `serialNumbers` is the only per-unit hint.<br>**Spec** `RefundClaimRequest` (commission refund): `lineItem.id` + `quantity`, at set grain.<br>**Spec** `RefundLineItem` allows `AMOUNT`, so a component refund can be expressed only as money. |
| C-023 Erli productSets / unitPriceBeforeRebate / EUR, de | **Confirmed, and one thing missed** | **Erli swagger**: `ProductCreate/Update/Response.productSets{items[{metaProductId, quantity}]}` and `externalProductSets{items[{externalMetaProductId, quantity}]}`.<br>**Order items**: `id, externalId, quantity, weight, unitPrice, unitPriceBeforeRebate, name, slug, ean, sku, taxRate (… TAX_7, TAX_19), dispatchTime`. There is no set data on the order line.<br>**Order level**: `currency` is PLN or EUR; `market` is pl or de.<br>**OL**: `unitPriceBeforeRebate` is typed in `erli-order.types.ts:74` and never read.<br>**Missed**: `Order.rebate {id, name, code}`. This is an order-level promotion identity (the code appears "tylko w przypadku jednorazowych kodów"). It is the only channel-supplied promotion id found in the PL marketplaces. |
| C-027 no marketplace sends composition | **Refuted as stated** | Allegro sends composition on the order line: see C-001, the 13-12-2023 news and staff #8589.<br>It is in catalogue-UUID terms, not OL-SKU terms. The claim holds for Erli (order items carry no set data).<br>The plan's Key finding 1 ("No marketplace sends a component list") and data.ts `CONFIRMED[0]` contradict data.ts's own Allegro example, which declares "podaje skład zestawu w linii (productSet)". |
| C-063 top pain: component stock drift | **Probable (cannot refute)** | **Allegro angle**: a product-set offer has set-level stock only. **Spec** `ProductSetElementQuantity`: "For number of sets available in stock, use `stock.available` property." Allegro never derives it. |
| C-064 top pain: partial refund of discounted set | **Probable** | **Allegro angle**: refunds are by `AMOUNT` per line and returns are at set grain (C-010). The moderator advice is in round 2 (thread 727363); it was not re-fetched. |
| C-065 top pain: gift not on order | **Confirmed for Allegro** | See C-008. A description gift leaves no trace in the checkout form. |
| C-066 gift running out, ASA/Superdrug | **Disputed (overstated)** | **Ruling date**: "14 November 2018".<br>**Ad (b)** was an IT failure: the free primer was not added at checkout, and Superdrug said it was never out of stock. The conclusion: "the promotion was likely to have caused unnecessary disappointment to participants".<br>**Ad (a)**, the towel, was a stock/delivery failure.<br>**"Frequent"** has no support beyond anecdotes. The ruling is UK, not PL.<br>**Useful for OL**: a *failed automatic gift rule* is itself the regulated failure. This backs G-16. |
| C-067 limits bypassed with new emails | **Probable for shops; not applicable to Allegro** | The only source is the Shopify community (r2 merchant voice L56-57).<br>**On Allegro** the buyer email is a per-transaction alias (`fixedPart+transactionId@allegromail.pl`, see the masked-email note in architecture-overview § Customers). An email-keyed limit there is meaningless rather than bypassable. The stable key is `buyer.id`. `buyer.guest` exists too. |

## 2. Cases rounds 1-2 missed or under-weighted

1. **The catalogue UUID in productSet is unstable** (#7487). Allegro merges duplicate products and deletes others. A mapping table "Allegro product UUID -> OL variant", built at publish time or from a past order, will silently stop matching for about 2% of products (one seller's measurement). It can also start matching a merged product. This affects B-04/D3b if the composition is keyed on the UUID.
2. **CAMPAIGN and Allegro Prices break "list price = originalPrice"**:
   - with CAMPAIGN, originalPrice == price while a discount happened;
   - with ALLEGRO_PRICES, originalPrice == price, and the platform-funded part sits in `reconciliation.value x reconciliation.quantity`.

   A neutral `listUnitPriceGross` filled from originalPrice would state "no reduction" on these lines. That is a positive false claim, not an "unknown".
3. **Discounts stack.** `discounts` is an ARRAY, so one line can carry BUNDLE + CAMPAIGN. A coupon from a campaign shows only as an originalPrice/price gap: staff #9790 says COUPON "will not be returned in any case". The amount per reason cannot be attributed.
4. **Discount values in practice vs the spec enum.**
   - Staff #9790 (2024): returned values include "CROSSMULTIPACK", "MULTIPACK", "BUNDLE" and "ALLEGRO_PRICES".
   - The spec enum has UNIT_PERCENTAGE_DISCOUNT and COUPON, and no ALLEGRO_PRICES.
   - The tutorial lists the old values under the deprecated order-level array.

   These conflict. Trust the spec for new orders, but parse unknown strings as "unknown reason", never as an error.
5. **Funding source.** Allegro Prices (`reconciliation`, BILLING|WALLET) is a platform-funded reduction, not a seller discount. Margin and gift-cost reports, and possibly the VAT base of a subsidised price (tax adviser), need to know who paid. The proposed `commercial.reduction` has a reason and evidence but no funder.
6. **Paid gift wrap is lost today** (C-002 consequence). `selectedAdditionalServices` is outside the line price and outside OL's subtotal, so a "Zapakuj na prezent" 10 zł charge never reaches documents or the pack bench. G-14 is filed as "later". The money loss argues for fix-now. This is code reading only, not live-tested.
7. **`offer.external.id` is Allegro's SKU.** D3b "recognise by SKU" on Allegro must use `external.id`, or OL's own offer mapping. The current `sku: lineItem.offer.id` (L1009) is not a SKU.
8. **Deposits on a set.** `LineItemDeposit`: "If the offer consists of multiple products with different deposits, the value in this field is the sum of those deposits." The set deposit arrives as one sum, while the offer side has `ProductSetElementDeposits` per element. A component return then needs a per-component deposit split that the order does not give. X-05 lists deposits only generically.
9. **Buyer-chosen gift via `messageToSeller`.** Offers can make the message box REQUIRED in some categories (spec `MessageToSellerSettings`). That is the only Allegro mechanism through which a buyer can state a choice. Whether sellers use it for gifts is unverified.
10. **One Fulfillment (1F).** Flexible bundles forbid mixing 1F and non-1F offers. A productSet offer fulfilled by Allegro must not reserve OL component stock. This was not discussed for bundles.
11. **Spec lag.** The MULTIPACK creation text is still undeprecated in the swagger. Any code-generated client would happily offer a feature that dies on 12-01-2027.

## 3. Counterarguments to the proposed standard (Allegro angle)

### A. "composition: channel gave components" is presented as identity
On Allegro it is a claim in an unstable foreign key space: catalogue UUIDs with no price, EAN or SKU.

**Alternative:**
- Recognise the bundle by **offer mapping**: `offer.id` -> OL bundle variant. OL already stores this for offers it published. Use `external.id` as the fallback.
- Use `productSet` only as a **cross-check**:
  - if it is present and no OL definition exists, raise an attention state ("set sold, contents unknown in OL");
  - if count or quantity differ from the OL definition, raise drift attention.

**Cost:** low, one comparison plus one attention reason. No `/sale/products` call is needed per order.

### B. `listUnitPriceGross` filled from originalPrice
This is wrong for CAMPAIGN and ALLEGRO_PRICES.

**Alternative**, the adapter rule:
- If `discounts` contains CAMPAIGN, list = absent (unknown).
- If `reconciliation` is present, list = price + reconciliation.value, with a platform-funded reduction of reconciliation.value.
- Otherwise, list = originalPrice.

Add `funding: seller | platform | unknown` to `commercial.reduction`.

**Cost:** one enum. It prevents wrong margin and gift-cost reports, and keeps a later tax decision open.

### C. One `reduction.reason` per line
Allegro gives an array, with no per-reason amount.

**Alternative:** `reasons[]` with a total amount and per-reason amount = unknown. Never pick one reason.

**Cost:** trivial now, painful to retrofit.

### D. D3f "relay shipped only when every component has shipped"
On Allegro the only relay is a waybill per lineItem. The first waybill marks the line as sent, and partial quantity is impossible.

Holding back the first waybill delays tracking for the buyer. It can also hit Allegro's dispatch-time metric. Whether a late waybill counts as late dispatch is unverified, but it is the obvious risk.

**Alternative:**
- Post each parcel's waybill as soon as it ships. The spec allows several shipments, each with `lineItems`.
- Gate only the order-level fulfilment STATUS (`SENT`) on the last component.

**Cost:** a per-channel policy flag on the source port. It fits the existing `relayWaybillUnderClaim`.

### E. Channel tax rung vs the in-set split
Since #2249 the Allegro line `tax.rate` is the CHANNEL rung of rate resolution. For a recognised set whose components carry 5% and 23%, that single 23% will either win or conflict with the D3a split.

**Alternative:** for a line OL expands into components, the channel tax rung is ignored for the components, and the mismatch is recorded as information, not a conflict.

**Cost:** one rule in the expander.

### F. Gift detection on Allegro is low value and shrinking
After 12-01-2027 only CROSS_MULTIPACK at 100% and SLOT_DISCOUNT remain, and free units may be averaged into a multi-unit line.

Spend Allegro effort on:
- **gift wrap pass-through**, which is real money lost today;
- making **OL-added gift lines invisible to every Allegro writeback**. They have no `lineItem.id`, so the waybill relay, refunds and returns must skip channel-unknown lines.

**Cost:** a filter in three writebacks. Without it, a waybill call naming a non-Allegro line id will fail.

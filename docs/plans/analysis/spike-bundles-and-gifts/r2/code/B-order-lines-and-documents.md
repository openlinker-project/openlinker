# B - Order line and sales-document data path (bundles + gifts)

Read-only code research, 2026-11-04, worktree `zestawy-gratisy-rekonesans-c15354` (HEAD 9e35aec9d).
All paths relative to repo root. "Not typed" = the field exists on the platform per the spike
(docs/plans/spike-bundles-and-gifts.md) but the local wire type does not declare it, so it is
dropped at JSON-parse-to-type time and never read.

---

## 1. Neutral order-line types today

### 1.1 The line shapes

| Type | File:line | Price fields | Identity | Notes |
|---|---|---|---|---|
| `IncomingOrderItem` (plugin contract) | libs/core/src/orders/domain/types/incoming-order.types.ts:163-224 | `price` (source basis), `unitPriceGross?` | `id` (source line id), `productRef` (offer/variant/product/sku union, :231-235) | `taxRate?`, `taxRateCountry?`, `name?`, `imageUrl?`. No composition, no list price, no discount, no free flag. |
| `IncomingOrderTotals` | incoming-order.types.ts:237-271 | subtotal/tax/shipping/total, `shippingGross?`, `shippingTaxRate?` | - | **No `discountTotal`** - yet Allegro (allegro-order-source.adapter.ts:1023) and PrestaShop (prestashop-order.mapper.ts:140-145) emit it; it survives only because `buildUnifiedOrder` passes `totals: incoming.totals` verbatim (order-ingestion.service.ts:2390). Typing gap. |
| `OrderItem` (domain) | libs/core/src/orders/domain/types/order.types.ts:254-355 | `price` (paired with `totals.taxTreatment`), `unitPriceGross?` (:263-288, ADR-014 #3365 "second field, not a change to price") | `id` = source line id (copied at order-ingestion.service.ts:585) | tax provenance fields `taxRate/taxRateCountry/taxSource/taxRateReadAt/taxRateChannel`. |
| `OrderTotals.discountTotal` | order.types.ts:440-465 | whole-order discount the source applied and did NOT put on a line; "Carried, never acted on" (FA(3) can only express a per-line discount, so OL refuses to invent an attribution). | - | Used only to NAME a refusal: `describeDiscountCause` (sales-documents/domain/types/line-total-mismatch.types.ts:37-52), rounding (`reconcileDiscountRounding`, discount-rounding.types.ts:41-91), Subiekt ZK split, Shoper total check. |
| `OrderCreate.items` (destination projection) | order-sync.service.ts:282-345 | explicit allowlist (id, productId, variantId, quantity, price, sku, name, taxRate, taxRateCountry, unitPriceGross) | `id` | Comment :289-295 names it "the THIRD allowlist an OrderItem field has to be named in". |
| order snapshot (jsonb) writer | libs/core/src/orders/application/services/order-record.service.ts:~185-224 | allowlist incl. `unitPriceGross` (:223) | - | `totals: order.totals` verbatim (:225) |
| order snapshot reader | libs/core/src/orders/domain/order-from-ready-snapshot.ts:250-290 (`readItems`), :293-322 (`readTotals`, `discountTotal` at :318) | allowlist | - | |
| ingestion line builder | order-ingestion.service.ts:584-602 | explicit allowlist (4th one) | - | |
| `order_line_items` (analytics) | libs/core/src/orders/infrastructure/persistence/entities/order-line-item.orm-entity.ts:21-107; drafts `deriveOrderLineItems` libs/core/src/orders/domain/order-analytics-projection.ts:96-117 | `unitPrice = item.price` (:107 of projection) - net on net-priced sources | `(orderRecordId, lineNumber)` unique, `lineNumber` = array index; **no source line id column** | delete-then-reinsert per order; cost snapshot carried by `productId|variantId` (#3588). |

### 1.2 Discount machinery

- Operator discount (#3543): `OrderDiscountEdit` (order-discount.types.ts:43-54), `planOrderDiscount` (:159) -> `distributeOrderDiscount` (order-discount-split.types.ts:45-80, proportional by line gross, floor + remainder on largest line). `applyDiscountToLines` (order-discount.types.ts:201-225) REWRITES `unitPriceGross` (and `price` when inclusive) to the after-discount figure; `restateTotalsForDiscount` (:228-241) adds to `discountTotal`. So an OL discount reaches documents as a lower paid price with NO list price / rebate kept on the line. A 0.00 gift line gets share 0 (proportional), good.
- Overlay: `OrderEdits` (order-edits.types.ts:86), `applyLineEdits` keyed by `OrderItem.id` (:291), quantities only go down, merged in `toDomain` (architecture-overview § Orders #3542). `channelSnapshot` stays the channel original.
- Subiekt ZK applies `discountTotal` via `distributeOrderDiscount` into `wartoscBruttoPoRabacie` (subiekt-order-processor.adapter.ts:278-302).

### 1.3 Where new neutral fields fit

(a) **Composition / parent-child grouping** - a new optional member on `IncomingOrderItem` and `OrderItem`, e.g. `composition?: OrderLineComposition`. It is a fact about the SOURCE line (which shape the channel sent), so it belongs on the plugin contract, carried verbatim like `taxRate`. The OL-side bundle recognition result (which OL bundle definition, in-set price snapshot) is a SEPARATE field written by core at ingestion (`bundle?: OrderLineBundleSnapshot`), never by the adapter.

(b) **List price before discount + discount amount + reason** - beside `unitPriceGross`, never instead of it: `listUnitPriceGross?` + `priceReduction?: { reason, evidence }`. `price`/`unitPriceGross` keep meaning "what the buyer paid per unit" (ADR-014 decision 1 invariant: destinations price at `items[].price`; documents' line-sum invariant reads `unitPriceGross ?? price`). The discount AMOUNT is derived (`listUnitPriceGross - unitPriceGross`) - store it only if the source reports a line discount that does not equal that difference (do not store two figures that can disagree).

(c) **Free-line evidence** - inside `priceReduction.evidence`: `'source-flag' | 'zero-price' | 'nominal-price' | 'full-rebate' | 'operator-added' | 'rule-added'`. Zero price alone is evidence, never a classification (spike finding 4).

### 1.4 What breaks

1. **Five allowlists, not one.** Any new `OrderItem` field must be named in: ingestion builder (order-ingestion.service.ts:584-602), snapshot writer (order-record.service.ts:~185-224), snapshot reader (order-from-ready-snapshot.ts:250-290), destination projection (order-sync.service.ts:296-321), and each adapter's own pass-through (PrestaShop has a positional re-map at prestashop-order-source.adapter.ts:605-631). The repo has lost fields here twice (comments at order-record.service.ts:202-223). Mitigation: put the new fields in ONE nested object (`commercial?: {...}`) so each allowlist adds one key, plus a round-trip spec across all four.
2. **Item resolution is all-or-nothing.** order-ingestion.service.ts:565-628: every line must resolve its `productRef` to an internal product or the whole order goes `awaiting_mapping`. A channel bundle PARENT whose offer maps to no OL product, or channel CHILD lines for components never synced, block the order. Recognition (D3b) must run inside/after resolution with a defined outcome for "bundle parent unmapped".
3. **Line id fan-out - the hard one.** `OrderItem.id` is copied verbatim to every downstream key:
   - reservations: order-ingestion.service.ts:2239 -> `reservations` unique `(orderRecordId, orderLineId, inventoryItemId) WHERE held` (reservation.orm-entity.ts:9). Several components under one line ARE representable (key includes position) - but `already-closed` is per line (reservation.service.ts:111).
   - routing/work: project-order-for-routing.ts:48 -> `fulfillment_work_lines` unique `(fulfillmentWorkId, orderLineId)` (fulfillment-work-line.orm-entity.ts:41). **Components of one bundle line in one work collide.**
   - shipment lines: shipment-line.service.ts:116 -> unique `(shipmentId, orderId, lineId)` (shipment-line.orm-entity.ts:49). **Same collision.**
   - sale decrement key `sale:{owner}:{workId}:{lineId}` (architecture-overview § Inventory #3453): one decrement per line, not per component.
   - invoice line `orderLineId` (mapper :384) -> return-correction matching (#3312) and return line resolution (#3171, return-order-line-resolution.domain-service.ts:46-216, narrows on `sku`/`offerId`/price). A returned COMPONENT SKU against a parent-only order line finds no candidate.
   => Keep `OrderItem.id` as the COMMERCIAL line id, and add a derived FULFILMENT line id for exploded components: `fulfilmentLineId = orderLineId` for a plain line (byte-identical, no migration of existing rows) and `${orderLineId}~${componentKey}` for a component. One pure function (`deriveFulfilmentLines(order)`, orders domain) feeding the four call sites above.
4. **Analytics net sales / units / margin.** `deriveOrderLineItems` writes one row per commercial line with `unitPrice = item.price`. Parent+children shapes double count units (parent + children) and margin (cost snapshot on children too). Need `bundleRole` on the draft so units/top-products skip either parents or children consistently, and bundle cost = sum of component costs (B-16). `lineNumber`-only identity means no column to join a line edit / component to - add `orderLineId text null`.
5. **Operator edits.** `OrderLineEdit` lowers a line's quantity (order-edits.types.ts:75, 286-323). Lowering a component of a bundle must be refused (new code, e.g. `LINE_IS_BUNDLE_COMPONENT`), and lowering a bundle line must cascade to its components' fulfilment lines (work `cancelledDelta`, reservation `narrowForOrder`, sale reversal key `edit:{changeId}:{orderLineId}` must become per fulfilment line).
6. **Operator discount** loses list price by design (rewrites unit price). If a line already carries `listUnitPriceGross`, `applyDiscountToLines` must leave `listUnitPriceGross` untouched so the document shows list -> source rebate -> OL discount as one combined rebate (or refuse when the renderer can show only one).
7. **Refund ceiling** (refund-ceiling.types.ts:106) is per ORDER total - unaffected. Partial set returns need the in-set price to compute the line refund; the ceiling still caps the sum.
8. **Rounding remainders on a 0-priced line** (confirmed): `reconcileDiscountRounding` picks the FIRST quantity-1 goods line whose `price + gap > 0` (discount-rounding.types.ts:65-75) - a 0.00 gift line qualifies when the gap is positive; `spreadDeliveryAcrossLines` (delivery-line.types.ts:581-587) starts `target = -1` and takes the first quantity-1 line even at gross 0, so when the gift is the only quantity-1 line it receives the whole delivery remainder (and becomes a non-zero "gift"). Both need "skip lines with paid gross 0 / free lines".

---

## 2. Per-adapter: read vs ignored (order SOURCE side)

| Adapter | Reads per line | Ignores / not typed | Bundle shape | Gift shape | Evidence |
|---|---|---|---|---|---|
| **Allegro** | `id`, `offer.id` (as productRef offer AND sku), `offer.name`, `quantity`, `price.amount`, `tax.rate` (allegro-order-source.adapter.ts:998-1018). Order: `summary.totalToPay`; infers `discountTotal = subtotal + shipping - total` (:948-971). | Not typed in `AllegroCheckoutForm.lineItems` (allegro-api.types.ts:75-91): `originalPrice`, `discounts[]`, `selectedAdditionalServices`, `reconciliation`, `vouchers`; offer `productSet` (set contents live on the OFFER/product, not the checkout form - requires an offer read). | parent only (`productSet` offer) - one line, reserved and packed as ONE item (live defect). | 0.01 line, or absent (description-only). `originalPrice` vs `price` would give list + line discount. | adapter :998-1023 |
| **Shoper** | `id`, `stock_id` -> variant / `product_id` -> product / `code` -> sku (shoper-incoming-order.mapper.ts:273-286), `price` (gross), `quantity`, `name`, `code`, `tax` (:288-304). Order `sum`, `shipping_cost`; `subtotal = sum - shipping` (:369). | `ShoperOrderLineRow` (shoper-api.types.ts:533-546) has no `type`, `children`, `discount_perc`, `option`, `unit`; `ShoperOrderRow` (:486-514) has no order discount fields (`discount_client/group/levels/code`). `ean` typed, unread. No `discountTotal` emitted -> a discounted order's lines exceed `sum` silently until a document refuses it. | parent + `children[]` (spike) - children ignored; parent packed as one item. | 0.00 line or `discount_perc` 100 (unverified). | mapper :288-376 |
| **PrestaShop** | `order_details` row (prestashop-order-source.adapter.ts:931-947; PS9 resource): `id`, `product_id`, `product_attribute_id`, `product_quantity`, `product_price` (net), `unit_price_tax_incl`, `product_reference` (prestashop-order.mapper.ts:58-87; type prestashop.mapper.interface.ts:171-190). Order `total_discounts_tax_incl` -> `discountTotal` (:140-145). | Present on `order_detail` but unread: `product_name`, `unit_price_tax_excl`, `reduction_percent`, `reduction_amount(_tax_incl)`, `original_product_price`, `product_quantity_discount`, `group_reduction`; order `associations.order_cart_rules` (which cart rule, `free_shipping`, `gift_product`). | parent only (pack = one row; components decremented by PS per pack stock mode). | Cart rule `gift_product`: the gift is a FULL-PRICE row and its value sits in `total_discounts` -> whole-order `discountTotal`, unattributed. Attribution needs `order_cart_rules` + the rule's `gift_product`/`gift_product_attribute`. | mapper :58-145 |
| **WooCommerce** | `id`, `variation_id`/`product_id`/`sku` ref, `quantity`, `price` (net, pre-discount), `sku`, `name`, `image`, `total + total_tax` -> `unitPriceGross` (post-discount) (woocommerce-order-source.adapter.ts:352-405). | Typed but unread: `subtotal` (pre-discount line total, woocommerce-order.types.ts:108) - with `total` it IS the per-line coupon allocation WC already computed. Not typed: line `meta_data`, `subtotal_tax`, `taxes[]`, Product Bundles `bundled_by` / `bundled_items` / `bundle_cart_key`, Composite `composite_parent` / `composite_children`; order `coupon_lines`, `discount_total`, `discount_tax`. | parent + children (bundle plugins); children often 0.00 when priced at container level. | 0.00 line, or full price with coupon making `total = 0` (subtotal > 0) = "full price + 100% discount". | adapter :352-405 |
| **Erli** | `id`, `externalId` (offer ref), `quantity`, `unitPrice` (gross, grosze), `sku`, `name`, `taxRate` (erli-order.mapper.ts:192-211). Totals: `totalPrice`, `delivery.price`, `subtotal = total - shipping` (:228-241). | `unitPriceBeforeRebate` TYPED (erli-order.types.ts:74) and never read; `ean`, `weight`, `slug` unread. | parent only. | rebate visible as `unitPriceBeforeRebate > unitPrice`. | mapper :192-241 |
| **Subiekt (source)** | `symbol`, `nazwa`, `ilosc`, `wartoscBrutto`; `price = wartoscBrutto / ilosc` (subiekt-order-source.adapter.ts:146-152). | `BridgeOrderDetailLine` (subiekt-bridge-orders.types.ts:167-172) has no before/after-rebate pair, no komplet flag, no stable line id. **Line id is positional `${detail.id}-${index}`** (:147) - unstable, already violates the #3171 / reservation / work keying assumption that a line id survives re-reads. | komplet (unread) | rebate pair unread | :140-160 |

---

## 3. Sales documents

### 3.1 Line contracts
- `InvoiceLine` (libs/core/src/invoicing/domain/types/invoicing.types.ts:443-~520): `name, quantity, unitPriceGross, taxRate`, optional `unit, productId, variantId, orderLineId (#3312), gtuCode, procedureCode`. No list price, no rebate, no component key.
- `FiscalTransactionLine` (libs/core/src/fiscalization/domain/types/fiscalization.types.ts:222-250): `name, productId?, quantity, unitPriceGross ("buyer-paid gross price of ONE unit"), taxRate, sku`. No list price / rebate.
- `CorrectionLine` (invoicing.types.ts:943) - by `originalLineNumber`.

### 3.2 Composition path
- Invoice: `toIssueInvoiceCommand` (libs/core/src/invoicing/application/mappers/order-to-issue-invoice-command.mapper.ts:103-196) -> `toInvoiceLine` (:359-386, `unitPriceGross: item.unitPriceGross ?? item.price`) -> `applyDelivery` (:422-500; `spread` via `spreadDeliveryAcrossLines`, `goods` via `splitShippingAcrossRates`) -> `reconcileDiscountRounding` -> `assertLinesSumToTotal` (:304-340, quantity-scaled epsilon, names `discountTotal` cause).
- Receipt: `toRegisterTransactionCommand` (libs/core/src/fiscalization/application/mappers/order-to-register-transaction-command.mapper.ts:109-150) mirrors it; `toFiscalLine` :267-~290; delivery names via `formatReceiptLineName` (:363-407); same reconciliation (:134-136, :214-260).
- `splitShippingAcrossRates` (libs/core/src/sales-documents/domain/types/shipping-tax-split.types.ts:120-165): a 0-gross rate contributes 0 and a 0-amount part is filtered (:163) - so a gift alone at its own rate does not get a shipping share, good. Any line with an unknown rate -> `null` (whole split uncomputable), so a gift line with no rate (OL-added gift without catalogue rate) blocks mixed-rate splitting.
- Delivery line resolver: `resolveDeliveryLine` (delivery-line.types.ts:309), settings `deliveryOnDocuments` (ADR-082). ADR-082 decision 7: "A receipt never carries a zero line, since it registers what was paid" - directly relevant precedent for gifts on receipts.
- Line-sum reconciliation invariant: Σ qty × unitPriceGross == total within epsilon. **Any rebate design must keep `unitPriceGross` = PAID price**, so this invariant and every existing adapter are untouched.

### 3.3 Who can render list price + rebate today

| Adapter | Wire today | Can render per-line rebate? | 0-paid line |
|---|---|---|---|
| eparagony receipt | `EparagonyReceiptProductLine {unitPrice, totalLineValue "before any rebate/markup", taxRate}` (libs/integrations/eparagony/src/domain/types/eparagony-api.types.ts:47-60); only a whole-receipt `REBATE` line WITHOUT rate used as balancing (eparagony-document.mapper.ts:96-106), positive balance refused (:107-120). | Vendor per-line `rebatesMarkups` per spike - NOT typed in the repo. Would need wire type + mapper. | Sent as unitPrice 0 today (no guard, toProductLine :228-290). Vendor refuses a receipt where a VAT-rate bucket totals 0 (spike) - a gift that is the only item at its rate, whether priced 0 or list+100% rebate, empties that bucket. |
| eparagony invoice | eparagony-invoice.mapper.ts | unknown (not inspected in depth) | - |
| KSeF FA(3) | `FaWiersz` order list has no `P_10` (libs/integrations/ksef/src/infrastructure/fa3/domain/fa3-xml.types.ts:290-304); XSD has `P_10` (schema xsd:3149). | Yes, by schema: `P_9A` = list unit net, `P_10` = rebate amount, `P_11` = net after. Builder must add `P_10` and derive it from list - paid at line level. | `P_11 = 0` permitted by schema; band totals 0 fine. |
| inFakt | `services[] {name, tax_symbol, quantity, unit, unit_net_price}` (infakt-invoicing.adapter.ts:662-669) | Not wired; inFakt service-level discount field unverified locally. Today paid-only. | 0 net allowed? unverified. |
| Subiekt GT invoicing bridge | `BridgeLine {towarSymbol?, ilosc, cenaBrutto, stawkaVAT, name?}` (libs/integrations/subiekt/src/bridge/subiekt-bridge.types.ts:101-107) | No (paid only). | ? |
| Subiekt GT ZK (order destination) | `BridgeOrderLine.wartoscBrutto` + `wartoscBruttoPoRabacie?` (subiekt-bridge-orders.types.ts:19-44) -> Subiekt `WartoscBruttoPrzedRabatem/PoRabacie` | YES - the pair already exists; today fed only by an order-level split (subiekt-order-processor.adapter.ts:278-302). A per-line list price would feed `wartoscBrutto = list × qty`, `PoRabacie = paid × qty`. | yes (bridge-side, unverified) |
| Subiekt nexo | `BridgeLine` same shape (libs/integrations/subiekt-nexo/src/bridge/subiekt-bridge.types.ts:90-96) | No. | ? |

### 3.4 How an adapter should DECLARE it (ADR-046 / ADR-082 pattern)

Precedent: `ReceiptLineNameBudget` (libs/core/src/fiscalization/domain/ports/capabilities/receipt-line-name-budget.capability.ts:21-36) - optional sub-capability, method-probe guard, synchronous, core folds answers with a pure combiner in `sales-documents` and has a conservative fallback.

```ts
// libs/core/src/sales-documents/domain/types/line-rebate-rendering.types.ts  (neutral, pure)
export const ZeroPaidLinePolicyValues = ['allowed', 'refused', 'refused-when-rate-bucket-empty'] as const;
export type ZeroPaidLinePolicy = (typeof ZeroPaidLinePolicyValues)[number];

export interface LineRebateRendering {
  /** The document can show a list price and a per-line rebate (FA(3) P_10, Subiekt PrzedRabatem/PoRabacie, eparagony rebatesMarkups). */
  readonly perLineRebate: boolean;
  /** Largest rebate it accepts, as a fraction of the line list value; 1 = a full (100%) rebate. Absent = 1. */
  readonly maxRebateFraction?: number;
  /** What it does with a line whose PAID value is 0. */
  readonly zeroPaidLine: ZeroPaidLinePolicy;
}
/** Fallback when an adapter declares nothing: paid price only, zero lines allowed (today's behaviour). */
export const UNDECLARED_LINE_REBATE_RENDERING: LineRebateRendering = { perLineRebate: false, zeroPaidLine: 'allowed' };

// libs/core/src/invoicing/domain/ports/capabilities/invoice-line-rebate.capability.ts
export interface InvoiceLineRebateRenderer { getLineRebateRendering(): LineRebateRendering; }
export function isInvoiceLineRebateRenderer(a: InvoicingPort): a is InvoicingPort & InvoiceLineRebateRenderer {
  return typeof (a as Partial<InvoiceLineRebateRenderer>).getLineRebateRendering === 'function';
}
// same in fiscalization: FiscalLineRebateRenderer / isFiscalLineRebateRenderer
```

Core decision is a pure function in `sales-documents` (leaf, zero sibling edges kept):

```ts
export type FreeLineTreatment =
  | 'render-rebate'        // list + per-line rebate (adapter declared perLineRebate)
  | 'paid-price-only'      // drop the list price, print what was paid (incl. 0) - today's behaviour
  | 'omit-zero-line'       // receipt: registers what was paid (ADR-082 decision 7 precedent)
  | 'fold-into-paid-line'  // move gift VALUE onto a paid line: OPERATOR OPT-IN ONLY (tax adviser), never a default
  | 'refuse';              // named refusal, order held for the operator

export function planDocumentLineReductions(input: {
  lines: readonly DocumentLineDraft[];     // carries listUnitPriceGross?, unitPriceGross, taxRate, free evidence
  rendering: LineRebateRendering;
  kind: 'invoice' | 'fiscal-receipt';
  operatorPolicy?: { freeLines?: 'show' | 'omit-on-receipt' | 'fold' };  // config.freeLinesOnDocuments, ADR-082 shape
}): { lines: DocumentLineDraft[]; treatment: FreeLineTreatment; reason?: string };
```
Rules: rebate rendering never changes Σ paid (invariant kept); `zeroPaidLine = 'refused-when-rate-bucket-empty'` is evaluated per rate AFTER delivery split; `fold` exists only behind explicit operator config.

---

## 4. Bundle on documents

- **Decision lives in `sales-documents`** (pure, beside `splitShippingAcrossRates` / `spreadDeliveryAcrossLines`): `resolveBundleDocumentLines(line, bundleSnapshot, mode)`, `mode: 'set' | 'components' | 'auto'` (D3c). `auto` = one line when every component shares one rate, components when rates differ (one line cannot carry two rates; same reason ADR-082 forbids one delivery name at two rates).
- **In-set price split** is data, not computation: the OL bundle definition fixes per-component in-set prices (D3a) and core SNAPSHOTS them on the order line at ingestion (B-10), so documents reproduce from the order alone and no country rule enters core. When the channel's paid set price differs from Σ in-set prices (channel promo), distribute the paid amount proportionally to in-set prices with largest-remainder in minor units (`distributeOrderDiscount` shape, order-discount-split.types.ts:45). Same divisibility problem as `spread` (delivery-line.types.ts:556-590): unit price × qty must divide; fallback = keep a quantity-1 split line, else emit `set` mode or refuse with a named reason.
- Per component line: `orderLineId` = parent commercial line id + new `componentKey` so return-correction matching (#3312) can credit a single returned component at its in-set price.
- A component at in-set price 0 (gift as component, D3d) goes through the same free-line planner.

---

## 5. Proposed staged contract change

**Rules kept:** source-compatible widening (#2368/#2219): every member optional, absent has one stated meaning, never `0`; `price`/`unitPriceGross` stay the PAID figure (ADR-014 decision 1, document Σ invariant); core carries reported figures and never computes tax (ADR-063 § 5); adapters own platform vocabulary, core holds closed neutral unions; document rendering is DECLARED, probed, folded, with a fallback equal to today.

### Stage 0 - fix the typing gap (no behaviour change)
```ts
// incoming-order.types.ts, IncomingOrderTotals
  /** Whole-order discount the source applied outside its lines. See OrderTotals.discountTotal. Absent = not reported, never 0. */
  discountTotal?: number;
```

### Stage 1 - commercial facts on the line (gifts G-02/03)
```ts
// incoming-order.types.ts AND order.types.ts (one nested object = one allowlist key)
export interface OrderLineCommercial {
  /**
   * Gross UNIT price before a line-level reduction, as the SOURCE reported it.
   * Absent = the source reported none - NOT "no reduction". Never derived from
   * a catalogue price (ADR-014).
   */
  listUnitPriceGross?: number;
  /** Why the line is cheaper than list. Absent = not asserted. */
  reduction?: {
    reason: OrderLineReductionReason;        // closed, neutral
    evidence: OrderLineFreeEvidence;          // how we know
  };
}
export const OrderLineReductionReasonValues =
  ['gift', 'bundle-discount', 'promotion', 'coupon', 'unknown'] as const;
export const OrderLineFreeEvidenceValues =
  ['source-flag', 'full-rebate', 'zero-price', 'nominal-price', 'operator-added', 'rule-added'] as const;

// IncomingOrderItem / OrderItem
  commercial?: OrderLineCommercial;
```
Adapter fills: Allegro `originalPrice`, Erli `unitPriceBeforeRebate`, WooCommerce `subtotal(+subtotal_tax)/qty`, PrestaShop `original_product_price`/`reduction_*`, Shoper `discount_perc` (verify), IdoSell `orderSalesMode: gift` -> `source-flag`.

### Stage 2 - composition (bundles B-04/05)
```ts
export type OrderLineComposition =
  /** The line the channel sold as a set (parent-only or parent of parent+children). */
  | { role: 'set'; groupKey: string }
  /** A part of a set the channel itself listed. `parentLineId` absent = children-only-grouped shape. */
  | { role: 'component'; groupKey: string; parentLineId?: string; quantityPerSet?: number };
// IncomingOrderItem / OrderItem
  composition?: OrderLineComposition;   // absent = an ordinary line, as today
```
Core-written (never by an adapter), at ingestion, after resolution:
```ts
export interface OrderLineBundleSnapshot {
  bundleProductId: string;                 // OL bundle definition recognised
  definitionVersion: string;
  components: ReadonlyArray<{
    componentKey: string; productId: string; variantId?: string;
    quantityPerSet: number; inSetUnitPriceGross: number; taxRate?: string;
  }>;
  channelChildLineIds?: readonly string[]; // child lines matched and therefore not fulfilled separately (D3b guard)
}
// OrderItem only
  bundle?: OrderLineBundleSnapshot;
```

### Stage 3 - fulfilment line identity (the collision fix)
```ts
// orders domain, pure
export interface FulfilmentLine {
  fulfilmentLineId: string;   // === orderLineId for an ordinary line (byte-identical keys, no backfill)
  orderLineId: string;        // commercial line
  componentKey?: string;
  productId: string; variantId?: string; quantity: number;
}
export function deriveFulfilmentLines(order: Order): FulfilmentLine[];
```
Consumers switch from `item.id` to `fulfilmentLineId` at: order-ingestion.service.ts:2239 (reservations), project-order-for-routing.ts:48 (work lines), shipment-line.service.ts:116 (shipment lines), sale-decrement key. Existing unique indexes stay valid because the key VALUE changes only for exploded components.

### Stage 4 - document lines
```ts
// InvoiceLine and FiscalTransactionLine (both optional, provider-ignorable like `unit`)
  /** Gross unit price before a per-line rebate. Absent = no rebate to show. unitPriceGross stays what was paid. */
  listUnitPriceGross?: number;
  /** Why; lets a renderer label the rebate. */
  reductionReason?: OrderLineReductionReason;
  /** Set component this line represents, with orderLineId = the set's line. */
  componentKey?: string;
```
+ `InvoiceLineRebateRenderer` / `FiscalLineRebateRenderer` sub-capabilities (§3.4) + `planDocumentLineReductions` + `resolveBundleDocumentLines` in `sales-documents`. An adapter that ignores the new fields prints exactly what it prints today.

---

## 6. Risks

1. Five-allowlist propagation (one missed allowlist = field silently lost; happened twice). Nest the fields; add a round-trip spec.
2. `fulfilment_work_lines` / `shipment_lines` uniqueness on `orderLineId` - exploding components without Stage 3 fails at insert.
3. All-or-nothing item resolution turns an unmapped bundle parent/child into `awaiting_mapping` for the whole order.
4. Analytics double counting for parent+children until `bundleRole` lands on `order_line_items`; that table has no source line id.
5. Rounding remainders land on 0.00 lines today (discount-rounding.types.ts:65-75, delivery-line.types.ts:581-587) - turns a gift into a paid line.
6. eparagony zero-bucket refusal is not guarded in `toProductLine` (eparagony-document.mapper.ts:228-290); list+100% rebate does NOT fix it (bucket still nets 0) - needs omit/fold/refuse decision.
7. `fold-into-paid-line` changes the VAT base per rate: tax-adviser sign-off, operator opt-in only.
8. Operator discount (#3543) rewrites unit price; combining with a source rebate on one line needs one combined rebate or a refusal for renderers with one rebate slot.
9. Subiekt-as-source positional line ids (`${id}-${index}`) are already unstable; any line-keyed feature inherits that.
10. Allegro `productSet` contents are on the offer, not the checkout form - recognition needs an offer/product read (rate-limit cost) or an OL definition keyed by offer id.
11. Shoper emits no `discountTotal` and its `subtotal = sum - shipping` hides discounts; unverified fields (`discount_perc`, `type`, `children`) need a live read.

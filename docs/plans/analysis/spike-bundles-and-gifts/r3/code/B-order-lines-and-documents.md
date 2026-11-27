# R3 code design B - order line data path and sales documents (blind)

Angle: how an order line travels from a source adapter to an invoice / fiscal receipt, where bundle
("zestaw") and free-gift ("gratis") facts would have to live, and what breaks when one bought line
becomes several physical lines. Read-only; all code refs are `file:line` against the worktree at
`9e35aec9d`. Paths are relative to the repo root; `core` = `libs/core/src`, `int` = `libs/integrations`.

Sources read: ADR-014, ADR-026, ADR-042, ADR-063, ADR-082; architecture-overview § Orders /
Invoicing / Fiscalization / Sales Documents; the code below. External primary source: Allegro public
API spec `https://developer.allegro.pl/swagger.yaml` (downloaded 2026-11-04, quotes below). Erli: the
in-repo sandbox spec `docs/architecture/adrs/erli-sandbox-swagger.json`. Shoper REST docs are behind a
login (WebFetch returned the sign-in page) - Shoper fields beyond what the code models are **Unknown**.

---

## 1. Neutral order-line types and the line data path

### 1.1 Types

| Type | Where | Line-relevant fields today |
|---|---|---|
| `IncomingOrderItem` | `core/orders/domain/types/incoming-order.types.ts:163-226` | `id`, `productRef` (offer/variant/product/sku union, `:231-235`), `quantity`, `price`, `sku?`, `unitPriceGross?` (`:186`), `name?`, `imageUrl?`, `taxRate?` (`:219`), `taxRateCountry?` |
| `IncomingOrderTotals` | `incoming-order.types.ts:237-271` | `subtotal, tax, shipping, total, currency, taxTreatment?, totalTaxTreatment?, shippingGross?, shippingTaxRate?` (**no `discountTotal` on the incoming type** - Allegro/PS still set it, see 2) |
| `OrderItem` | `core/orders/domain/types/order.types.ts:254-357` | `id, productId, variantId?, quantity, price, sku?, unitPriceGross?, name?, imageUrl?, taxRate?, taxRateCountry?, taxSource?, taxRateReadAt?, taxRateChannel?` |
| `OrderTotals` | `order.types.ts:367-466` | as incoming + `discountTotal?` (`:465`) - "Carried, never acted on ... it does not know which lines it belonged to" (`:453-457`) |
| `OrderCreate` | `core/orders/domain/types/order-processor.types.ts:42-79` | `items: OrderItem[]` (`:79`) - destinations get the SAME line type, so any new `OrderItem` field is visible to destination adapters |
| `order_line_items` row | `core/orders/infrastructure/persistence/entities/order-line-item.orm-entity.ts:21-108` | `UNIQUE(orderRecordId, lineNumber)` (`:21`), `productId, variantId, quantity, unitPrice, taxRate, taxSource, unitCostNet, costState`; **no source line id column** |
| Draft projection | `core/orders/domain/order-analytics-projection.ts:56-122` | `lineNumber` = array index (`:100-106`), `unitPrice = item.price` |
| Discount split | `core/orders/domain/types/order-discount-split.types.ts:45-80` | `distributeOrderDiscount`: proportional by line gross, remainder on largest; returns `null` when `discount >= line sum` - "a caller must refuse rather than record a free sale" (`:39-40`) |
| Operator discount plan | `core/orders/domain/types/order-discount.types.ts:56-61, ~165-220` | per-line plan keyed `orderItemId: line.id`; rewrites `unitPriceGross`/`price` |
| Edit overlay | `core/orders/domain/types/order-edits.types.ts:75-95` | `lines?: Record<OrderItem.id, {quantity}>` (`:91`); `readSnapshotItems` keeps raw fields (`:350-360`) |
| Discount rounding | `core/sales-documents/domain/types/discount-rounding.types.ts:41-93` | may SPLIT a goods line into `q-1` + `1` (`:85-91`) |

### 1.2 The path, and the four allowlists that silently drop fields

1. Adapter -> `IncomingOrderItem` (section 2).
2. `OrderIngestionService` step 3, `core/orders/application/services/order-ingestion.service.ts:561-603`:
   one `tryResolve(productRef)` per incoming item -> exactly one `OrderItem` with `id: item.id`
   (`:584-602`). **Allowlist #1** - a new field on `IncomingOrderItem` is dropped here unless copied.
3. `buildUnifiedOrder` (`:2374-2407`) - totals copied wholesale (`totals: incoming.totals`, `:2390`).
4. Snapshot writer `persistOrder`, `core/orders/application/services/order-record.service.ts:189-224`
   - **allowlist #2**; its own comment records that this exact list "lost a field" twice (taxRate,
   then `unitPriceGross`, `:217-223`).
5. Snapshot reader `readItems`, `core/orders/domain/order-from-ready-snapshot.ts:250-290` -
   **allowlist #3** ("This function is an ALLOWLIST, so a field omitted here is silently dropped",
   `:266-272`). Every manual issuance path rehydrates through it.
6. Destination mapping `OrderSyncService`, `core/orders/application/services/order-sync.service.ts:296-320`
   - **allowlist #4**.
7. Documents: `toIssueInvoiceCommand` (`core/invoicing/application/mappers/order-to-issue-invoice-command.mapper.ts:103-160`)
   and `toRegisterTransactionCommand` (`core/fiscalization/application/mappers/order-to-register-transaction-command.mapper.ts:109-145`).

Consequence for any design: a new line field must be added in **four** allowlists plus both document
mappers, or it vanishes on one path and not the other (the documented #2245/#3365 failure shape).

### 1.3 Where new fields would go

| Fact | Natural home | Notes |
|---|---|---|
| Composition (bundle -> components) | `IncomingOrderItem.composition?` (source-declared) and `OrderItem.composition?` (resolved, snapshotted) | Allegro already reports it (2.1); otherwise from OL catalogue at ingestion, frozen like `taxRate` (ADR-014 amendment arg. 4: "A rate snapshotted at ingestion is a fiscal fact about the sale") |
| List price | `IncomingOrderItem.listUnitPriceGross?` -> `OrderItem` | Allegro `originalPrice`, Erli `unitPriceBeforeRebate`, WooCommerce `subtotal` all reported and dropped today |
| Discount amount + reason | `OrderItem.discounts?: OrderLineDiscount[]` | reason as an open string kind + source code; Allegro `discounts[].type`, Erli `rebate {name,code}` |
| Free-line evidence | `OrderItem.freeOfCharge?` with an evidence discriminator | never inferred from `price === 0` alone without saying so |
| Line-level discount on a document | `InvoiceLine.listUnitPriceGross?` + `InvoiceLine.unitDiscountGross?` | only rendered if the provider declares it (section 3.4) |

---

## 2. Per source adapter: what the line mapper reads and ignores

### 2.1 Allegro
- Reads: `lineItems[].id, offer.id, offer.name, quantity, price.amount, tax, boughtAt`
  (type `int/allegro/src/domain/types/allegro-api.types.ts:75-106`; mapper
  `int/allegro/src/infrastructure/adapters/allegro-order-source.adapter.ts:998-1016`). `sku` is set to
  `offer.id` (`:1009`), not to the seller's own `offer.external.id`.
- Order-level discount derived as a residual `subtotal + shipping - total` (`:970-971`).
- Ignored, though the API reports it (Allegro swagger `CheckoutFormLineItem`):
  - `originalPrice` (required field) - list price.
  - `discounts[].type` - quote: "`BUNDLE` - a bundle discount (used also for bundles with no price
    change)", plus `UNIT_PERCENTAGE_DISCOUNT`, `WHOLESALE_PRICE_LIST`, `LARGE_ORDER_DISCOUNT`,
    `TURNOVER_DISCOUNT`, `COUPON`, `CAMPAIGN` (schema `LineItemDiscount`). **Type only, no amount.**
  - `offer.productSet.products[{id, quantity}]` - quote: "If the offer was a product set, you can see
    a list of component products (product id with quantity)." (schema `OfferProductSetReference`).
    Component ids are Allegro catalogue product UUIDs, not offer ids - OL has no mapping for those today.
  - `offer.external.id`, `vouchers`, `reconciliation`, `deposit` ("If the offer consists of multiple
    products with different deposits, the value in this field is the sum of those deposits"),
    `selectedAdditionalServices`, `serialNumbers`.

### 2.2 Shoper
- Reads `id, product_id, stock_id, price, quantity, name, code, tax, tax_value`
  (`int/shoper/src/domain/types/shoper-api.types.ts:533-546`; `mapLine`
  `int/shoper/src/infrastructure/mappers/shoper-incoming-order.mapper.ts:288-303`). `ean` is typed
  but not mapped.
- Anything else on Shoper order-product rows (discount, bundle/zestaw marker, options) is **Unknown**:
  not modelled, and the vendor docs could not be read (login wall).

### 2.3 PrestaShop
- Mapper reads `id, product_id, product_attribute_id, product_quantity, product_price (net),
  unit_price_tax_incl, product_reference` (`int/prestashop/src/infrastructure/mappers/prestashop-order.mapper.ts:58-87`;
  row type `prestashop.mapper.interface.ts:171-191`, index-signature for the rest).
- Order-level `total_discounts_tax_incl` -> `discountTotal` (`prestashop-order.mapper.ts:140-144`).
- The adapter re-pairs rows **positionally** (`prestashop-order-source.adapter.ts:604-628`) and
  **drops `name`** (no `name` in the returned item), so PS lines print `sku`/`productId` on documents.
- Ignored: per-row reduction fields, original price, product name, any pack (PS "pack") marker -
  exact field names (unverified; not in the code's typed shape).

### 2.4 WooCommerce
- Reads `id, name, product_id, variation_id, quantity, sku, price, total, total_tax, image`
  (`int/woocommerce/src/infrastructure/adapters/woocommerce-order-source.adapter.ts:352-405`).
  `unitPriceGross = (total + total_tax) / quantity` - post-discount (`:383-385`).
- Ignored: `subtotal` (typed "pre-discount line total", `order-source/woocommerce-order.types.ts:108`)
  = the list price; line `meta_data` (where bundle/composite plugins mark parent/child lines -
  (unverified)); `coupon_lines`. Note a conflict: the adapter comment calls `price` "the pre-discount
  unit price" (`:385`); WooCommerce's own semantics of `price` were not verified here.

### 2.5 Erli
- Reads `id, externalId, quantity, unitPrice, sku, name, taxRate`
  (`int/erli/src/infrastructure/adapters/erli-order.mapper.ts:203-211`).
- Ignored: `unitPriceBeforeRebate` - typed (`erli-order.types.ts:74`) and in the spec
  (`"unitPriceBeforeRebate": {"type": "integer"}`); order-level `rebate` object
  (`{"id","name","code": "tylko w przypadku jednorazowych kodów"}`) - the promotion's name/reason;
  `ean, slug, weight`.

### 2.6 Subiekt GT (as order source)
- Reads `symbol, nazwa, ilosc, wartoscBrutto` (`int/subiekt/src/infrastructure/adapters/subiekt-order-source.adapter.ts:146-153`;
  bridge type `int/subiekt/src/bridge/subiekt-bridge-orders.types.ts:167-172`). That is all the bridge
  exposes: no rabat, no rate, no komplet structure.
- Line id is **synthesised positionally**: `` `${detail.id}-${index}` `` (`:147`) - unstable if the
  document's lines change.

### Summary table

| Adapter | List price | Line discount | Discount reason | Composition | Free marker |
|---|---|---|---|---|---|
| Allegro | reported, ignored | implicit (orig-price), ignored | `discounts[].type` ignored | `offer.productSet` ignored | none in spec (gift = Unknown) |
| Shoper | Unknown | Unknown | Unknown | Unknown | Unknown |
| PrestaShop | not read | not read (row reductions) | order-level only (`total_discounts`) | not read | price 0 passes through |
| WooCommerce | `subtotal` ignored | `subtotal-total` ignored | `coupon_lines` ignored | plugin meta (unverified) | price 0 passes through |
| Erli | `unitPriceBeforeRebate` ignored | derivable, ignored | `rebate.name/code` ignored | none in spec | none in spec |
| Subiekt GT | not exposed | not exposed | not exposed | not exposed | n/a |

---

## 3. Sales documents

### 3.1 Line types
- `InvoiceLine` (`core/invoicing/domain/types/invoicing.types.ts:443-528`): `name, quantity,
  unitPriceGross, taxRate, unit?, productId?, variantId?, orderLineId?` (`:501`), `gtuCode?,
  procedureCode?`. **No list price, no discount, no parent/component link.**
- `FiscalTransactionLine` (`core/fiscalization/domain/types/fiscalization.types.ts:222-253`): `name,
  productId?, quantity, unitPriceGross, taxRate, sku`. **No `orderLineId`, no `variantId`** - so a
  receipt line cannot be traced back to a component line.

### 3.2 Mappers
- `toInvoiceLine` (`order-to-issue-invoice-command.mapper.ts:359-385`) and `toFiscalLine`
  (`order-to-register-transaction-command.mapper.ts:267-288`) are strictly **1 order item -> 1 line**,
  refuse only `quantity <= 0`; `unitPriceGross 0` is accepted.
- Gross-only guard via `describeNetPricedOrderRefusal` (`:125-128` / `:124-127`): every line must carry
  a gross figure.
- Delivery: `applyDelivery` -> `spreadIntoProductLines` / `deliveryLinesFor` (`:422-500`); mixed rates
  split by `splitShippingAcrossRates`; `fixed` / `spread` per ADR-082. Shipping lines carry no
  `orderLineId` (`:419-421`).
- Discount rounding: `reconcileDiscountRounding` only when `discountTotal > 0`, may split one goods
  line into two lines **sharing one `orderLineId`** (`discount-rounding.types.ts:85-91`).
- Reconciliation: `assertLinesSumToTotal` with a quantity-scaled epsilon (invoice `:304-340`, fiscal
  `:214-255`); a whole-order discount the lines do not carry is refused, because "FA(3) can only express
  a discount per line (`P_10` appears once, inside `FaWiersz`), so folding it would mean inventing an
  attribution" (`:296-300`).

### 3.3 Per-line rebate per document adapter

| Adapter | Can the target express a per-line rebate? | Does OL emit it today? | Evidence |
|---|---|---|---|
| KSeF FA(3) | **Yes** - `P_10` "Kwoty wszelkich opustów lub obniżek cen ... o ile nie zostały one uwzględnione w cenie jednostkowej" | **No** - `P_10` absent from `FA3_FA_WIERSZ_CHILD_ORDER` | XSD `int/ksef/src/infrastructure/fa3/schema/schemat_fa3_v1-0e.xsd:3149-3152`; `fa3-xml.types.ts:291-305` |
| inFakt | Unknown (API) | No - request row is `{name, tax_symbol, quantity, unit, unit_net_price}` | `int/infakt/src/domain/types/infakt.types.ts:206-212`; built at `infakt-invoicing.adapter.ts:662-668` |
| eparagony (receipt) | Whole-receipt only in the modelled vendor types (`REBATE` line, no rate, device distributes proportionally); per-line Unknown | Only as a balancing whole-receipt rebate | `int/eparagony/src/domain/types/eparagony-api.types.ts:46-71`; `eparagony-document.mapper.ts:95-106` |
| Subiekt GT (FS) | Subiekt has the pair `WartoscBruttoPrzedRabatem/PoRabacie` on ZK; FS bridge line is `cenaBrutto` only | ZK: yes (order-level split per line); FS: no | `int/subiekt/src/bridge/subiekt-bridge-orders.types.ts:32-43`; `subiekt-order-processor.adapter.ts:278-300`; `subiekt-line.mapper.ts` header `:1-10` |
| Subiekt nexo | Unknown | No - `ilosc, cenaBrutto, stawkaVAT` only | `int/subiekt-nexo/src/infrastructure/mappers/subiekt-line.mapper.ts:91-93` |

### 3.4 How they should declare it
Follow the shipped declared-capability shape (`ReceiptLineNameBudget`,
`core/fiscalization/domain/ports/capabilities/receipt-line-name-budget.capability.ts:21-36`; ADR-046
probe-not-trust): one optional synchronous method per port, read with a `typeof ... === 'function'`
guard, absent = conservative default.

```ts
// sales-documents (leaf) - shared by InvoicingPort and FiscalizationPort adapters
export interface DocumentLineFeatures {
  /** 'native': prints list price + rebate per line. 'folded': only the net-of-rebate unit price. */
  lineRebate: 'native' | 'folded';
  /** Whether a line with unitPriceGross 0 is accepted. 'unknown' => core never sends one. */
  zeroValueLine: 'accepted' | 'refused' | 'unknown';
  /** Whether a line may reference a parent line (kit header + components). */
  componentGrouping: 'native' | 'none';
}
export interface DocumentLineFeaturesDeclarer {
  getDocumentLineFeatures(): DocumentLineFeatures; // sync, side-effect free
}
// absent => { lineRebate: 'folded', zeroValueLine: 'unknown', componentGrouping: 'none' }
```
`folded` reproduces today's behaviour exactly, so the change is source-compatible. KSeF would declare
`native` only after `P_10` is emitted and sandbox-verified.

---

## 4. Bundle on documents

- **One line (bundle name, one price)** works only if the bundle has ONE VAT rate. `resolveLineTaxRate`
  runs per `OrderItem` against the bundle's own product (`order-ingestion.service.ts:567-571`); a
  mixed-VAT bundle has no single honest rate, so the document is held (ADR-063: "A missing rate is a
  blocking business failure").
- Fiscal printers bind a NAME to ONE rate and permanently lock a name whose rate goes back up (ADR-082
  Context; Dz.U. 2024 poz. 1654 cited there). A bundle printed under one name with a rate that depends
  on its contents is exactly that hazard; `assertNoNameSharedAcrossRates`
  (`eparagony-document.mapper.ts:206-`) would refuse a within-receipt clash but not a cross-receipt one.
- **Components** are therefore mandatory for a mixed-VAT bundle on both invoices and receipts, and are
  also what moves stock in Subiekt: an `InvoiceLine` without a resolvable catalogue symbol becomes a
  "usługa jednorazowa" that moves no stock (`subiekt-line.mapper.ts:12-24`).
- Splitting the bundle price across components is **division, not tax computation** (ADR-063 § 5
  permits grouping and dividing). It needs a per-component allocation key that is DATA (a reference
  price or share frozen at ingestion, from the source or the OL catalogue); remainder to the largest
  part, the `splitShippingAcrossRates` / `distributeOrderDiscount` rule. No key => hold the document,
  never an equal split.
- Rendering choice per line: `components` forced when component rates differ; otherwise operator /
  connection choice. With `componentGrouping: 'none'` the provider just receives flat component lines.
- Return corrections: each component document line needs its own id, or `indexSnapshotByOrderLineId`
  (`core/returns/domain/domain-services/return-correction-matching.domain-service.ts:178-204`) returns
  several candidates and the line falls to `no-match('ambiguous-invoice-line')`.

---

## 5. Things keyed on the order line id (break if a bundle line becomes several lines sharing an id)

| # | Consumer | Key | Ref |
|---|---|---|---|
| 1 | Reservations | `UQ(orderRecordId, orderLineId, inventoryItemId)`; input carries ONE `productVariantId` per line | `core/inventory/infrastructure/persistence/entities/reservation.orm-entity.ts:55`; `order-ingestion.service.ts:2236-2243` |
| 2 | Routing / work lines | `UQ(fulfillmentWorkId, orderLineId)`; one variant per line | `core/fulfillment/infrastructure/persistence/entities/fulfillment-work-line.orm-entity.ts:41`; `core/orders/domain/project-order-for-routing.ts:46-53` |
| 3 | Sale decrement / reversal | `sale:{owner}:{workId}:{orderLineId}`, `sale-reversal:...`, `edit:{changeId}:{orderLineId}`; `UQ(idempotencyKey)` | `core/inventory/domain/types/inventory-sale-decrement.types.ts:130,140,184,319`; `inventory-sale-decrement.orm-entity.ts:33` |
| 4 | Shipment lines | `UQ(shipmentId, orderId, lineId)` | `core/shipping/infrastructure/persistence/entities/shipment-line.orm-entity.ts:49`; reader `shipment-line.service.ts:111-119` |
| 5 | Edit overlay | `lines` keyed by `OrderItem.id` | `order-edits.types.ts:91, 252-266` |
| 6 | Amendment diff | `item.id` | `core/orders/domain/order-amendment-diff.ts:153-182` |
| 7 | Operator discount plan | `orderItemId: line.id` | `order-discount.types.ts` (plan build ~`:169-176`, apply `:211-214`) |
| 8 | Invoice snapshot / return correction | `InvoiceLine.orderLineId`; already duplicated by discount rounding | `invoicing.types.ts:501`; `discount-rounding.types.ts:85-91` |
| 9 | Return line resolution | matches return line by `sku`/`offerId` to snapshot items | `core/returns/domain/domain-services/return-order-line-resolution.domain-service.ts:40-81, 113-116` - a returned bundle (by offerId) matches the parent, never a component |
| 10 | Analytics rows | `UQ(orderRecordId, lineNumber)` positional; cost carry-forward keyed `productId\|variantId` | `order-line-item.orm-entity.ts:21`; `order-line-cost-snapshot.ts:80-110` - a gift and a paid line of the same variant collide on cost |
| 11 | Subiekt source ids | positional `${detail.id}-${index}` | `subiekt-order-source.adapter.ts:147` |
| 12 | PrestaShop pairing | positional row pairing | `prestashop-order-source.adapter.ts:604-606` |

Design rule derived from this table: **the source line id must stay the id of the commercial line;
component (physical) lines need their own deterministic ids**, never a reused parent id.

---

## 6. Staged contract proposal (source-compatible)

### Stage A - carry what sources already report (no behaviour change)
```ts
// incoming-order.types.ts and order.types.ts (both), all OPTIONAL
export interface OrderLineDiscount {
  /** Open-world neutral kind; adapters map their own vocabulary. */
  kind: 'promotion' | 'coupon' | 'bundle' | 'volume' | 'free-item' | (string & {});
  /** Gross amount of this discount on the WHOLE line. Absent = source named the discount but not its amount. */
  amountGross?: number;
  /** Source label / campaign name, verbatim (display only). */
  label?: string;
  /** Source's own code (coupon code, rebate id). */
  sourceCode?: string;
}

interface OrderItem /* & IncomingOrderItem */ {
  /** Gross unit price BEFORE line discounts, as the source reported it. Absent = not reported (never "no discount"). */
  listUnitPriceGross?: number;
  /** Discounts the source attributes to THIS line. Absent = not reported; [] = source asserted none. */
  discounts?: OrderLineDiscount[];
  /**
   * The source states this line is free of charge. Absent = not asserted.
   * 'zero-price' is OL's observation of price 0 and is reported as such, never as a source claim.
   */
  freeOfCharge?: { evidence: 'source-flag' | 'zero-price' | 'operator'; ruleRef?: string };
}
```
Mapping: Allegro `originalPrice`, `discounts[].type` (amount = `originalPrice - price` only when
exactly one discount); Erli `unitPriceBeforeRebate` + order `rebate.name/code`; WooCommerce `subtotal`
(gross needs `subtotal_tax`, unverified). Must be added to all four allowlists (1.2) in one change.

### Stage B - composition as a resolved, frozen fact
```ts
export interface OrderLineComponent {
  /** Deterministic: `${parentLineId}~${index}`; stable across re-ingestion because the composition is frozen. */
  id: string;
  productId: string;
  variantId?: string;
  /** Units of this component per ONE unit of the parent line. */
  quantityPerUnit: number;
  sku?: string;
  name?: string;
  taxRate?: string;          // resolved per component, same rules as OrderItem.taxRate
  /** Allocation weight for splitting the parent price (reference gross price). Absent = cannot split. */
  allocationWeight?: number;
}
interface OrderItem {
  /** Absent = an ordinary line. Present = a kit; `price` stays the parent's buyer-paid price. */
  composition?: {
    origin: 'source' | 'catalogue';
    components: OrderLineComponent[];
    resolvedAt: string;
  };
}
// IncomingOrderItem gets a source-side variant with IncomingOrderItemRef per component.
```
One helper decides the physical view and every stock/fulfilment consumer (rows 1-4 of section 5)
calls it instead of `order.items`:
```ts
export function physicalLinesOf(order: Order): Array<{ lineId: string; parentLineId?: string; productId: string; variantId?: string; quantity: number }>;
```
Commercial consumers (analytics revenue, discount plan, edits, amendment diff, refund ceiling) stay on
`order.items`. `order_line_items` keeps one row per commercial line (no double-counted revenue).

### Stage C - documents
```ts
interface InvoiceLine {
  listUnitPriceGross?: number;      // only when provider declares lineRebate 'native'
  unitDiscountGross?: number;
  parentOrderLineId?: string;       // set on component lines; orderLineId = component id
}
interface FiscalTransactionLine {
  orderLineId?: string;             // new, mirrors InvoiceLine
  variantId?: string;
}
```
Pure function `expandBundleForDocument(item, features)`: one line when the bundle has a single rate
and the operator chose so; otherwise component lines with prices from `allocationWeight`, exact in the
currency minor unit, remainder on the largest part; refuse (hold, named reason) when any weight or
component rate is missing. Gifts: emitted as a zero line only when `zeroValueLine === 'accepted'`;
otherwise the free item is omitted from the fiscal document and recorded on the order (legal treatment
of free items - (unverified), out of core).

---

## 7. Risks

1. **Allowlist drift** - four copy points (1.2); the repo has already shipped this bug twice.
2. **Line-id reuse** - any design that gives components the parent id breaks unique indexes 1-4 and
   makes return-correction matching ambiguous; also the pre-existing duplicate from discount rounding.
3. **Allocation is a policy, not arithmetic** - who sets component weights (source? catalogue?
   operator?) decides tax per component on a legal document; an equal split must never be a default.
4. **Composition drift** - a catalogue edit after the sale must not re-explode an old order; freeze at
   ingestion (`resolvedAt`) like `taxRate`.
5. **Fiscal name locking** (ADR-082) - bundle names or component names whose rate changes can lock a
   printer name permanently.
6. **Allegro productSet ids** are Allegro catalogue UUIDs; OL has no mapping from them to its variants,
   so `origin: 'source'` cannot be resolved without a new mapping kind.
7. **Destination path** - `OrderCreate.items` is `OrderItem[]`; PrestaShop/WooCommerce/Subiekt must
   decide whether to receive the kit (their own pack/komplet, unverified behaviour) or the components,
   and ADR-014 Decision 1 (price lines at `items[].price`) needs a rule for component prices.
8. **Gift on documents** - 0-value lines: invoice mapper accepts; device/vendor acceptance on receipts
   Unknown; ADR-082 decision 7 already says a receipt never carries a zero DELIVERY line.
9. **Discount arithmetic** - `distributeOrderDiscount` refuses `discount >= line sum` (whole-order
   gift); `reconcileDiscountRounding` acts only when `discountTotal > 0`. A line-level rebate must not
   be double counted with `discountTotal` (Allegro's residual already includes it).
10. **Subiekt GT source** exposes too little (no rabat, positional ids) to participate until the bridge grows.

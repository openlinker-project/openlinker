# A. Capability design for bundles ("zestawy") and free gifts ("gratisy")

Angle: the capability system itself. Read-only research, 2026-11-04, worktree
`zestawy-gratisy-rekonesans-c15354`. All paths relative to repo root.

Finding up front: core today has NO bundle/gift/rebate vocabulary at all
(`grep -riE "bundle|rebate|gift|komplet" libs/core/src` hits only unrelated
files). Everything below is greenfield, but it must be shaped like the 70+
sub-capabilities that already exist.

---

## 1. How a sub-capability is declared today

### 1.1 The mechanics (ADR-002)

- A base port carries only what EVERY adapter of the role must do; optional
  behaviour is an independent interface in `domain/ports/capabilities/*.capability.ts`
  with a co-located `is{Capability}(adapter)` guard
  (docs/architecture/adrs/002-capability-ports-with-sub-capabilities.md:13-19, :32).
- Naming: drop the `Port` suffix ("they layer onto ... they are not independent
  top-level ports") - modified-product-lister.capability.ts:11-14.
- The guard is a structural METHOD PROBE, e.g.
  `typeof adapter.listExternalIdsModifiedSince === 'function'`
  (modified-product-lister.capability.ts:72-78). A guard may be generic over the
  adapter type instead of bound to one port (return-source-reader.capability.ts:101-108,
  order-status-writeback.capability.ts:41) - used when the capability belongs
  to more than one port, or when binding it would import a forbidden sibling
  (self-routing-document-kind.capability.ts: "DELIBERATELY NOT bound to a single
  base port ... generic form below needs no import at all").

### 1.2 Three dispatch postures

| Posture | What it means | Evidence |
|---|---|---|
| Dispatched | Name in `CoreCapabilityValues` (or open-world string) AND in a plugin's `dispatchCapability` table; resolved with `getCapabilityAdapter(connectionId, name)` | libs/core/src/integrations/domain/types/adapter.types.ts:38-89 ("A name enters this array iff a call site resolves it BY CONNECTION ID", :23); libs/plugin-sdk/src/dispatch-capability.ts:62-85 |
| Advertised-without-dispatch | Name listed in manifest `supportedCapabilities` for host/FE discovery only; resolved ONLY by narrowing the already-dispatched base adapter with the guard | libs/integrations/allegro/src/allegro-plugin.ts:77-125 (CategoryBrowser, OfferCreator, ReturnSourceReader, ReturnDecliner); a `getCapabilityAdapter(id,'ReturnSourceReader')` passes the manifest gate then throws in `dispatchCapability` (allegro-plugin.ts:111-118) |
| Guard-only | Not in any manifest, not in `CoreCapabilityValues`; only narrowing | modified-product-lister.capability.ts:16-23; bulk-product-reader.capability.ts:26-30; product-tax-rate-reader.capability.ts header; fulfillment-status-source.capability.ts:9-15 |

Why guard-only became the default for new rungs: `enabledCapabilities` is
stamped at connection create and never retro-filled (#2085), so an advertised
name INVITES a later gate that "would silently drain nothing for every
connection that already exists" (modified-product-lister.capability.ts:19-23;
adapter.types.ts:29-34).

### 1.3 ADR-046 probe-not-trust

A declaration method may be typed REQUIRED on the interface and still be
probed, because an out-of-tree plugin compiled against an older `libs/core`
satisfies an older guard and would throw at call time
(libs/core/src/listings/application/services/description-format-resolution.ts:14-25,
:41-53). Missing declaration -> a CONSERVATIVE fallback, never a permissive guess,
and the fallback is resolved SERVER-SIDE with a `declared` flag
(docs/architecture/adrs/046-adapter-declared-description-format.md:51; amendment
:88-92 adds `resolvedVia` so "undeclared" and "unresolvable" are different facts).

### 1.4 Closest precedents and what each teaches

| # | Precedent | File:line | Lesson for bundles/gifts |
|---|---|---|---|
| 1 | `ReceiptLineNameBudget` (+ `combineReceiptLineNameLimits`, `resolveReceiptLineNameLimit`) | fiscalization/.../receipt-line-name-budget.capability.ts:21-36; sales-documents/domain/types/delivery-line.types.ts:84-160; apps/api/src/integrations/application/services/resolve-receipt-line-name-limit.ts:29-61; ADR-082:18 | A device/regime constraint is DECLARED as a synchronous pure value; core holds no number of its own; invalid declarations ignored (an adapter bug must not shrink everything); fallback equals the most restrictive shipped value and is reported `declared:false`; fold = most-restrictive-wins when one artefact must fit several connections. Direct model for the rebate/zero-line budget (e). |
| 2 | `OrderCreateStockEffect` + `lowersStockOnOrderCreate()` | orders/.../order-create-stock-effect.capability.ts:20-60; consumed order-sync.service.ts:397 | Boolean-ish declaration wrapped in a helper that treats "no method / false / throw / reject" as the SAFE default (under-sell, never over-sell). Asked AFTER the action so it can answer from a cached shop setting rather than a platform-wide claim. Model for "can this destination compute bundle stock itself". |
| 3 | `ProductTaxRateReader` | products/.../product-tax-rate-reader.capability.ts | Three-state answer (`unknown` vs a real `0` vs `inherited`): "MUST return kind:'unknown' rather than a '0'"; guard-only. Model for a master's bundle definition: `unknown` vs `not-a-bundle` vs composition. |
| 4 | `BulkProductReader` | products/.../bulk-product-reader.capability.ts:10-21, :37-56 | A rung that is a PREFETCH, "invisible except in request count"; never a second sync path, so guards do not drift. Model if a master's bundle definitions are a separate costly resource. |
| 5 | `ReturnSourceReader` (+ optional `terminalRawStatuses`) | orders/.../return-source-reader.capability.ts:26-108 | Advertised-without-dispatch for discovery; optional member amended later without changing the guard; the SOURCE's own vocabulary carried as an OPAQUE set core never interprets (:78-83). Model for carrying channel discount `type` codes verbatim. |
| 6 | `FulfillmentStatusSource` | fulfillment/.../fulfillment-status-source.capability.ts:25-50 | Method names must not collide with an existing structural guard (the `getFulfillmentStatus` near-miss): choose distinctive, port-scoped method names now while renaming is free. |
| 7 | `OfferCurrencyDeclarer` / `TaxonomyBorrower.allowsBorrowedCatalogueLookup?()` | listings/.../offer-currency-declarer.capability.ts; taxonomy-borrower.capability.ts:36 | Pure synchronous declaration, `null` = "cannot say" -> caller falls back, never guesses; optional method on an existing capability ("absent means yes/no" stated explicitly). |
| 8 | `SelfRoutingDocumentKind` | sales-documents/domain/ports/capabilities/self-routing-document-kind.capability.ts | A capability that spans BOTH document ports (Invoicing + Fiscalization) lives in `sales-documents` with a generic guard so the leaf keeps zero sibling edges. Exactly where a "line-adjustment rendering" declaration must live. |

Field-not-capability precedents (equally important, see section 3):
`IncomingOrder.fulfilledBySource?: true` (incoming-order.types.ts:93-101, "Typed
true on purpose"), three-state `buyerTaxId`, `IncomingOrderItem.unitPriceGross`
(:181-186), `IncomingOrderItem.taxRate` (:204-219), `Product.gpsr?: ProductGpsr | null`
(products/domain/entities/product.entity.ts:92-99, three states), and the
command-side `CreateOfferCommand.variantGroup: OfferVariantGroup`
(listings/domain/types/offer-create.types.ts:155-174, opaque `groupId`).

### 1.5 Contract-kit precedent (for section 5)

`libs/core/src/fulfillment/testing/*` (#2404) and
`libs/core/src/currency/testing/publication-day-contract.suite.ts`: a PURE
checker returning `ContractRunResult` + thin jest wrapper; missing subject and
empty case table THROW (contract-result.types.ts:20-80); optional members handled
by ABSENCE asserted both ways via one `expected*CaseIds(subject)` function
(fulfillment-executor-contract.suite.ts:118-160); mutation fixtures per case
(`__tests__/contract-coverage.spec.ts`). Published on `@openlinker/core/<ctx>/testing`
subpaths (libs/core/package.json:27-192; `orders/testing` and `listings/testing`
exist but hold only fixtures today).

---

## 2. Design proposal

### 2.0 Governing rule (derived from the precedents)

- **Per-entity fact the adapter already holds in a payload it returns** -> a
  neutral optional FIELD (three-state where "not asserted" differs from "none").
- **A fact about the adapter / regime / device** (what it CAN report, what it
  REFUSES, what it computes itself) -> a synchronous, pure, guard-only
  DECLARATION capability, probed per ADR-046, folded with a conservative fallback.
- **A separate I/O path or a write** -> a method capability.

Every new capability below is GUARD-ONLY (absent from `CoreCapabilityValues`
and from every manifest), for the #2085 reason. FE discovery goes through a
server-side read endpoint that returns `{ ..., declared, resolvedVia }`
(ADR-046 amendment), not through `supportedCapabilities`.

### 2.1 Neutral vocabulary (core, `orders` / `listings` / `sales-documents` types)

```ts
// orders/domain/types/order-line-composition.types.ts
export interface IncomingOrderBundleGroup {
  /** Opaque, order-scoped; adapter-minted, stable across re-ingest. Never parsed. */
  groupKey: string;
  /** The bundle's own sellable identity when the source names one (pack product, Allegro offer). */
  productRef?: IncomingOrderItemRef;
  /** How many bundles were sold. */
  quantity: number;
  name?: string;
  /** Where the money sits; drives document rendering and refund attribution. */
  pricedOn: 'group-line' | 'component-lines' | 'unknown';
  /** How the components reached us. */
  componentsReported: 'inline' | 'as-lines' | 'not-reported';
  /** Present only when componentsReported === 'inline' (Allegro productSet, PS pack row with associations). */
  components?: readonly IncomingOrderBundleComponent[];
}
export interface IncomingOrderBundleComponent {
  productRef: IncomingOrderItemRef;
  quantityPerBundle: number;
  sku?: string;
  name?: string;
}
/** On IncomingOrderItem: which group this line belongs to and in what role. */
export interface IncomingOrderLineBundleMembership {
  groupKey: string;
  role: 'group-line' | 'component';
}

// orders/domain/types/order-line-price-evidence.types.ts
export const LineDiscountKindValues = ['promotion', 'coupon', 'free-item', 'other'] as const;
export type LineDiscountKind = (typeof LineDiscountKindValues)[number];
export interface IncomingOrderLineDiscount {
  /** Gross amount off THIS line (all units), source-reported, never computed. */
  amountGross: number;
  kind: LineDiscountKind;
  /** The source's own discount type, VERBATIM, opaque to core (rawStatus rule). */
  sourceType?: string;
}
export interface IncomingOrderLinePriceEvidence {
  /** Unit gross price BEFORE line-level discounts, as the source reported it. */
  listUnitPriceGross?: number;
  discounts?: readonly IncomingOrderLineDiscount[];
  /** The source positively marks the line as given free. Typed `true` only (fulfilledBySource rule). */
  sourceMarksFree?: true;
}
```

IncomingOrderItem gains `bundle?: IncomingOrderLineBundleMembership` and
`priceEvidence?: IncomingOrderLinePriceEvidence`; IncomingOrder gains
`bundleGroups?: readonly IncomingOrderBundleGroup[]`. All optional = a
source-compatible widening (the #2219 / #2368 discipline).

The three wire shapes normalise onto ONE model:

| Wire shape | groups | lines |
|---|---|---|
| parent-only (PrestaShop pack row, Allegro `productSet.products[]`, Erli/Amazon own SKU) | `pricedOn:'group-line'`, `componentsReported:'inline'` (or `'not-reported'` -> core may resolve from master definition, 2.4) | one line, `bundle.role:'group-line'` |
| parent+children (Shoper `type:"1"` + `children[]`, Woo `bundled_by`) | `pricedOn` per source (Woo bundles often 0.00 children), `'as-lines'` | parent `'group-line'`, children `'component'` |
| children-only grouped (Shopify `lineItemGroup`, IdoSell `bundleId`) | no group line: `'component-lines'`, `'as-lines'`, header in the group | only `'component'` lines |

Core then owns a PURE rule (`*.types.ts` pure-rule exception) deriving: which
lines decrement stock, which lines a document prints, how a refund is
attributed. Adapters never decide those.

Gift classification is likewise a core pure rule over evidence, never an
adapter claim: `sourceMarksFree` -> free; `discounts` summing to the list total
-> free; `price === 0` with a list price -> free; `price` at/below an
OPERATOR-configured nominal threshold (`Connection.config`, default unset) ->
"nominal-price line" (the 0.01 case). Core never hardcodes 0.01.

### 2.2 Proposed capabilities

#### (a) `OrderLineCompositionReporter` - on `OrderSourcePort`

```ts
// orders/domain/ports/capabilities/order-line-composition-reporter.capability.ts
export interface OrderLineCompositionReporting {
  /** What this source can state about bundles on an order it returns. */
  bundles: 'reported' | 'not-reported';
  /** Shapes it emits; informs UI copy and reconciliation, never branching on platform. */
  shapes: readonly ('group-line-inline' | 'group-line-with-components' | 'components-only')[];
}
export interface OrderLineCompositionReporter {
  /** Sync, pure, no I/O. May depend on connection config (e.g. a Woo bundles plugin toggle). */
  getOrderLineCompositionReporting(): OrderLineCompositionReporting;
}
export function isOrderLineCompositionReporter<T extends object>(a: T): a is T & OrderLineCompositionReporter
```
- Dispatch: guard-only, narrowed off the dispatched `OrderSource` adapter.
  Generic guard so an `OrderProcessorManager` adapter that is also a source can
  be narrowed without a cast.
- Absence means: `bundles:'not-reported'`, i.e. an absent `item.bundle` /
  `order.bundleGroups` is "not asserted", NOT "this is not a bundle". Core may
  still resolve a sold SKU against a master bundle definition (2.4). No
  decrement-by-component unless composition is known from somewhere.
- Why a declaration and not just the field: without it core cannot tell "source
  checked, no bundles" from "source cannot tell" (ProductTaxRateReader
  `unknown` lesson) - which decides whether to fall back to master definitions.

#### (b) `OrderLinePriceEvidenceReporter` - on `OrderSourcePort`

```ts
export const LinePriceEvidenceKindValues =
  ['list-price', 'line-discounts', 'source-free-flag'] as const;
export interface OrderLinePriceEvidenceReporting {
  reports: readonly (typeof LinePriceEvidenceKindValues)[number][];
}
export interface OrderLinePriceEvidenceReporter {
  getOrderLinePriceEvidenceReporting(): OrderLinePriceEvidenceReporting;
}
```
- Dispatch: guard-only.
- Absence means: `reports: []` - only `price` is known; a 0.00 line is "zero-priced,
  reason unknown"; a 0.01 line is an ordinary line unless an operator rule says
  otherwise. Gifts "absent from the order" are out of reach of ANY source
  capability; they belong to an operator rule/automation that adds a line.
- Kept separate from (a): independent facts (Shoper reports composition but no
  discount breakdown; Allegro reports both), one capability per fact keeps
  each fallback honest.

#### (c) Master bundle definitions - FIELD first, optional rung second

Primary: `Product.composition?: ProductComposition | null` on the product the
master already returns (three states exactly like `Product.gpsr`, entity :92-99):
object = master states a bundle, `null` = master states not a bundle,
`undefined` = did not report -> the upsert leaves the column alone.

```ts
export interface ProductComposition {
  components: readonly { productId: string; variantId?: string; quantity: number }[]; // internal ids after mapping
  /** Who the master says carries stock. Opaque master modes map onto these. */
  stockModel: 'from-components' | 'own-stock' | 'both-limit' | 'unknown';
}
```
PrestaShop `associations.product_bundle` + `pack_stock_type` arrive in the same
`display=full` read, so a field costs nothing.

Optional rung, only for masters where composition is a separate resource
(Subiekt GT komplety, possibly Shoper sets):
```ts
// products/domain/ports/capabilities/product-composition-reader.capability.ts
export type ProductCompositionResolution =
  | { kind: 'bundle'; composition: ProductComposition }
  | { kind: 'not-a-bundle' }
  | { kind: 'unknown' };
export interface ProductCompositionReader {
  readProductComposition(input: { productId: string; variantId?: string }): Promise<ProductCompositionResolution>;
}
```
- Dispatch: guard-only on `ProductMasterPort` (ProductTaxRateReader shape). If
  read in bulk, add it as a prefetch (BulkProductReader rule), never a second
  sync path.
- Absence means: compositions stay `undefined` ("never checked"), core treats
  bundle SKUs as ordinary SKUs; nothing is decremented per component; an
  operator-authored composition (OL-side) is the remedy.
- Not proposed now: a WRITE capability (publish a definition to a master); see
  open questions.

#### (d) `BundleListingSupport` - on `OfferManagerPort` AND `ShopProductManagerPort`

```ts
// listings/domain/ports/capabilities/bundle-listing-support.capability.ts
export interface BundleListingSupport {
  /** How a bundle can appear on this destination. */
  modes: readonly ('single-listing' | 'native-bundle')[];
  /** Who computes the quantity a bundle listing shows. */
  stock: 'publisher-supplies' | 'destination-computes-from-components';
}
export interface BundleListingSupportDeclarer {
  getBundleListingSupport(): BundleListingSupport;
}
export function isBundleListingSupportDeclarer<T extends object>(a: T): a is T & BundleListingSupportDeclarer
```
Plus a command field mirroring `OfferVariantGroup`:
`CreateOfferCommand.bundle?` / `PublishProductCommand.bundle?: { components: {internalVariantId; quantity}[] }`
- Dispatch: guard-only; generic guard because both listing ports need it
  (description-format resolver probes both, ADR-046 amendment :88-92). Exposed
  to the FE via `GET /listings/connections/:id/bundle-listing-support` returning
  `{ ...support, declared, resolvedVia }`.
- Absence means: conservative fallback `{ modes:['single-listing'], stock:'publisher-supplies' }`
  - the bundle publishes as one ordinary SKU and core pushes
  `min_i floor(ATP(component_i) / qty_i)` through the existing quantity write-back
  (`IAvailabilityService` owns the formula, buffer applied once, #2323). A
  `native-bundle` command is never sent to an undeclaring destination.
- Stock computation is CORE's (availability seam), never the adapter's, except
  when the destination declares it computes it itself (Shoper sets, PS pack with
  `pack_stock_type` decrementing components) - then core must NOT also push a
  computed quantity (double source), the OrderCreateStockEffect lesson.

#### (e) `SalesDocumentLineAdjustmentRendering` - generic, in `sales-documents`

```ts
// sales-documents/domain/ports/capabilities/line-adjustment-rendering.capability.ts
export interface LineAdjustmentRendering {
  /** Can a line carry list price + rebate (eparagony rebatesMarkups, Subiekt before/after pair, FA(3) unit price before rebate)? */
  perLineRebate: 'native' | 'not-supported';
  /** Does the provider/device accept a line whose total is zero? */
  zeroValueLine: 'accepted' | 'refused';
  /** Does it accept a receipt/document whose total for one tax-rate group is zero? */
  zeroValueRateGroup: 'accepted' | 'refused';
  /** Smallest positive line total it accepts, in the document currency's MINOR units; null = no floor. */
  minimumLineTotalMinor: number | null;
}
export interface LineAdjustmentRenderingDeclarer {
  /** Sync, pure; may read the adapter's own connection config. */
  getLineAdjustmentRendering(): LineAdjustmentRendering;
}
export function isLineAdjustmentRenderingDeclarer<T extends object>(a: T): a is T & LineAdjustmentRenderingDeclarer
```
Neutral line fields added to `InvoiceLine` (invoicing.types.ts:443) and
`FiscalTransactionLine` (fiscalization.types.ts:222):
`listUnitPriceGross?: number; rebateGross?: number` - sent ONLY when the target
declared `perLineRebate:'native'`; the adapter maps them to its own wire
(rebatesMarkups / pair / P_10).
- Dispatch: guard-only, generic guard living in `sales-documents` (the
  SelfRoutingDocumentKind precedent: binding to InvoicingPort or
  FiscalizationPort would break the leaf's zero-sibling-edge property pinned by
  `barrel-purity.spec.ts`).
- Absence means the MOST RESTRICTIVE fallback (ReceiptLineNameBudget rule):
  `{ perLineRebate:'not-supported', zeroValueLine:'refused', zeroValueRateGroup:'refused', minimumLineTotalMinor:null }`
  -> core prints the after-rebate price (today's behaviour; the eparagony mapper
  already balances an order-level shortfall into one REBATE line,
  eparagony-document.mapper.ts:95-105) and folds a free line out of the
  document (a pure core rule: merge into its bundle group line, else omit and
  record the omission on the order) rather than letting the adapter refuse a
  paid order. Reported `declared:false` on the operator surface.
- Per connection at issue time (one document, one connection); folded
  most-restrictive only for previews/editor that must fit every connection.
- Adapters keep their own pre-call refusal as the last line of defence
  (eparagony's `EparagonyConfigException` style), but a refusal that the
  declaration predicted is a contract bug (section 5).

### 2.3 Summary table

| Name | Port | Method | Dispatch | Absence means |
|---|---|---|---|---|
| `OrderLineCompositionReporter` | OrderSourcePort (generic guard) | `getOrderLineCompositionReporting(): OrderLineCompositionReporting` | guard-only | bundle fields "not asserted"; fall back to master composition |
| `OrderLinePriceEvidenceReporter` | OrderSourcePort (generic guard) | `getOrderLinePriceEvidenceReporting(): OrderLinePriceEvidenceReporting` | guard-only | only `price` known; zero line = reason unknown; 0.01 = ordinary unless operator rule |
| field `Product.composition` (+ optional `ProductCompositionReader`) | ProductMasterPort | `readProductComposition(input): Promise<ProductCompositionResolution>` | guard-only | `undefined` = never checked; bundle SKU treated as plain SKU |
| `BundleListingSupportDeclarer` | OfferManagerPort + ShopProductManagerPort (generic) | `getBundleListingSupport(): BundleListingSupport` | guard-only + HTTP read with `declared/resolvedVia` | single-listing, core-computed stock via existing write-back |
| `LineAdjustmentRenderingDeclarer` | InvoicingPort + FiscalizationPort (generic, in sales-documents) | `getLineAdjustmentRendering(): LineAdjustmentRendering` | guard-only | no per-line rebate, zero lines/rate-groups refused -> core folds/merges before the adapter |

Naming per engineering-standards: `*.capability.ts` under `domain/ports/capabilities/`,
no `Port` suffix, `is{Capability}` guard, `as const` + union for every vocabulary,
types in `*.types.ts`, distinctive method names (`getOrderLine...`,
`getBundleListing...`) so no existing structural guard can mis-narrow them
(FulfillmentStatusSource lesson). Each new capability added to docs/capabilities.md
in the same PR.

---

## 3. Field vs capability - recommendation

Recommendation: **data as fields, constraints as declarations**. Concretely:

- (a)/(b) data -> optional fields on `IncomingOrderItem` / `IncomingOrder`.
  `getOrder` already returns the whole order; a capability method like
  `getLineComposition(orderId)` would be a second read of the same resource,
  re-opening ordering/consistency questions for nothing. The field route is the
  established one (`fulfilledBySource`, `buyerTaxId`, `unitPriceGross`, `taxRate`).
- The declaration capabilities in (a)/(b) are kept SMALL and justified by one
  thing only: telling "not asserted" from "asserted none" at SOURCE level for
  fields whose three-state per line would be noisy. If the team prefers fewer
  moving parts, the honest fallback is three-state fields alone
  (`bundle: membership | null | undefined`), dropping both reporters - the cost
  is that a source must emit `null` on every non-bundle line to say "checked".
  I'd keep the reporters: they also drive UI copy ("this channel cannot report
  gifts; add a rule") without branching on `platformType`.
- (c) -> field on `Product` first; capability only for masters needing a
  separate read.
- (d)/(e) -> declarations (capabilities). These are facts about the destination
  /device, not about an entity, and they govern what core is ALLOWED to send;
  putting them in `Connection.config` would make an operator type a regime fact,
  and putting them in core would make core hold a device number (ADR-082 rule).
- Command side (d)/(e) -> neutral optional fields on the commands
  (`CreateOfferCommand.bundle`, `InvoiceLine.listUnitPriceGross/rebateGross`),
  sent only when the target declared support. Never "send and let the adapter
  ignore" for money fields: an adapter silently ignoring `rebateGross` while the
  caller already reduced the price is how a document stops summing to the total.

Trade-offs: fields cost a jsonb snapshot widening plus every reader of
`orderSnapshot`/`order_line_items` (analytics would double-count a bundle and
its components unless the pure rule excludes one side); declarations cost an
HTTP read endpoint + FE mirror script per vocabulary
(`check-*-mirror.mjs` under `pnpm check:invariants`, the established pattern).

---

## 4. Country-agnostic check (ADR-026)

Must stay OUT of core:
- Words: "gratis", "zestaw", "komplet", "pakiet" - core says bundle / group /
  component / free / discount.
- Regime rules: the PL treatment of small-value gifts (VAT on free supplies,
  the 100 zl net threshold), any "gift => 0% or exempt" rule. Core computes no
  tax (ADR-063): the line's rate still comes from master/channel; a regime-
  specific treatment is either the provider adapter's mapping or an operator
  rule in the existing `sales-documents` rule engine/config, never a constant.
- Wire field names: KSeF FA(3) `P_9A`/`P_10`, eparagony `rebatesMarkups`/`REBATE`,
  Subiekt before/after-rebate pair, Allegro `originalPrice`/`discounts[].type`,
  Erli `unitPriceBeforeRebate`, IdoSell `orderSalesMode:"gift"`, PrestaShop
  `pack_stock_type`, Shoper `type:"1"`, Woo `bundled_by` - each stays in its
  adapter's mapper; core sees only the neutral fields.
- Device numbers: min line value, zero-bucket refusal, name length - DECLARED by
  adapters (section 2.2(e)), core holds only the conservative fallback.
- Nominal "gift price" (0.01): operator config, not a core constant.
- Source discount codes: carried verbatim as `sourceType` (opaque, never
  interpreted - the `rawStatus` / `terminalRawStatuses` rule), mapped to the
  neutral `LineDiscountKind` by the adapter only.

---

## 5. Contract test kit

Follow the #2404 shape exactly (pure checker + thin jest wrapper, throws on no
subject / empty table, absence asserted both ways, one mutation fixture per case):

- `@openlinker/core/orders/testing`: `checkOrderLineCompositionContract(adapter, fixtures)`
  where fixtures are recorded source payloads the adapter's `getOrder` is driven
  with (via its fake HTTP client). Cases: every `item.bundle.groupKey` resolves
  to a group; `'inline'` groups carry components and no `'component'` lines;
  `'as-lines'` groups have >=1 component line; quantities positive; groupKey
  stable across two reads of the same payload; no field emitted when the adapter
  declares `bundles:'not-reported'`; declaration is pure (same answer twice, sync,
  no throw).
- `checkOrderLinePriceEvidenceContract`: money invariant per line
  `listUnitPriceGross*qty - sum(discounts) == price*qty` within the currency's
  minor-unit epsilon (reuse `minorUnitExponentFor`); discounts never negative;
  `sourceMarksFree` only `true`; `sourceType` passed through verbatim.
- `@openlinker/core/products/testing`: `checkProductCompositionContract` - three
  states preserved (`unknown` never becomes `not-a-bundle`), component quantities
  positive, no self-reference.
- `@openlinker/core/listings/testing`: declaration purity + "an undeclared
  destination is never sent `bundle`" checked at the builder seam.
- `@openlinker/core/sales-documents/testing`: `checkLineAdjustmentRenderingContract(adapter, mapCommand)`:
  if `zeroValueLine:'refused'`, mapping a command with a zero line must refuse
  PRE-CALL with a `rejected` failure mode (never after the provider boundary);
  if `'accepted'`, it must not refuse; if `perLineRebate:'native'`, the mapped
  payload's rebate total equals sum(rebateGross) and the document still sums to
  `totalGross`; if `'not-supported'`, `listUnitPriceGross/rebateGross` are
  ignored, never half-applied. This binds the declaration to behaviour, which
  is the only way a "declared X but refuses Y" drift is caught.
- Applicability per optional capability via one `expected*CaseIds(subject)`
  function used by both checker and wrapper (#2229 reported === enforced).
- Each adapter spec (allegro, shoper, woocommerce, prestashop, eparagony,
  subiekt, ksef) calls the relevant `run*Contract` with its recorded fixtures.

---

## 6. Open questions

1. Line identity: component lines synthesised from a parent-only shape need
   stable `orderLineId`s (reservations, sale decrement, `resolvedOrderLineId`,
   shipment_lines all key on it). Format like `{lineId}#c{index}` - who mints it,
   adapter or core rule?
2. Stock ownership when the master itself decrements components on a pack sale
   (PrestaShop `pack_stock_type`): core must not ALSO decrement components
   (#3453 sale decrement) - needs a declared `stockModel` honoured end to end.
3. Is 0.01 a gift? Only by operator rule; confirm PO accepts "core never guesses".
4. Gifts absent from the order: automation/rule-engine scope, not ingestion -
   confirm.
5. `minimumLineTotalMinor` is currency-dependent; declare per currency or only for
   the connection's currency?
6. Order destinations (OrderProcessorManager): does PrestaShop/Shoper need to
   CREATE an order with a bundle line (pack) - a write capability not proposed here.
7. Analytics/top-products: count the group line, the components, or both?
8. Do we keep two source reporters or collapse to three-state fields only
   (section 3)?
9. Master write side (publish a bundle definition to a shop) - out of scope?

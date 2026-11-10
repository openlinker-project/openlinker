# R3 / code / A - Bundles and gifts through the capability system

Round 3, blind replication. Angle: the capability system (ports, sub-capabilities, manifests,
probes). Read-only on code. All paths are relative to the repo root; `core/` = `libs/core/src/`.
Facts about channel behaviour (how bundles and gifts arrive, what document providers accept) are
taken from the task brief as given; they are not re-verified here and no conclusion below depends
on a specific channel being right, only on the variety being real.

## 0. Method and scope

Read: `CLAUDE.md`, `docs/architecture-overview.md` (Capability Abstractions, Plugin Manager,
advertised-without-dispatch), `docs/capabilities.md`, ADR-002, ADR-014, ADR-046, ADR-063 § 5,
ADR-082, and the capability files, guards, manifests, DTOs and contract kits cited below.
Not read (blind rule): anything under `docs/plans/analysis/` except `briefs/`, and
`docs/plans/spike-bundles-and-gifts.md`. No use-case catalogue path was given to me, so none was read.

---

## 1. How a sub-capability is declared today

### 1.1 The mechanics, in one place

| Piece | Where | What it does |
|---|---|---|
| Base port | `core/<ctx>/domain/ports/<name>.port.ts` | only the methods EVERY adapter of the role implements (ADR-002 "Decision" §1, `docs/architecture/adrs/002-capability-ports-with-sub-capabilities.md:13-15`) |
| Sub-capability | `core/<ctx>/domain/ports/capabilities/<name>.capability.ts` | interface + co-located `is{Name}` guard; naming drops `Port` (`core/products/domain/ports/capabilities/modified-product-lister.capability.ts:11-14`) |
| Guard | same file | structural probe: `typeof (adapter as Partial<X>).method === 'function'` (e.g. `core/orders/domain/ports/capabilities/order-create-stock-effect.capability.ts:40-46`); a methodless marker uses a `readonly` discriminant instead (`core/invoicing/domain/ports/capabilities/document-number-consumer.capability.ts:17-20, 32, 52-55`) |
| Closed vocabulary | `CoreCapabilityValues`, `core/integrations/domain/types/adapter.types.ts:38` | a name enters iff a call site resolves it BY CONNECTION ID through `getCapabilityAdapter` (`adapter.types.ts:23-36`); mirrored to the doc and two FE copies by `scripts/check-core-capability-mirror.mjs` |
| Manifest | `AdapterMetadata.supportedCapabilities`, e.g. `libs/integrations/allegro/src/allegro-plugin.ts:101-126` | discovery + the runtime gate |
| Runtime gate | `core/integrations/application/services/integrations.service.ts:104-116` | refuses a capability the manifest does not list, then one the connection has not enabled |
| Dispatch | `libs/plugin-sdk/src/dispatch-capability.ts:62-83`, table at `allegro-plugin.ts:215-220` | only BASE ports have table entries; a sub-capability name passed here throws a generic `Error` |
| Manifest data fields | `AdapterMetadata.variantGrouping` etc., `adapter.types.ts:150-165` | static, pre-connection facts read off the manifest, resolved through a resolver with a most-restrictive default (`adapter.types.ts:320-332`) |

### 1.2 Three dispatch modes

1. **Dispatched** - a base port (`OrderSource`, `Invoicing`, ...): in `CoreCapabilityValues`, in the
   manifest, in the dispatch table, resolved by `getCapabilityAdapter(connectionId, name)`.
2. **Advertised-without-dispatch** - in the manifest for host/FE discovery only, never in the
   dispatch table, never in `CoreCapabilityValues`; resolved by narrowing the dispatched base
   adapter with the guard (`ReturnSourceReader`, `core/orders/domain/ports/capabilities/return-source-reader.capability.ts:26-34`;
   Allegro manifest comment `allegro-plugin.ts:111-119`). Hazard: calling `getCapabilityAdapter`
   with that name passes the manifest gate and then throws inside `dispatchCapability`.
3. **Guard-only** - in no manifest and not in `CoreCapabilityValues`; narrowed off an
   already-dispatched adapter (`ModifiedProductLister`, `modified-product-lister.capability.ts:16-23`;
   `BulkProductReader`, `core/products/domain/ports/capabilities/bulk-product-reader.capability.ts:26-31`;
   `OrderFulfillmentReadback`, `core/orders/domain/ports/capabilities/order-fulfillment-readback.capability.ts:36-40`).
   The stated reason: `enabledCapabilities` is stamped at connection create and never retro-filled
   (#2085), so an advertised name invites a gate that drains nothing for every existing connection.

### 1.3 The probe rule

"Probe, never trust" (ADR-046): the reader checks the method exists at RUNTIME, calls it, and
treats a missing method, a falsy answer, a throw or a rejection as the safe default, because an
out-of-tree adapter compiled against an older `libs/core` satisfies the type yet lacks the method.
Canonical code: `lowersStockOnOrderCreate`, `order-create-stock-effect.capability.ts:48-60`;
description-format resolver `core/listings/application/services/description-format-resolution.ts:37-58`.
A declared number is validated, not trusted: `combineReceiptLineNameLimits` ignores a non-positive
or non-integer answer and reports `declared: false` (`core/sales-documents/domain/types/delivery-line.types.ts:152-162`).

### 1.4 Closest precedents and their lessons

| # | Precedent | file:line | Mode | Lesson for bundles/gifts |
|---|---|---|---|---|
| P1 | `OrderCreateStockEffect` | `core/orders/domain/ports/capabilities/order-create-stock-effect.capability.ts:8-23, 30-60` | guard (probed after the call) | A BEHAVIOUR of the far side that changes OL's stock arithmetic is declared, answered per shop (from a setting), and its absence must land on the under-sell side, never the over-sell side. Template for "does the master decrement bundle components itself". |
| P2 | `ReceiptLineNameBudget` + `combineReceiptLineNameLimits` | `core/fiscalization/domain/ports/capabilities/receipt-line-name-budget.capability.ts:8-36`; `core/sales-documents/domain/types/delivery-line.types.ts:142-162` | guard, sync declaration | A regime/device LIMIT is a number the adapter declares; core holds no regime number, folds several answers to the strictest, and reports "undeclared" with a conservative fallback. Template for document rebate limits (zero-price line, zero-total rate bucket). |
| P3 | `ModifiedProductLister` / `BulkProductReader` | `modified-product-lister.capability.ts:16-23, 63-67`; `bulk-product-reader.capability.ts:10-21` | guard-only | Do not advertise new names; and a capability may declare a PARTIAL truth ("product-level freshness only") as long as it says what it cannot see. A bundle-definition read must say whether "no composition" means "not a bundle" or "not reported". |
| P4 | `ReturnSourceReader.terminalRawStatuses` | `return-source-reader.capability.ts:85-98, 101-108` | advertised-without-dispatch, amended | An optional `readonly` hint can be added onto an existing capability without touching its guard; absence degrades a bound, never errors. Template for amending existing contracts instead of minting new ones. |
| P5 | `DocumentNumberConsumer` | `core/invoicing/domain/ports/capabilities/document-number-consumer.capability.ts:17-20, 26-55` | guard, marker | Declarations can be `readonly` properties, not only methods; useful for a static "rebate support" record. |
| P6 | `variantGrouping` manifest field | `core/integrations/domain/types/adapter.types.ts:150-165, 300-332` | manifest data, not a capability | A per-PLATFORM, pre-connection listing fact (how siblings group) is a manifest field with a most-restrictive resolver default, not a capability name. Template for "how this destination lists a bundle". |
| P7 | ADR-046 description format | ADR-046 §Decision and amendment, `docs/architecture/adrs/046-adapter-declared-description-format.md:33-35, 51, 90-92`; `description-format-resolution.ts:37-58` | method on an existing sub-capability | Attach a declaration to the capability that already owns the act; resolve the fallback server-side and expose `declared` plus `resolvedVia` so "declared nothing" and "could not resolve" stay distinct. |
| P8 | `OrderFulfillmentReadback` naming | `order-fulfillment-readback.capability.ts:24-35` | guard-only | A method name that collides with another capability's guard gets mis-narrowed silently. New method names must be globally distinct (`getBundle...` not `getComposition` if anything already probes that). |
| P9 | `Product.gpsr` | `core/products/domain/entities/product.entity.ts:88-99` | DTO field, no capability | Per-product master data travels BY VALUE on the product, three states (`undefined` not reported / `null` asserted none / object). Template for master bundle definitions. |
| P10 | ADR-014 decision 1 "Invariant, not capability" | `docs/architecture/adrs/014-source-authoritative-order-pricing.md:25-27` | none | A rule every adapter must obey is a contract invariant, not an opt-in capability. Line-money conservation for bundles is an invariant. |
| P11 | `OrderTotals.discountTotal` | `core/orders/domain/types/order.types.ts:443-465` | DTO field | "Carried, never acted on": a source fact core does not know how to attribute is carried so refusals can name the cause, not apportioned into a legal document. The gift/discount fields must follow this. |
| P12 (counter) | PrestaShop pack kept adapter-local | `libs/integrations/prestashop/src/domain/types/prestashop-pack.types.ts:11-13` | none | #2598 refused a neutral pack model because "WooCommerce packs have different semantics and Allegro has none". Any core composition type must be thin enough not to cement one platform's shape - a reason to model COMPOSITION FACTS, not pack mechanics. |

---

## 2. Design

Principle used throughout: **per-order and per-product facts are neutral optional FIELDS on existing
DTOs** (they vary per record, not per adapter); **per-adapter behaviours and limits are guard-only
sub-capabilities or manifest fields** (they vary per adapter/connection, not per record). No new
name enters `CoreCapabilityValues` or any manifest's `supportedCapabilities` (lesson P3).

### 2.1 Bundle composition on incoming lines - FIELDS

Three arrival shapes (parent-only, parent+children, children-only-grouped) are three ways to fill one
structure. Add to `IncomingOrderItem` (`core/orders/domain/types/incoming-order.types.ts:163`) and
mirror onto `OrderItem` (`core/orders/domain/types/order.types.ts:254`):

```ts
/** Source-asserted bundle structure of this line. Absent = the source asserted nothing. */
bundle?: IncomingLineBundle;

type IncomingLineBundle =
  | {
      role: 'parent';
      /** Who carries the money: the parent line, its component lines, or unknown. */
      pricedOn: 'parent' | 'components' | 'unknown';
      /** Composition the SOURCE reported inside this line (parent-only shape). Absent = not reported. */
      components?: readonly { productRef: IncomingOrderItemRef; quantityPerBundle: number; name?: string; sku?: string }[];
    }
  | {
      role: 'component';
      /** Line id of the parent (parent+children shape). */
      parentLineId?: string;
      /** Opaque source grouping key (children-only-grouped shape; no parent line exists). */
      groupKey?: string;
      quantityPerBundle?: number;
    };
```

Invariant (contract-tested, not a capability, P10): `role: 'component'` carries exactly one of
`parentLineId` / `groupKey`; `parentLineId` must name a line in the same order; across all lines
the money-carrying set (parents with `pricedOn: 'parent'` + components whose parent says
`'components'` + ordinary lines) sums to `totals` within the existing epsilon
(`core/invoicing/application/mappers/order-to-issue-invoice-command.mapper.ts:323-339`). Absence of
`bundle` keeps every existing path byte-identical.

Core consumes it only through pure rules beside the type (the `*.types.ts` pure-rule exception):
`resolveBundleGroups(items)` -> groups; `expandBundleForStock(line, masterComposition)` -> component
stock lines. No capability is needed to READ it - the adapter already owns `getOrder`.

### 2.2 Gift / discount evidence on lines - FIELDS + a pure classifier

Gifts arrive as 0.00, as a nominal minimum price, as full price with a 100% line discount, as an
explicit flag, or not at all. Carry only what the source REPORTED:

```ts
/** Source-reported per-line rebate evidence. Each member absent = not reported. */
priceEvidence?: {
  /** List/catalogue unit price before the line rebate, gross on the same terms as unitPriceGross. */
  listUnitPriceGross?: number;
  /** Line-level rebate the source reported, gross, for the whole line (not per unit). */
  lineRebateGross?: number;
  /** The source itself flagged this line as free/promotional. Typed `true` only (the `fulfilledBySource` shape, incoming-order.types.ts:101). */
  sourceFlaggedFree?: true;
  /** Opaque source promotion/campaign id, for grouping, never interpreted. */
  promotionRef?: string;
};
```

`price` / `unitPriceGross` keep meaning "what the buyer paid per unit" (ADR-014: source-authoritative;
documents already use `unitPriceGross ?? price`, `order-to-issue-invoice-command.mapper.ts:367-374`).
A pure `classifyLineGift(line, currency)` returns
`'asserted' | 'inferred-zero' | 'inferred-nominal' | 'inferred-full-rebate' | 'none'` - an
inference is LABELLED, drives UI and pack-bench display, and never alone changes a fiscal document
(lesson P11). "Nominal" is one minor unit of the currency via `minorUnitExponentFor`
(`core/sales-documents/domain/types/shipping-tax-split.types.ts:190`), never a literal `0.01`.
"Gift not sent at all" cannot be represented by a line field; it is an OMS rule (operator adds a
line), not an adapter concern - open question Q3.

### 2.3 Master bundle definitions and stock policy - FIELD on Product, optional guard for cost

```ts
// on Product (core/products/domain/entities/product.entity.ts) and/or ProductVariant
composition?: ProductComposition | null;   // three states, the gpsr rule (P9)

interface ProductComposition {
  components: readonly { externalProductId: string; externalVariantId?: string; quantity: number }[];
  /** How the MASTER derives the bundle's sellable quantity. */
  stockPolicy: 'own' | 'from-components' | 'lowest-of-both' | 'unknown';
  /** Does a sale of the bundle at the master lower component stock, the bundle's own row, or both. */
  saleDecrements: 'components' | 'own' | 'both' | 'unknown';
}
```

`stockPolicy` and `saleDecrements` are PER PRODUCT (PrestaShop's `pack_stock_type` is stored per
product with a shop default, `prestashop-pack.types.ts:19-36`), so they are data, not an adapter
capability. `'unknown'` is first-class; core treats it like `OrderCreateStockEffect` absence (P1):
reserve and decrement components AND keep the bundle hold until the master re-read - under-sell,
never over-sell. Component ids are EXTERNAL refs; core maps them through `IdentifierMappingService`
exactly as variant ids are mapped today, so no adapter emits internal ids.

Optional guard-only `BundleDefinitionReader` on `ProductMasterPort` only if a master needs extra
calls to read compositions (bulk prefetch shape, P3 `BulkProductReader`):
`prefetchBundleDefinitions(externalIds: readonly string[]): Promise<void>` - invisible except in
request count. Not needed if the composition is on the product resource already.

### 2.4 Bundle listing support - MANIFEST FIELD + optional command field

How a destination can LIST a bundle is a per-platform, pre-connection fact (like `variantGrouping`, P6):

```ts
// AdapterMetadata
bundleListing?: 'native-composition' | 'unit-multiple' | 'flat';
// resolveBundleListingModel(metadata) => metadata?.bundleListing ?? 'flat'
```

- `native-composition`: the destination stores component structure.
- `unit-multiple`: the destination expresses "N units of one catalogue product per offer item"
  (Allegro `quantity.value`, documented read-side only, `libs/integrations/allegro/src/domain/types/allegro-api.types.ts:374-379`).
- `flat` (default, most restrictive): the bundle is published as an ordinary product; composition
  appears only in description; OL computes its quantity.

Add an optional `bundle?: { components: ...; unitMultiple?: number }` to `CreateOfferCommand`
(`core/listings/domain/types/offer-create.types.ts:182`, beside `variantGroup` at :239) and the shop
`PublishProductCommand`; an adapter that cannot write it reports a non-fatal warning
(`core/listings/domain/types/product-publish.types.ts:274-275`), never a silent drop. Published
QUANTITY for a bundle is a core rule over `ProductComposition` + availability, applied before
`applyPublishControls`, so no listing capability is involved in stock.

### 2.5 Document rebate rendering and its limits - GUARD-ONLY declaration + optional line fields

Document lines get optional annotations; the paid price stays the contract:

```ts
// InvoiceLine (core/invoicing/domain/types/invoicing.types.ts:443) and
// FiscalTransactionLine (core/fiscalization/domain/types/fiscalization.types.ts:222)
listUnitPriceGross?: number;   // before the line rebate
lineRebateGross?: number;      // whole-line rebate; unitPriceGross*qty + rebate == list*qty
bundleParentLineId?: string;   // orderLineId of the bundle parent, for rendering "in set"
```

An adapter that ignores them produces exactly today's document (unitPriceGross is still the paid
price), which is what makes the fields safe to add.

The LIMITS are adapter-declared (P2 shape, sync, guard-only), one interface usable on both
`InvoicingPort` and `FiscalizationPort` via a generic guard (the `isSelfRoutingDocumentKind<T extends object>`
precedent, `core/sales-documents/domain/ports/capabilities/self-routing-document-kind.capability.ts:9-24, 44-47`),
living in `sales-documents` so neither document context imports the other:

```ts
export interface LineRebateSupport {
  getLineRebateSupport(): {
    /** Provider renders listUnitPriceGross + lineRebateGross as a per-line rebate. */
    perLineRebate: boolean;
    /** A line whose paid total is zero may be sent. */
    zeroValueLine: 'allowed' | 'refused';
    /** A tax-rate group whose lines total zero may be sent. */
    zeroValueRateGroup: 'allowed' | 'refused';
  };
}
export function isLineRebateSupport<T extends object>(a: T): a is T & LineRebateSupport;
```

Consumed by ONE pure planner, `planRebateRendering(lines, support)`, returning per line
`'render-rebate' | 'paid-price-only' | 'omit-zero' | 'refuse'` plus a named block reason. Absence
(no method, throw, malformed answer) => `{perLineRebate:false, zeroValueLine:'refused',
zeroValueRateGroup:'refused'}`, reported `declared:false`. Under that default a zero gift line on a
fiscal receipt is omitted (consistent with ADR-082 decision 7: "A receipt never carries a zero
line", `docs/architecture/adrs/082-delivery-line-on-sales-documents.md:21`), and an invoice that
would need a zero line or zero bucket is HELD with a named reason rather than guessed (ADR-041
"silence-and-pick-one is forbidden"). The adapter additionally refuses pre-call any payload that
violates its own declaration (ADR-082 decision 9 shape), so a planner bug cannot reach a device.

Order-level discounts stay out of this: invoicing still refuses lines that do not reconcile
(`order-to-issue-invoice-command.mapper.ts:333-338`); `lineRebateGross` only carries what the
SOURCE attributed to a line.

### 2.6 Proposal table

| Name | Kind | Port / host | Signature | Dispatch | Absence means |
|---|---|---|---|---|---|
| `IncomingOrderItem.bundle` / `OrderItem.bundle` | field | OrderSource DTO | `IncomingLineBundle` (2.1) | n/a | source asserted no structure; line treated as ordinary |
| `IncomingOrderItem.priceEvidence` / `OrderItem.priceEvidence` | field | OrderSource DTO | (2.2) | n/a | not reported; classifier may still INFER from price, labelled |
| `Product.composition` (+variant) | field | ProductMaster DTO | `ProductComposition \| null` | n/a | `undefined` = not reported, keep stored; `null` = not a bundle |
| `BundleDefinitionReader` (only if needed) | sub-cap | `ProductMasterPort` | `prefetchBundleDefinitions(ids): Promise<void>` | guard-only | per-product reads, unchanged behaviour |
| `AdapterMetadata.bundleListing` | manifest field | any listing adapter | `'native-composition' \| 'unit-multiple' \| 'flat'` | read off manifest | `'flat'` (most restrictive) |
| `CreateOfferCommand.bundle` / `PublishProductCommand.bundle` | field | listings commands | `{components, unitMultiple?}` | n/a | plain product publish; unwritable parts -> `warnings` |
| `InvoiceLine` / `FiscalTransactionLine` `.listUnitPriceGross`, `.lineRebateGross`, `.bundleParentLineId` | field | document commands | numbers / string | n/a | today's document |
| `LineRebateSupport` | sub-cap | `InvoicingPort` + `FiscalizationPort` (generic guard in `sales-documents`) | `getLineRebateSupport(): {...}` sync | guard-only, probed | no rebate rendering; zero line refused; zero group refused; `declared:false` |
| (no new capability) bundle sale-decrement behaviour | data | `ProductComposition.saleDecrements` | - | - | `'unknown'` -> under-sell posture (P1) |

---

## 3. Recommendation: field vs capability split

**Fields for facts that vary per record; guard-only declarations for limits that vary per adapter;
manifest fields for per-platform listing models; zero new capability NAMES.**

Trade-offs:

- Fields (+): carried through snapshot persistence, replayable, testable on fixtures, invisible to
  adapters that ignore them, no `enabledCapabilities` retro-fill problem. (-): optional fields
  everywhere invite "absent read as false"; each needs the three-state discipline and a
  `read*` coercer (the `readSourceBuyerTaxId` pattern), and the snapshot `toDomain` must carry them.
- Capability for incoming composition (rejected): an `OrderSourcePort` sub-capability like
  `BundleLineReporter` would only say "this source CAN report bundles", which says nothing about a
  given order; `getOrder` already returns the data. It would add a name nobody can gate on safely.
- Capability for document limits (chosen): the answer is a property of the provider/device, needed
  BEFORE composing the document, and differs between providers on the same order - exactly P2.
- Manifest field for listing (chosen over a sub-capability): needed pre-connection in the publish
  wizard; a capability guard needs a resolved adapter (credentials). The cost is that a manifest
  field cannot vary per shop; if a shop-level setting matters, add a probed method later (P1 shape)
  and keep the manifest value as the default.
- Core composition model (accepted with P12's warning): keep it to "which external items, how many,
  which stock rule" - no pack-stock-type numbers, no platform enums. Platform mechanics
  (PrestaShop's sentinel 3, `prestashop-pack.types.ts:21-36`) are mapped INSIDE the adapter onto
  `stockPolicy`/`saleDecrements`.

---

## 4. Country-agnostic rules

1. No national vocabulary in core names or values: no "zestaw", "gratis", FA(3) element names,
   `P_10`, "paragon". Regime facts (rebate element, zero-bucket refusal, device name binding) are
   adapter declarations or adapter-internal mapping (ADR-026; P2).
2. Core computes no tax and rounds nothing for gifts or bundles (ADR-063 § 5,
   `docs/architecture/adrs/063-per-line-tax-rate-resolution-and-provenance.md:84-85`). A component
   or gift keeps its own catalogue rate code; it never inherits the parent's rate by computation.
   A parent priced at one rate with components at several rates is a SPLIT problem handled with the
   existing division-only helpers (`distributeOrderDiscount`, `core/orders/domain/types/order-discount-split.types.ts:44-70`;
   `splitShippingAcrossRates`, `shipping-tax-split.types.ts:111`) or held - never a rate guess.
3. Thresholds are expressed in the currency's minor unit (`minorUnitExponentFor`), never as `0.01`.
4. An inference is labelled and never becomes an assertion: `inferred-*` gift classes never change a
   legal document on their own; only `sourceFlaggedFree` or a reported `lineRebateGross` may.
5. Absence never collapses into a favourable value: `stockPolicy: 'unknown'` -> under-sell;
   undeclared rebate support -> the refuse/omit posture; absent `bundle` -> ordinary line.
6. Suggested per-country defaults, if any, are DATA in `apps/api` with a cited source (ADR-082
   decision 8 pattern), never in `libs/core`.

---

## 5. Contract-test coverage pattern

Copy the shipped kits: pure `check*Contract` returning per-case results + a thin jest
`run*Contract`, with vacuity guards and one breakage fixture per case
(`core/fulfillment/testing/fulfillment-executor-contract.suite.ts:118-160, 514-556`;
`core/fulfillment/testing/__tests__/contract-vacuity.spec.ts`; consumers e.g.
`libs/oms/src/execution/__tests__/ol-fulfillment-executor.adapter.spec.ts:19-24`). Optional
sub-capabilities are handled by ABSENCE asserted both ways
(`expectedFulfillmentExecutorContractCaseIds`, `fulfillment-executor-contract.suite.ts:154`), never
`it.skip`. Asymmetric-risk declarations get an explicit direction test (the publication-day kit,
`core/currency/testing/publication-day-contract.suite.ts:161, 321-366`).

Proposed kits (in each owning context's `testing/` subpath, guarded by
`scripts/check-contract-suite-not-in-production.mjs`):

1. `runOrderLineStructureContract(mapOrder, fixtures)` - for every OrderSource adapter, over the
   adapter's OWN recorded payload fixtures: money conservation per arrival shape; parent ids
   resolve; no line is both parent and component; `quantityPerBundle > 0`; `bundle` absent when the
   payload carries no structure (three-state not collapsed); `sourceFlaggedFree` never emitted with
   a positive paid price unless `lineRebateGross` explains it.
2. `runProductCompositionContract(master)` - composition component refs are external ids;
   `undefined` vs `null` kept apart; a pack fixture maps to a non-`unknown` `stockPolicy` only when
   the platform states it.
3. `runLineRebateSupportContract(adapter, fixtures)` - declared answer is well-formed; a document
   violating the declaration is refused PRE-CALL (no HTTP), mirroring ADR-082 decision 9; a
   declaration of `perLineRebate:true` round-trips list price and rebate without changing the
   payload's paid total; an adapter that does NOT declare produces a byte-identical payload with and
   without the new optional line fields.
4. Planner fixtures shared by core unit specs and (if mirrored to the FE) a `check-*-mirror.mjs`,
   the `RETURN_STAGE_FIXTURES` shape.

Doc obligations: `docs/capabilities.md` section counts bump for `LineRebateSupport` (and
`BundleDefinitionReader` if built); `CoreCapabilityValues` unchanged, so the core-capability mirror
is untouched.

---

## 6. Open questions

- Q1. Does any document provider need the rebate split at the BUNDLE level (one rebate across
  components) rather than per line? If yes, `lineRebateGross` is insufficient and a group-rebate
  field is needed. Unknown from code.
- Q2. Parent-only arrival with no master composition: hold the order (under-sell, operator maps) or
  reserve the parent SKU as an ordinary item? This design defaults to the parent SKU plus an
  attention state, but it is a product decision.
- Q3. "Gift not sent at all by the channel": OMS-side rule (operator/automation adds a zero line)
  vs out of scope. Not representable as adapter data.
- Q4. Should `bundleListing` ever be per-connection (shop plugin installed or not, e.g. a
  WooCommerce bundle extension)? If so it needs a probed method (P1) on top of the manifest default.
- Q5. Is `saleDecrements` knowable from every master, or will most report `'unknown'` - in which
  case the under-sell default becomes the common path and needs measuring.
- Q6. Where do gift/bundle lines go on the pack bench: separate scan targets per component, or one
  scan per bundle? Affects whether `FulfillmentWorkLine` needs a component expansion; out of this
  angle.

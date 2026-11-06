# Bundles and gifts v1: minimal port extension

Read-only design, 2026-11-04. Basis: the real neutral types and the spike files
(`verify/component-line-id.md`, `rules-check/0-synthesis.md`, `ux-compare/0-synthesis.md`).
Goal: keep every function, make integrations carry platform specifics, keep core to a few
generic steps, and avoid touching 50 places.

## The idea in one paragraph

An order keeps one **commercial** list of lines (`order.items`), exactly as today. Core
derives one **physical** list from it (bundle lines expanded to their frozen components)
and every stock, packing and decrement site reads that list instead of `order.items`.
Integrations only do two optional things: say "this line is a gift" when their platform
says so, and render a gift their own way on output. A bundle is recognised by core from
OL's own definition, so no adapter has to know about bundles at all.

## Changes to the starting proposal (with evidence)

1. **No `role: 'bundle' | 'bundle-component'` on lines.** Core already knows a line is a
   bundle: its `variantId` has a bundle definition. Asking adapters to set it would make
   every adapter change for nothing, and two sources of truth could disagree.
2. **No `parentLineId` from adapters.** The only channel that sends components next to the
   parent (Shoper) collapses them in its own adapter, before core sees the order. Core
   never stores channel components; it expands from OL's definition.
3. **Expansion is stored once per order, not recomputed per site.** The 9 sites in
   `verify/component-line-id.md` fail silently when they disagree (a no-op, never a throw),
   so they must all read the same frozen table.
4. **Gift rules reuse the automation rule engine**, not a new promotion engine (storage,
   AND-only conditions, dry run, run history, at-most-once firing already exist in
   `libs/core/src/automation`). Only the evaluation of the new action is inline at
   ingestion, because the gift must exist before reservation and routing.
5. **Documents need no adapter work by default.** The default gift form is "omit"; a
   0,00 zł line moves no value between VAT rates, so the totals per rate stay equal to
   what was paid. A provider declaration matters only for the optional "show at 0,00" form.

## Type additions (all optional, absent = today's behaviour)

`libs/core/src/orders/domain/types/incoming-order.types.ts` and `order.types.ts`:

```ts
export const GiftSourceValues = ['channel', 'cart-rule', 'ol-rule', 'operator'] as const;
export type GiftSource = (typeof GiftSourceValues)[number];

export interface LineGift {
  source: GiftSource;
  /** Promotion / cart rule id when known; display and analytics only. */
  ruleRef?: string;
}

// IncomingOrderItem and OrderItem gain:
gift?: LineGift;
/** Units of the mapped variant per sold unit (Allegro multipack), default 1. */
packQuantity?: number;
```

`libs/core/src/orders/domain/types/order-edits.types.ts` (overlay, `OrderEdits`):

```ts
readonly addedLines?: Readonly<Record<string, OrderAddedLine>>; // key = 'ol-gift:{ruleId}:{lineId}' or 'op-gift:{changeId}'
```
`applyOrderEditsToOrder` (:438) appends them as `OrderItem` with `gift` set and price 0.
`channelSnapshot` stays the channel original, as the overlay rule already requires.

`libs/core/src/products` (new, small): `BundleDefinition { variantId; components: {variantId; productId; quantity; giftSlot?}[]; version }`,
repository port + table `bundle_definitions` (history by version). Pure
`expandBundleLines(items, definitions) -> PhysicalLine[]` with id `{lineId}~c:{variantId}`,
quantities aggregated per component (verify surprise 4), carrying `productId` (surprise 5).

`order_records.lineExpansion` (jsonb, written once at ingestion, single writer) and a pure
getter `OrderRecord.physicalItems` (ADR-011 read-only derivation), plus
`componentLineIdsOf(lineId)` for the edit follow-ups.

Optional capabilities (guard-only, ADR-046 probe, absent from `CoreCapabilityValues`):

```ts
// on InvoicingPort / FiscalizationPort adapters
export interface ZeroValueLineSupport { acceptsZeroValueLine(): boolean; }
// on ProductMasterPort adapters (PrestaShop packs, Subiekt komplety)
export interface BundleReader { readBundleComposition(externalProductId: string): Promise<ExternalBundleComposition | null>; }
```

No mandatory port method is added. No existing adapter fails to compile.

## Core call sites that change (honest count: 16)

Ingestion (2):
1. `order-ingestion.service.ts:664` after `applyOrderEditsToOrder`: evaluate gift rules,
   write `addedLines`, re-apply overlay. One call.
2. same service before `:699` reserve: freeze `lineExpansion`. One call.

Physical-line swaps, `order.items` -> `physicalItems` (5, each a one-line change):
3. `order-ingestion.service.ts:2215` `reserveOrderInventory`.
4. `orders/domain/project-order-for-routing.ts:36` (covers intercept, route handler, dry run).
5. `apps/worker/src/sync/handlers/inventory-sale-decrement.handler.ts:91-117`.
6. `order-sync.service.ts:443` and `:515` (`productIds` for refresh and absorbed holds).
7. `return-custody.service.ts:429` `resolveRestockTarget` (bundle return restocks components).

Order-edit follow-ups via `componentLineIdsOf` (4):
8. `fulfillment-order-edit.service.ts:41-66` `assessForEdit`.
9. `fulfillment-order-edit.service.ts:69-84` `lowerLineQuantity`.
10. `reservation.service.ts:247-261` `narrowForOrder` (target = bundle qty x component qty).
11. `inventory-sale-reversal.service.ts:155-200` `reverseLineQuantity`.

Availability and publishing (3):
12. `availability.service.ts:69` `getPromisableQuantities`: a bundle variant answers
    `min(floor(componentAtp / qty))`, provenance `unknown` if any component is unknown.
13. `inventory-propagate-to-marketplaces.handler.ts:113`: a changed component also
    enqueues its bundles (one lookup).
14. `offer-stock-restore.service.ts:350` cancellation republishes component and bundle offers.

Documents (2), both calling one shared pure helper in `sales-documents`
(`presentGiftLines(lines, form, acceptsZeroValueLine)`, ADR-082 style settings resolver):
15. `order-to-issue-invoice-command.mapper.ts:137`.
16. `order-to-register-transaction-command.mapper.ts:129`.

Unchanged on purpose (commercial grain): `shipment_lines`, returns line resolution,
invoice correction matching, discount allocation, amendment diff, `order_line_items`,
destination mirror (`order-sync.service.ts:296` sends `order.items` including gift lines
and the bundle line), offer creation (a bundle is an ordinary master variant).

## What each integration does

| Integration | Must | Can ignore |
|---|---|---|
| Allegro | set `packQuantity` from the offer's set quantity when it is a multipack (else core holds the line as unmapped) | gifts (none on Allegro), bundles |
| Erli | nothing | everything |
| PrestaShop source | split a cart-rule gift into its own line, price 0, `gift.source='cart-rule'`, and lower the cart-rule discount by the same amount | bundles |
| PrestaShop master | optional `BundleReader` for packs | - |
| PrestaShop / WooCommerce / Shoper destination | nothing: a gift is a 0,00 line, a bundle is its variant; may read `gift` to set a native flag | - |
| WooCommerce source | nothing (plugin gifts already arrive as 0,00 lines; may set `gift` when a plugin marks them) | bundles |
| Shoper source | collapse bundle children into the parent line; set `gift` for gift-app lines | - |
| IdoSell, Empik (later) | map `orderSalesMode: gift` / `offered_quantity` to `gift` | bundles |
| Subiekt master | optional `BundleReader` for komplety | - |
| KSeF, inFakt | optional `acceptsZeroValueLine() = true` | everything else |
| eparagony, Subiekt docs | optional `acceptsZeroValueLine() = false` (eparagony error 41) | everything else |

Defaults keep a non-implementing adapter correct: no `gift` means an ordinary line (a 0,00
line still flows as today), no `packQuantity` means 1, no `ZeroValueLineSupport` means the
"show at 0,00" form is not offered for that provider, no `BundleReader` means the
composition is entered in OL.

## What stays in core, and why it cannot move into adapters

- **Expansion** feeds reservations, packing, decrements and edits across all channels and
  all masters. If each adapter expanded, a Shoper order and an Allegro order for the same
  bundle could reserve different stock.
- **OL-only gifts** exist on no platform (Allegro, Erli), so no adapter can add them; they
  must exist before reservation and routing.
- **Totals equal what was paid** is a cross-line rule (grosz from a same-rate line,
  remainder to the largest paid line, whole-order discount spread). One helper, two mappers,
  instead of one copy per provider.
- **Bundle availability** is a min over components from any master; adapters see one
  master each.

## Risks

- Silent no-ops if a new site keeps reading `order.items` for stock. Mitigation: an
  invariant script listing the allowed `order.items` readers (the `check:invariants` style).
- Expansion frozen at ingestion: a definition fixed later does not change open orders.
  Intended, but needs the "Zamówienie ma skład sprzed zmiany" hint.
- Shoper collapse relies on the adapter recognising children reliably; unverified live.
- Reusing automation for gifts means its inline evaluation must stay pure and fast; the
  irreversible-action gate does not apply (adding a gift line is reversible until packed).
- PrestaShop cart-rule split changes the discount reported by the source; the amendment
  diff must compare against the split shape, or every poll reports a change.

## Kto co robi (do UI)

- Integracja mówi, który produkt w zamówieniu jest gratisem, jeśli kanał to wie (reguła koszyka PrestaShop, IdoSell, Empik).
- Integracja wysyła gratis do sklepu i na dokument po swojemu: pozycja 0,00 zł albo pominięta, zależnie od tego, co przyjmuje dostawca.
- Integracja może pobrać skład paku z PrestaShop albo kompletu z Subiekta.
- OpenLinker rozkłada zestaw na składniki: rezerwacja, pakowanie i zdjęcie stanu idą po składnikach.
- OpenLinker dodaje gratisy z własnych promocji, także na Allegro i Erli, gdzie kanał ich nie zna.
- OpenLinker pilnuje, żeby suma dokumentu była równa temu, co zapłacił klient.
- OpenLinker liczy dostępność zestawu z najmniej dostępnego składnika i wysyła ją do kanałów.

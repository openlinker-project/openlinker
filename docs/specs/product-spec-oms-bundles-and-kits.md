# Product Spec - Bundles and gifts

**Status:** draft. **Issue:** #3606 (epic #3520). **Decision record:** [ADR-083](../architecture/adrs/083-commercial-and-physical-order-lines.md), with amendments to ADR-054 and ADR-061.
**Mockup:** `docs/plans/mockups/oms-mvp/m22-bundles-and-kits.html` (states: `products/list`, `products/form-new`, `products/form-gift-slot`, `order/bundle`, `order/multipack-held`, `bench/in-progress`; the full list is in the comment at the end of the mockup).
**Design source:** `docs/plans/analysis/spike-bundles-and-gifts/ports-v1.md`.

---

## 1. Problem

Sellers sell sets and give gifts. The buyer sees one line. The warehouse moves several units. Today OpenLinker has no way to say that one sold unit is three physical units, so:

- an Allegro multipack of 3 reserves, picks and decrements one unit ("1 unit shipped for the price of 3");
- a PrestaShop pack or a Subiekt komplet stocks nothing for its components;
- a gift that the channel does not know (Allegro, Erli) cannot be added at all.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | One order keeps one **commercial** list (`order.items`, unchanged). Core derives one **physical** list; stock, packing and decrements read it. |
| D2 | Stock, reservations and `FulfillmentWork` run per component. The order line, documents and the channel keep the bundle. |
| D3 | The expansion is frozen at ingestion (`lineExpansion`). A later definition change does not change open orders. |
| D4 | Bundles are defined in OpenLinker. PrestaShop packs and Subiekt komplety can be read on demand. |
| D5 | No `role` and no `parentLineId` from adapters. Core knows a bundle from its own definition. |
| D6 | A gift is a line attribute (`gift`), not a separate entity. |
| D7 | The totals on a document always equal what the buyer paid. |

## 3. The physical list

For each commercial line whose `variantId` has a bundle definition, the physical list holds one line per component:

- id `{lineId}~c:{variantId}`;
- quantity = line quantity x `packQuantity` (default 1) x component quantity;
- the component's `productId` and `variantId`;
- components are aggregated per variant, so a component listed twice becomes one line.

A line without a definition passes through unchanged. An order with no frozen expansion (orders before this feature) reads as physical = commercial.

## 4. Bundle definition and versioning

A bundle is a master variant with a list of components (variant, quantity, optional gift slot). Editing a definition makes a new version; the old versions stay as history. An order keeps the version it was expanded with. Nesting is refused both ways: a bundle cannot contain a bundle and a bundle cannot be a component.

Creating one is one form on the product ("make this a bundle"): product, components with quantities, a gift toggle in the row menu, and one line "Available: 12, limited by Mug".

## 5. Availability

Availability of a bundle = min over components of floor(component availability / quantity). The limiting component is named. If any component's availability is unknown, the bundle is unknown (never 0). A stale component pauses the bundle. A change to a component also republishes the bundles that contain it, and a cancellation republishes both.

## 6. Gifts

A gift line has `gift: { source, ruleRef? }`, source one of `channel`, `cart-rule`, `ol-rule`, `operator`, and price 0.

- **Channel gifts.** The channel says it (PrestaShop cart rule, Shoper gift apps, WooCommerce plugin lines, later IdoSell and Empik). The PrestaShop adapter splits a cart-rule gift into its own 0,00 line and lowers the discount by the same amount.
- **OL gifts.** Added at ingestion from automation rules (a new action in the existing engine), before reservation and routing, so they work on Allegro and Erli. They are stored in `OrderEdits.addedLines`; the channel snapshot stays the channel original.
- **Operator gifts.** Added by hand until the parcel is closed, refused after, with one warning if a document exists.
- **Gift slot in a bundle.** A bundle component can be marked as a gift. It is shown as a gift with its cost ("customer pays 0,00, costs you X"), reserved and packed like any component, and omitted on documents by default.
- The gift leaves the warehouse like any line: reservation, work, bench scan, decrement with reason `gift`. Cancelling gives stock back.
- A gift rule can skip itself when the product is already in the order, also as a bundle component (opt-in, on by default in the composer).

## 7. Multipack hold

An Allegro offer sold as a set (`packQuantity > 1`) whose variant has no bundle definition and no confirmation is held as `awaiting_mapping` with the reason "multipack without a bundle". The hold offers one click: "This offer sells N x {product}", with the sentence "One sale of this offer = N x {product}. Every order waiting for it will continue." The click stores the confirmation (no new product, no remapping), re-drives every order held for that product and pack quantity now, and shows "N orders continue". Nothing is reserved or shipped until then. A confirmed line expands to N units of its own variant, frozen with the order.

## 8. Documents

- Totals per VAT rate equal what was paid. One helper (`presentGiftLines`) is called by the invoice and the receipt mapper.
- Gift forms, set per connection: **omit** (default), **show at 0,00**, **priced in**, **internal record** only. Where a provider refuses a zero line, the grosz comes from a same-rate paid line. A document never carries a 0,00 line for a provider that refuses zero, and a receipt always counts as refusing zero.
- "Show at 0,00" is offered only for providers that declare `acceptsZeroValueLine()` (KSeF and inFakt yes; eparagony and Subiekt documents no).
- A whole-order discount is spread proportionally and shown; the remainder goes to the largest paid line, never to a gift line.
- **Decision A - a bundle on a document follows its VAT rates, automatically (no setting).** If every component's catalogue rate equals the set line's rate, the set stays one line. If the rates differ, the set is shown as its components, each at its own catalogue rate; the price the buyer paid is split in proportion to standalone prices (cost when a component is not sold alone), the remainder goes to the largest component, and the discount is built into the unit prices (no negative lines, no 0,00 line). If a component's rate, or both its price and cost, is unknown, nothing is guessed: the document is held with the reason `bundle-split-unknown`. It applies to invoices and receipts. A returned component credits its own line; a whole-set return credits every component line. Research basis, not legal advice: a set of goods with different rates is separate supplies, each taxed at its own rate (Ministry of Finance, KIS and NSA positions); one "set" line is acceptable only when every component has the same rate; proportional to standalone prices is the accepted split; on a receipt one name is bound to one rate on the register, so a component must appear under its own name at its own rate.
- **Decision B - a gift whose VAT rate matches no paid line**, chosen per connection in `config.giftOnDocuments.differentRateGift`: **priced in** (default; the gift at its own rate with a share of the payment proportional to its standalone price, cost when not sold alone) or **technical cent** (the gift at 0,01 taken from the largest paid line). Research basis, not legal advice: a gift tied to a purchase is part of the paid sale, so shifting its value away from a higher-rate item is the direction the tax authority warns about. Industry tools (BaseLinker, IdoSell) use a 0,01 technical price; fiscal software refuses a 0,00 line and a receipt cannot carry a negative sale line. The `internal record` form is unchanged.

## 9. Returns of one component

Returns stay at the commercial line. A return of one component restocks that component (the restock target reads the frozen expansion). The price split is computed at return time, with the Allegro formula ("paid minus full price of kept items, min 0") as an editable hint, never automatic. A kept gift is a decision; it is never auto-deducted.

## 10. What each integration does

| Integration | Must | Can ignore |
|---|---|---|
| Allegro | set `packQuantity` from the offer's set quantity when it is a multipack | gifts, bundles |
| Erli | nothing | everything |
| PrestaShop source | split a cart-rule gift into its own line, price 0, `gift.source='cart-rule'` | bundles |
| PrestaShop master | optional `BundleReader` for packs | - |
| PrestaShop / WooCommerce / Shoper destination | nothing: a gift is a 0,00 line, a bundle is its variant | - |
| WooCommerce source | nothing (may set `gift` when a plugin marks a line) | bundles |
| Shoper source | collapse bundle children into the parent line; set `gift` for gift-app lines | - |
| IdoSell, Empik (later) | map gift modes to `gift` | bundles |
| Subiekt master | optional `BundleReader` for komplety | - |
| KSeF, inFakt | optional `acceptsZeroValueLine() = true` | everything else |
| eparagony, Subiekt documents | optional `acceptsZeroValueLine() = false` | everything else |

Defaults keep a non-implementing adapter correct: no `gift` is an ordinary line, no `packQuantity` is 1, no `ZeroValueLineSupport` means "show at 0,00" is not offered, no `BundleReader` means the composition is entered in OpenLinker.

## 11. What the operator sees

- Product list: bundles marked, availability with the limiting component, one "availability unknown" state with a one-sentence reason (`products/list`).
- Order detail: the bundle once as one line, a gift once in its line with its cost, no separate gift section (`order/bundle`).
- Held multipack with the "This offer sells N x product" action (`order/multipack-held`) and its result (`order/multipack-created`).
- Bench: the bundle's components as picks, a header "Set X of Y" (`bench/in-progress`).

## 12. Out of scope

- Nested bundles, dynamic or build-your-own bundles.
- A money budget for gift rules (unit cap and "stop when out of stock" instead).
- Retroactive gifts on past orders; the order-placed date is the only date.
- Automatic OSS invoicing for a gift in a foreign VAT rate (blocked by the generic "no document route" reason for now).
- A diff screen for a PrestaShop or Subiekt composition (one-way import on demand).
- Bundle analytics beyond the gift cost report (#3588).

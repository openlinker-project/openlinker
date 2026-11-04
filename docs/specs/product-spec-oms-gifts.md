# Product Spec - Gifts

**Status:** draft. **Issue:** #3936 (epic #3935). **Decision record:** [ADR-083](../architecture/adrs/083-commercial-and-physical-order-lines.md), including its amendment for gift forms on documents.
**Sibling spec:** [product-spec-oms-bundles-and-kits](./product-spec-oms-bundles-and-kits.md) (the gift line attribute and the gift slot in a bundle are defined there; this spec adds the rules and the document forms).
**Mockup:** `docs/plans/mockups/oms-mvp/m31-gifts.html`. States used below: `promotions/list`, `promotions/new-template`, `promotions/composer-product`, `promotions/composer-basket`, `promotions/composer-per-unit`, `promotions/more-options`, `promotions/active`, `promotions/paused-out-of-stock`, `promotions/limit-reached`, `promotions/ended`, `promotions/edited-open-orders`, `promotions/gift-no-cost`, `promotions/test-two-match`, `promotions/test-skip-if-present`, `promotions/test-customer-limit`, `promotions/viewer-readonly`, `order/gift-ol-only`, `order/gift-ol-only-shop-packs`, `order/gift-from-channel`, `order/gift-from-channel-shoper`, `order/gift-out-of-stock`, `order/gift-not-added*`, `order/add-gift`, `order/add-gift-document`, `order/add-gift-parcel-closed`, `returns/gift`, `settings/default`, `settings/connection-gifts-tab`, `settings/gift-other-rate`, `settings/gift-other-rate-grosz`, `settings/show-gift-ksef`, `settings/show-gift-receipt`, `settings/internal-record`, `settings/viewer-readonly`.
**Design source:** `docs/plans/analysis/spike-bundles-and-gifts/ports-v1.md`, `rules-check/0-synthesis.md` (P1-P5, O1-O4, D1, D6, C2, C3), `ux-compare/1-promotions.md`, `ux-compare/3-operations.md`.

---

## 1. Problem

A seller wants to say "buy X, get a spoon". Allegro and Erli know nothing about gifts, so the gift must live in OpenLinker. The shop may know the gift (a PrestaShop cart rule), or may not. Today:

- an OL-only gift cannot be added at all;
- a gift the channel sends is an ordinary 0.00 line, so nobody knows it is a gift or what it costs;
- the document does not say how to show a gift, and fiscal software refuses a 0.00 line.

## 2. Decisions

| # | Decision |
|---|---|
| G1 | A gift is a **line attribute** (`gift.source`: `channel`, `cart-rule`, `ol-rule`, `operator`), never a separate entity. It already exists on the order line (see the bundles spec, section 6). |
| G2 | OL gift rules are a **new action "add gift"** in the existing automation engine (`libs/core/src/automation`). Storage, AND-only conditions, dry run, run history and at-most-once firing are reused. No new promotion engine. |
| G3 | The action is evaluated **inline at ingestion**, before reservation and routing, and writes `addedLines` in the order edits overlay. The channel snapshot stays the channel original. |
| G4 | One choice, the **gift form on documents**, with four options and three levels (section 8). |
| G5 | A kept gift in a return is **never deducted automatically**. |

## 3. Gift on the order line

A gift line has `gift: { source, ruleRef? }` and price 0.

| Source | Who says it | Where the line lives |
|---|---|---|
| `channel` | the channel (Shoper gift apps, WooCommerce plugin lines, later IdoSell and Empik) | `order.items`, as received |
| `cart-rule` | the PrestaShop adapter splits a cart-rule gift into its own 0.00 line and lowers the discount by the same amount | `order.items` |
| `ol-rule` | an OL gift rule at ingestion | `OrderEdits.addedLines`, key `ol-gift:{ruleId}:{lineId}` |
| `operator` | a person, by hand | `OrderEdits.addedLines`, key `op-gift:{changeId}` |

The gift leaves the warehouse like any line: reservation, work, bench scan, decrement with reason `gift`. Cancelling gives stock back. The gift shows once, in its line, with its cost: "customer pays 0.00, costs you X" (`order/gift-ol-only`, `order/gift-from-channel`). There is no separate gift section.

With OMS on, an OL gift is reserved, routed and packed. With OMS off, the destination shop receives it as a 0.00 line (`order/gift-ol-only-shop-packs` shows the shop-packs case).

## 4. The gift rule

A gift rule is an automation rule with one action, **add gift**: product (or variant), quantity, optional "for every unit bought" mode. It is created from the promotions list (`promotions/list`, `promotions/new-template`) and stored in the automation tables like every other rule.

### 4.1 Conditions (AND only)

Closed vocabulary, like all automation conditions:

- the order contains a product or bundle (`promotions/composer-product`);
- the order total is at least X, in one currency, compared and never converted (`promotions/composer-basket`);
- channel (default: all);
- period: start now, end optional.

"For every unit bought" shows only "max per order" (`promotions/composer-per-unit`). "1 gift per N" stays hidden under More options and is optional.

### 4.2 Rule decisions

These come from the 7-competitor check. Each one removes a field instead of adding one.

| # | Rule | Decision |
|---|---|---|
| R1 | Cap | A **unit cap** for the whole rule. No money budget. The list shows "given / cap" and the cost so far (`promotions/limit-reached`). |
| R2 | Out of stock | The rule **pauses itself** when the gift is out of stock. The order goes on without the gift and carries a visible note (`order/gift-out-of-stock`). The list shows "Paused: gift out of stock" (`promotions/paused-out-of-stock`). It resumes when stock returns. No "hold the order" and no substitute option; a substitute is a second rule lower in the list. |
| R3 | Order of rules | **List order** plus one switch "do not combine with others". The default is that every matching rule fires. A rule with the switch on stops the rules below it. Order controls appear only when some rule has the switch on. |
| R4 | Date | The **order-placed date** only. No choice. A rule is never applied backwards to a past order. A rule created today acts only on orders placed after it was saved. |
| R5 | Skip if present | "Skip if the product is already in the order" is **on by default**. It also looks inside bundle components (`promotions/test-skip-if-present`). Reason: on Allegro a gift is often a component of the set, and a double gift costs more than a missing one. This is an OL decision, not a market standard. |
| R6 | Ended rules | Stay **editable**, plus a **Copy** action and "Extend and resume" (`promotions/ended`). Open orders keep what they got; editing a rule does not change them (`promotions/edited-open-orders`). |
| R7 | Customer limit | Optional. The key is the **resolved customer** of OpenLinker (customer identity resolution), not the channel buyer id. It may ship after the pilot. When it blocks, the order shows why (`order/gift-not-added-customer-limit`, `promotions/test-customer-limit`). |

### 4.3 What the composer shows

Four fields up front: type (three cards), "customer buys", gift and quantity (with the line "customer pays 0.00, costs you X per unit", `promotions/gift-no-cost` when the cost is unknown), channels, period. Everything else is folded under **More options** with a one-line summary of the defaults, for example "combines with others, no unit cap, pauses when the gift runs out" (`promotions/more-options`). A per-gift field "On the document" sits in More options (section 8).

### 4.4 Test on a sample order

The composer has a dry run that writes nothing, reusing the automation dry run. It names the reason when a rule does not apply: two rules match, product already present, below the threshold, customer limit, shop rejected (`promotions/test-two-match`, `order/gift-not-added*`).

### 4.5 Evaluation at ingestion

- The evaluator is the pure automation evaluator. The new trigger point is "order ingested", evaluated inline in the ingestion transaction path, after the overlay is applied and before reservation.
- The result is written once to `OrderEdits.addedLines` and the overlay is re-applied. A re-ingestion converges on the same keys, so a gift is never added twice.
- Adding a gift line is reversible until the parcel is closed, so the irreversible-action gate (ADR-041 rule for A1 and A2) does not apply. Several rules may fire.
- A failure to read the gift's stock does not block the order. The rule reports "stock unknown", the gift is not added, and the order carries a note. An unknown number is never read as zero.
- A rule that cannot fire is a named outcome in the run history, never silence.

## 5. Manual gift

An operator can add a gift to an order **until the parcel is closed**, and is refused after (`order/add-gift`, `order/add-gift-parcel-closed`). If a sales document already exists, one warning says so (`order/add-gift-document`). The dialog has the product, the quantity and the field "On the document". The line is stored as `addedLines` with key `op-gift:{changeId}`.

## 6. Inbound gifts from a channel

- PrestaShop source: a cart-rule gift becomes its own line with price 0 and `gift.source = 'cart-rule'`, and the cart-rule discount is lowered by the same amount. The amendment diff compares against this split shape.
- Shoper source: gift-app lines get `gift.source = 'channel'` (`order/gift-from-channel-shoper`).
- WooCommerce source: sets `gift` only when a plugin marks the line.
- IdoSell and Empik come later and map their gift modes to `gift`.
- Allegro and Erli send no gifts. Gifts exist there only through OL rules or the operator.

An adapter that sets no `gift` produces an ordinary line, exactly as today.

## 7. Double-gift risk

A PrestaShop shop with a cart-rule gift plus an OL rule for the same product could give two. The composer shows one marker per selected channel ("OpenLinker only", "the shop has a cart rule") and the "skip if present" default (R5) is the guard. Full text appears only where the operator must act.

## 8. Documents

### 8.1 Research basis (not legal advice)

A gift tied to a purchase is part of the paid sale, not a free transfer. A gift left off the documents was treated by a court (WSA Krakow) as a free transfer: VAT on cost price and an internal document. Fiscal software refuses a 0.00 line. Market practice: BaseLinker and IdoSell POS put the gift at 0.01 and take the cent from other items; IdoSell lets the seller choose 1.00, 0.00, merged, or not on documents; Sellasist shows the gift at full price with a cancelling discount line in the same rate, or hides it.

### 8.2 One choice, four options

The totals on a document always equal what the buyer paid. Worked example: the buyer paid 100.00 for a book (price 100) plus a mug gift (price 20).

| Option | What the document shows | Example |
|---|---|---|
| `technical-cent` (**default**) | the gift at 0.01; the cent is taken from the most expensive paid line, whatever its rate | 99.99 / 0.01 |
| `priced-in` | the gift at its own rate; a share of the payment proportional to its standalone price (cost when it is not sold alone) | 83.33 / 16.67 |
| `show-zero` | the gift at 0.00. Offered only where the document provider declares `acceptsZeroValueLine()` (KSeF and inFakt yes; eparagony and Subiekt documents no; a receipt always counts as no) | 100.00 / 0.00 |
| `omit` | no gift line. Warning shown: this may be treated as a free transfer | 100.00 / - |

`internal-record` stays as it is today: a record of the gift's issue, extended by this epic. It is not an option of the choice above, it complements it (`settings/internal-record`).

A document never carries a 0.00 line for a provider that refuses zero. The helper `presentGiftLines` in `sales-documents` is the single place that applies the form. It is called by the invoice mapper and the receipt mapper. A whole-order discount is spread proportionally and shown; the remainder goes to the largest paid line, never to a gift line.

The separate "gift in another VAT rate" choice (`differentRateGift`) is merged into this one choice. `technical-cent` always takes the cent from the most expensive paid line, so a gift whose rate matches no paid line needs no extra setting (`settings/gift-other-rate`, `settings/gift-other-rate-grosz`).

### 8.3 Three levels, most specific wins

1. **The gift itself**: a gift rule, a gift slot in a bundle, or a manual add.
2. **The connection** (the sales-document connection).
3. **OpenLinker-wide default**: `technical-cent`.

Each gift shows where its form came from ("from the rule", "from the connection", "OpenLinker default").

### 8.4 Where it is set

- OpenLinker-wide default: **Settings > Sales documents** (`settings/default`).
- Per connection: a new tab **Gifts on documents** on **Connection > Mappings**, next to "Delivery on documents" (`settings/connection-gifts-tab`).
- Per gift: the field **On the document** in the rule composer (More options), in the bundle gift-slot menu and in the manual add-gift dialog.
- A viewer sees all of it read-only (`settings/viewer-readonly`, `promotions/viewer-readonly`).
- `show-zero` is shown disabled with a reason when the provider does not accept a zero line (`settings/show-gift-receipt`; `settings/show-gift-ksef` shows the allowed case).

### 8.5 Bundles on documents

Decided in the bundles epic (ADR-083 amendment): one line when every component shares the set's VAT rate; otherwise each component at its own catalogue rate with the paid price split by standalone price. Unknown data holds the document with the reason `bundle-split-unknown`. A gift slot inside a bundle follows the gift form like any gift.

## 9. Returns

A return of a line that has a gift does not change the gift. A **kept gift is a decision**: OpenLinker never deducts it from the refund automatically (`returns/gift`). The operator sees the Allegro-style amount ("paid minus full price of kept items, minimum 0") as an editable hint. It is never applied on its own. A returned gift restocks like any returned line.

## 10. What each integration does

| Integration | Must | Can ignore |
|---|---|---|
| Allegro, Erli | nothing | gifts (rules and the operator add them in OL) |
| PrestaShop source | split a cart-rule gift into its own line, price 0 | - |
| Shoper source | set `gift` for gift-app lines | - |
| WooCommerce source | optionally set `gift` when a plugin marks a line | - |
| IdoSell, Empik (later) | map gift modes to `gift` | - |
| Destination shops | nothing: a gift is a 0.00 line | - |
| KSeF, inFakt | optional `acceptsZeroValueLine() = true` | - |
| eparagony, Subiekt documents | optional `acceptsZeroValueLine() = false` | - |

A provider that declares nothing never gets `show-zero` offered.

## 11. Changes to earlier decisions

- The bundles PR (#3957) ships a per-connection `config.giftOnDocuments` with default `omit` and a field `differentRateGift` (`priced-in` or `technical-cent`). This epic **replaces** both with the three-level model in section 8: one choice, four options, default `technical-cent`. The `differentRateGift` field is removed, and the default moves from `omit` to `technical-cent`.
- The issue text said "forms from #3930, default omit". That is replaced by section 8.
- The bundles spec section 8 (gift forms, Decision B) is superseded by section 8 here. Decision A (bundles follow their VAT rates) is unchanged.

## 12. Operator reporting

A report "cost of gifts" and a yearly CSV per customer for the accountant. No enforcement and no limit check (C2 is simplified to an export). No hold on gift documents (C3 is dropped).

## 13. Out of scope

- A money budget for gift rules (unit cap and pause on stock-out instead).
- Applying a rule to past orders.
- Holding every gift document for approval.
- Automatic OSS invoicing for a gift in a foreign VAT rate (blocked by the generic "no document route" reason for now).
- A substitute gift option (use a second rule lower in the list).
- "Hold the order" when the gift is missing.

## 14. Acceptance (for the epic)

- A rule adds an OL gift at ingestion on Allegro and Erli orders, before reservation, once per order, and re-ingestion does not add it twice.
- The gift is reserved, packed and decremented with reason `gift`. Cancelling returns stock.
- The unit cap and the stock-out pause work and are visible on the list.
- The dry run names the reason for every non-application.
- Documents follow the form resolved at the three levels, and totals equal what was paid for every form.
- A kept gift is never deducted automatically.

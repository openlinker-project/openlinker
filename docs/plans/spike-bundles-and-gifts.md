# Spike: bundles (zestawy) and free gifts (gratisy)

Date: 2026-11-04. Status: research done, scope proposed, nothing changed on GitHub.
Final page for the team (Polish conclusions, English UX tabs): https://claude.ai/artifact/XEEyNyrx3v4MMk5NsYesKt
Earlier versions: round 1 https://claude.ai/artifact/WPo6xFix43634YFQbu8Vua, round 2 https://claude.ai/artifact/RgwpNzyoL5yEXfMGJF3T4D.
Feeds: #3520 (G15 epic), #3606, #3607, #3624, #3625, and a new G20 gifts epic.

All reports, the claim register and the use cases are in `docs/plans/analysis/spike-bundles-and-gifts/` (uncommitted working material).

## Method

- **Five rounds.**
  - Rounds 1-2: problem side (channels, merchants) and solution side (7 competitors), plus three code reviews.
  - Round 3: blind repeat, no access to earlier rounds.
  - Round 4: primary sources only (API specs, source code, official help, changelogs), every claim quoted verbatim.
  - Round 5: red team; given our conclusions with the task of refuting them (8 agents).
- **Live tests.**
  - eparagony sandbox, twice.
  - A throwaway PrestaShop 9.0.2 stack, orders through the real `validateOrder` path.
- **Targeted verifiers.** Allegro line price semantics, the component line id against the schema, the bundle price split method in law, nesting and gift stock-out policies, and a stress test of the proposed standard.
- **Claim register.** 80 claims, each with a verdict:
  - confirmed: two independent sources, or a live test;
  - probable: one primary source;
  - disputed;
  - refuted.
- **Use cases.** 71 written out: actor, trigger, flows, channel data, Given/When/Then, priority, evidence and risks.
- **Competitor matrix consistency.**
  - 301 cells across rounds 1-4.
  - All rounds agree on 46% of cells; two rounds agree on 67% on average.
  - Most disagreements are "Full" against "Partial", a rubric difference rather than a factual one. Only 3 cells are "Full" against "None".
  - Treat competitor ratings as direction, not as numbers to compare.

## Findings that changed after rounds 1-2

1. **Allegro does send composition** (C-027 refuted). It sends `offer.productSet.products[]{id, quantity}`, but the ids are Allegro catalogue UUIDs that do not map to OL variants. Usable only as a check.
2. **Allegro price semantics.** `price` and `originalPrice` are unit prices. On a productSet line, `quantity` counts sets. The Allegro Ceny subsidy is only in `lineItems[].reconciliation`.
3. **The round 1 gift document recommendation is withdrawn.** "List price + 100% line rebate" is what KIS 0114-KDIP1-1.4012.876.2025.2.IZ (23.01.2026) classed as a free supply (art. 7 ust. 2), not a discount. ADR-082 decision 7 already forbids zero lines on receipts. Lower-risk forms:
   - an allocated positive share of the paid total;
   - a 1 grosz line;
   - an internal art. 7 ust. 2 record with no line on the buyer's document.

   Omitting the gift is tax-neutral only at the same VAT rate. Research only, not legal advice.
4. **The code impact is 9 sites, not "6 collisions".** Storage takes the derived component id; the shipment-lines collision is refuted. The order-edit follow-ups and the return restock silently miss bundle components.
5. **Nesting is not universally forbidden.** Cin7 allows multi-level assemblies. The BaseLinker "no nesting" quote was about a different API field (`relations`).
6. **Gift stock-out.** Several competitors do have a policy (stop the offer, block, wait, add anyway). None swaps the gift or tells the buyer.
7. **Shopify publishes its bundle price split.** Weights are unit price x quantity, tax on components. This matches the MF 2017 notice (proportional to standalone prices is "prawidłowe"), CJEU CPP and BFH XI R 19/23 (no component above its standalone price).
8. **Small-gift limit is 20 zl** (since 2021), measured on purchase cost. The 2019 cash-register regulation is repealed; receipt content is now Dz.U. 2025 poz. 845 par. 26 and, for online kasy, Dz.U. 2024 poz. 1654 par. 22.

## Live defect found (Stage 0)

**PrestaShop pack under OMS routing is a silent oversell, confirmed live on 9.0.2.**
- The sale decrement writes only the pack's own `stock_availables` row, so the components never decrease.
- In no `pack_stock_type` does a webservice PUT reach the components.
- With type 1 (products only), OL's write changes nothing the shop sells.

## Decisions (full records with evidence on the page)

- **Q1 Facts and platform facts.** Order facts are three-state fields. "This channel emits bundle children as lines" is a manifest value (`variantGrouping` precedent, most-restrictive default) or an operator setting. Never a capability name.
- **Q2 Gift recognition.** Never from price (0.01). Gifts come only from a channel flag (IdoSell `orderSalesMode`, Mirakl `offered_quantity`), an operator rule or an operator action.
- **Q3 Bundle source.** Pilot bundle = master variant + OL definition (D3); masters' packs are not imported. Warn when the definition sits over a pack with its own stock.
- **Q4 Subiekt komplety.** Not in the pilot. A komplet has its own stock only after assembly.
- **Q5 OrderLineAdder.** Later. The pilot gift is a packer note plus a manual stock correction.
- **Q6 Component line id.**
  - Derived `{lineId}~c:{componentVariantId}` from a per-order frozen expansion, used on the fulfilment path only.
  - `~g:` is reserved for a gift.
  - Documents, shipment lines and returns stay on the bundle line.
  - The 4 edit/return sites are guarded, not built.
  - R5-6's "expand in `toDomain`" was rejected: documents would need component prices in the pilot.
- **Q7 Analytics.** Revenue on the bundle line. Bundle cost entered on the bundle variant before the pilot, because cost snapshots are never upgraded later.
- **Q8 Gift on documents.** An operator setting. Safe default: same-rate gift omitted from the receipt, cross-rate gift refused with a named reason, until a tax adviser decides.
- **Q9 Pre-built kits with own stock.** Not in the pilot.
- **Q10 Order of work.** Staged, below.
- **Q11 Bundle price split.**
  - Default: computed at sale from standalone gross prices x qty (master catalogue, purchase cost as fallback), stored on the order.
  - Operator override only with a reason, an exact sum and no component above its standalone price.
- **Q12 Nesting.** Forbidden as an OL choice, not as a market standard.

## The standard (integration- and country-agnostic)

- **Per-order fact:** a three-state field (absent = cannot say, `null` = checked and none, value).
- **Platform fact:** a manifest value with a most-restrictive default.
- **Business or tax choice:** an operator setting in the ADR-082 shape. Core never picks a tax treatment (ADR-063, ADR-026).
- **Device limit:** a REQUIRED method on `InvoicingPort` / `FiscalizationPort` (ADR-046 with `declared` / `resolvedVia`). Absence means refuse with a reason, never a silent document change (ADR-014).
- **Action in a channel:** a guard-only capability, only once it has an implementer (ADR-048 decision 1).
- **Dropped from rounds 1-2:**
  - `MasterBundleStockReader` (pack composition is a three-state `Product` field instead);
  - `OrderCreateLineStockEffect`;
  - `BundleListingSupportDeclarer`;
  - source reporters as capabilities;
  - the "2-4 declarations" cost estimate, since each guard-only declaration also needs a server read and a frontend mirror.

## Staged scope

**Stage 0, always, 3-9 dev-days.**
- PrestaShop `adjustInventory` refuses a components/both pack with a typed error that lands as `blocked`.
- Discount and delivery remainders never land on a zero-gross line (guard the zero-rate bucket).
- eparagony: pre-check a VAT rate's value after rebates and give a readable cause for error 41.
- Allegro: hold an order with a productSet quantity above 1 on a single-variant mapping (multipacks after 12.01.2027).
- Allegro: map paid gift wrap (`GIFT_WRAP`), which today blocks the document.
- Erli: EUR orders are booked as PLN, and non-PL rates are labelled PL.
- One live read of the Shoper set order shape.
- Process only: gift as a packer note, kit cost entered on the variant.

**Stage 0.5, no dev.** The pilot client's answers (6 questions) and a start with the tax adviser (5 questions).

**Stage 1, only if the client sells OL-packed kits on routed channels, 20-30 dev-days.**
- Definitions: unique, no nesting, refused on children-emitting channels.
- `order_line_bundle_expansions`, written in the first-`ready` transaction with a negative fact for every evaluated line. It also stores the component productId and catalogue gross.
- Expansion at 3 call sites, plus the cancel republish.
- Bundle ATP in `IAvailabilityService` with a component-to-bundle recompute trigger.
- Guards (`LINE_IS_BUNDLE`, manual return restock), and a spec pinning today's absorbed-hold behaviour.
- Minimal frontend and one E2E.

**Stage 2, post-pilot, 20-35 dev-days.** Bundle documents and component returns from the stored split (after the tax adviser), channel shapes as recognition aids, the shipped relay, and cost = sum.

**Stage 3, 25-45 dev-days.** G20 gifts: neutral adjustments, add-line in core, the automation gift rule, the stock-out policy, the document treatment setting, and `OrderLineAdder`.

## Open questions

**Pilot client**
1. Which channels carry sets and gifts?
2. On Allegro: a productSet offer, a multipack or an offer bundle?
3. Are there pre-built gift boxes with their own stock?
4. How are gifts promised and added today?
5. eparagony or Subiekt, and are there mixed-VAT kits?
6. Are there PrestaShop packs, and in which `pack_stock_type`?

**Tax adviser**
1. Does presentation decide (0 / 100% rebate means a free supply, an allocated price means a paid one)?
2. Does a proportional split by list price survive an audit?
3. Does a marketplace-funded gift change the classification?
4. Cross-rate gift handling.
5. A bundle priced above the sum of its parts.

**Still unverified live**
- Shoper set shape (no credentials).
- Subiekt komplet and the GT bridge `PominAsortymentPowiazany` (needs the user's Windows machine).
- Whether Mirakl `offered_quantity` is inside `quantity`.

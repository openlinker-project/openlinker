# Rules check 5: global OMS (Linnworks, Cin7 Core / Omni, Brightpearl)

Date: 2026-11-04. Read-only. Checks the 21 prototype rules in `../rules-to-verify.md` (P1-P5, O1-O4, D1-D6, C1-C3) against what Linnworks, Cin7 and Brightpearl actually do. Team bias: simple, working, no reinvented wheel.

## How the evidence was gathered

- Reused rounds r1-r4 phase2 files for these three vendors and `r5/5-competitors-global.md`. Quotes taken from those are marked "(rN)".
- New primary fetches today (marked "(new)"):
  - Linnworks docs as `.md` exports: `rules-engine`, `rules-engine-add`, `rules-engine-edit`, `rules-engine-actions`, `rules-engine-conditions-comparators`, `adding-items-services-merged-split-resend-orders`, `rma-refunds`, `open-orders-order-calculations`, `general-order-management`, `processed-orders` (all `https://docs.linnworks.com/articles/documentation/<slug>`).
  - Cin7 Core help via the Zendesk JSON API: Product Deals (9034519918095, updated 2026-11-03), Discounts (9034464989327, updated 2026-11-03); 1,089 community feature-request titles paged, 15 posts read in full.
  - Brightpearl help via Wayback raw snapshots: Automation conditions overview (snapshot 2023-01, "Updated May 23, 2022"), Automation FAQs (2022-07), Release notes for Automation (2022-07), Add a free SKU action (2022-10), BigCommerce orders (2023-02).
  - Rishvi partner macro doc for Linnworks (third party, live).
- Web search hit a spend limit mid-session, so merchant voice for Linnworks and Brightpearl is thin (their forums are login-gated or redirect). Cin7's community is public and gives most of the user-complaint evidence below. Brightpearl help is 2020-2023 content; current state not verifiable.
- None of the three is a Polish product, so anything about PL fiscal receipts, the 0,01 zl convention, Allegro buyer ids or VAT art. 7 ust. 3-4 has no direct counterpart. Where that is the case it says so.

## Summary table

| Rule | Linnworks | Cin7 | Brightpearl | Recommendation |
|---|---|---|---|---|
| P1 gift skipped if bundle contains it | Condition "Has composites", "Item count (no children)"; no gift-in-bundle check | No evidence | "Contains SKU ... NONE rows" condition can express it | SIMPLIFY |
| P2 per-customer limit by channel buyer id | No customer counter | Per-customer only via coupon codes | No counter; customer matched by email | ADOPT (if kept), else DROP limit for v1 |
| P3 priority + "does not combine" | Rules run in list order, numbered | "Discounts do not stack", best discount wins, fixed priority ladder | Rules run in on-screen order, once per order | SIMPLIFY |
| P4 budget auto-pause | No evidence | No evidence (coupon quantity only) | No evidence | DROP |
| P5 which date + per-unit gift | Only "Received day/hour" | Order-entry date only (merchants ask for a toggle); "3 for the price of 1" per unit | Both "Placed on date" and "Created date" conditions | ADOPT (date), SIMPLIFY (per-unit) |
| O1 `ol-gift:{ruleId}:{lineId}` | Duplicate guards by conditions | No evidence | "each rule may only act ... once" | ADOPT |
| O2 manual add by stage | Edit in Open Orders; Processed orders not editable | Add line at Quote/Order; after invoice -> credit note | "cannot be applied to an invoiced order" | SIMPLIFY |
| O3 multipack hold + re-check | "All items are linked" gate | Order held/skipped until mapped | Unknown SKU -> unshippable misc row, re-download | ADOPT (as generic "unmapped line" hold) |
| O4 ended promo read-only, duplicate | Rules editable any time; Copy button | Deals editable; users ask to delete old deals | Rules editable | SIMPLIFY |
| D1 0,01 taken from a paid line | Partner macro takes free-line value off a paid line | No evidence | No evidence | ADOPT (simplified selection) |
| D2 split line so qty x price fits | No evidence | Unit price kept at 4 decimals | "reconciliation line" when unit x qty drifts | SIMPLIFY |
| D3 remainder to largest paid line | Even split ("AllEvenly") | Proportional (Shopify) | Weighted average + reconciliation line | ADOPT |
| D4 hold until "spread the discount" | Auto-spread per connector | Auto proportional or one order-level charge | Auto weighted spread | DROP the hold |
| D5 EUR foreign-VAT order held | No evidence | Order skipped until tax rules mapped | Tax codes from own rules | SIMPLIFY |
| D6a match return to line without bundle discount | Operator picks lines | Manual credit note | Operator picks lines | SIMPLIFY |
| D6b kept gift never auto-deducted | Nothing automatic | Nothing automatic | Nothing automatic | ADOPT |
| D6c claw-back proposal | Manual "Additional refund" | No evidence | Manual credit value | DROP (manual amount) |
| C1 "take composition from PrestaShop" | Composite must "exactly match"; no import from channel | No channel import | "not possible to import a bundle from Shopify" | SIMPLIFY |
| C2 small-gift register by customer | No evidence | Users ask for a 100%-discount report | Custom field + nominal code by hand | SIMPLIFY |
| C3 "hold every document with a gift" option | No evidence | No evidence | No evidence | DROP |

## Per-rule detail

### P1. Gift skipped when the bundle in the order already contains the gift product

- **Linnworks**: no gift concept. Bundle-aware conditions exist: "Has composites", "Item count (no children)", "Line count (no parents)" (r4, `docs:rules-engine-conditions-comparators`). Nothing compares a rule-added SKU with composite children. No evidence of this exact rule.
- **Cin7**: no evidence. Deals discount lines already on the order, they do not add a gift line at all (see P4/G section below), so the conflict cannot arise natively.
- **Brightpearl**: condition "Contains SKU The sale must contain (or not contain) a specific SKU or set of SKUs" (new, Automation conditions overview, Wayback 2023-01-28, https://help.brightpearl.com/hc/en-us/articles/115001827586). Bundles explode into child rows on save (r3/r4), so "Contains SKU NONE = gift SKU" on a rule would skip the free SKU when a bundle already carries it. That is an operator-built condition, not a built-in rule.
- **Complaints**: none found.
- **Recommendation: SIMPLIFY.** Do not hard-code a special skip rule. Offer the general condition "order does not already contain product X" (checked over exploded bundle components), and make it the default when a rule is created. Why: Brightpearl shows the generic "contains / not contains SKU" condition covers this case without a dedicated mechanism.

### P2. Per-customer gift limit counted by the channel buyer id, not e-mail

- **Linnworks**: no cross-order counter. "Rules engine reads only the current order's flat data; no customer history" (r2, G-15). Conditions include "E-mail address" only (new, `rules-engine-conditions-comparators`: "Email used for dispatching purposes").
- **Cin7**: "Coupons allow you to limit a discount or deal to a certain quantity per customer or to limit a deal to certain customers or groups of customers." and "Single Coupon Code Usage ... the coupon can only be used once." (new, https://help.core.cin7.com/hc/en-us/articles/9034519918095-Product-Deals). The limit hangs on a coupon code, not on a resolved person.
- **Brightpearl**: Automation has no customer-history condition; "each rule may only act on a single sales order once" (new, FAQ Wayback 2022-07-03, https://help.brightpearl.com/hc/en-us/articles/115001827726). Customers are matched by e-mail: "If a new email address is found on the order, a customer will be created in Brightpearl" (r3, Shopify orders). POS discount codes have "Uses Per User" (r3).
- **Complaints**: none specific. Indirect: nobody offers it, so no one complains about the e-mail alias problem.
- **Recommendation: ADOPT if the limit stays in v1; otherwise DROP the limit feature for v1.** If a limit exists, keying it by the channel buyer id is the only correct choice for Allegro (its per-order alias e-mail would make an e-mail key useless) and costs nothing extra because the id is on the order. Why: none of the three has a working per-customer gift limit, so it is optional, but if built, e-mail is provably the wrong key.

### P3. Several matching promotions: priority number; "does not combine" loses to higher priority

- **Linnworks**: "Rules are executed in sequence from the top to the bottom of the list. They each have a number in the *Order* column in the *Rules Engine* screen and execute from the lowest to the highest number." and "If multiple rules could apply to the same order, their **position in the list determines which actions take effect first**." (new, https://docs.linnworks.com/articles/documentation/rules-engine-edit and .../rules-engine-add). All matching rules run; no "exclusive" flag.
- **Cin7**: "If more than one discount applies to a product, only the best discount is applied to a transaction. Discounts do not stack." plus a fixed ladder: "The individual customer level has the highest priority. It overrides all other discounts. If there's no discount at the individual customer level, the customer group discount will be applied." (new, Product Deals and https://help.core.cin7.com/hc/en-us/articles/9034464989327-Discounts). No operator priority number.
- **Brightpearl**: "the order will be processed by the first rule in the list and only then attempt to run the next rule. You can change the priority of your Automation rules by clicking and dragging the rule up and down" (new, Automation FAQs, Wayback 2022-07-03). Release note "Rule prioritisation" (10 April 2017, new). All matching rules act; no exclusive flag.
- **Complaints**: Cin7 "Product Deal Alerts" (4 votes): "a notification triggered when a product deal is available to be applied to a particular sales order, but is not applied" (new, https://help.core.cin7.com/hc/en-us/community/posts/12030996642191). "Multiple Product discounts" (new, post 13325814469007) asks for more combinations, not fewer.
- **Recommendation: SIMPLIFY.** Use list order (drag to reorder, no typed priority numbers) and default "all matching gift rules fire"; keep one per-rule switch "exclusive: if this fires, skip rules below it". Why: two of three use a visible list order instead of numbers, and none needs a two-attribute (priority + combine) model.

### P4. Gift budget (purchase cost); auto-pause when used up; no activation without purchase cost

- **Linnworks**: no evidence. The rule action cannot even read stock: Rules Engine "is currently unable to check an item's available stock level" (r2, RE-CAP).
- **Cin7**: no evidence of a budget. Only coupon quantity limits (P2) and Effective From/To dates (new, Product Deals).
- **Brightpearl**: no evidence of a budget. The free SKU is stock-gated only: "if it's stock tracked it must have an on hand inventory level in the warehouse assigned to the order greater than the number you're trying to add to the order. The item is always added with a price of zero." (new, Add a free SKU action, Wayback 2022-10-07, https://help.brightpearl.com/hc/en-us/articles/360005732518).
- **Complaints**: none about budgets. Real complaint is the opposite, gifts silently not added: Brightpearl stock-out "will not trigger the order status change" (r4, H27).
- **Recommendation: DROP.** Instead: an optional "max gifts given" count (units) plus end date, and the existing gift stock check; show "N given, cost X" as a report, not a gate. Why: no global OMS has a money budget, and a cost-based gate needs reliable purchase costs that many catalogues do not have (the rule itself admits this with its "no cost, no activation" clause).

### P5. Which date counts (placed vs received); gift per qualifying unit

- **Date - Linnworks**: only "Received day", "Received hour", "Received minute" ("The date and time at which the order was placed on the sales channel") (new, `rules-engine-conditions-comparators`). No calendar range; campaigns are switched on and off by hand (r2).
- **Date - Cin7**: deals apply on the system date when the order is entered. Merchant: "Product Deal discounts only automatically apply if the sale order is created during the deal period ... even if we change the sale order date to a date inside the deal period" and proposes "a toggle in General Settings that enables a business to choose which method they want to use for discount application with regard to Deals - system date or sale order date" (new, https://help.core.cin7.com/hc/en-us/community/posts/12012744943375, 2025-02-24).
- **Date - Brightpearl**: both exist as separate conditions: "Placed on date The sale must have been placed (or not placed) within the specific date range." and "Created date The sale must have been created (or not created) within the specific date range." (new, Automation conditions overview).
- **Per unit - Cin7**: "Example 1: 3 for the price of 1 In this deal, for each item bought, two (2) of the same item are free." (new, Product Deals). **Brightpearl**: per-unit "Buy X get Y free" exists only in POS: "Brightpearl POS discounts and promotions can only be applied within POS." (r4, H28). **Linnworks**: fixed quantity per rule action ("Specify how many units of the item should be added", new, `rules-engine-actions`), no per-unit multiplier.
- **Recommendation: ADOPT the date choice (default = placed on channel), SIMPLIFY per-unit** to one integer "1 gift per N qualifying units, max M per order" with no other repetition options. Why: Brightpearl ships both dates and Cin7 users ask for exactly this toggle, while per-unit gifts are offered only by Cin7 and Brightpearl POS, so a single multiplier is enough.

### O1. Gift line id `ol-gift:{ruleId}:{lineId}` (internal, deterministic)

- **Linnworks**: no id; duplicate safety by extra rule conditions. Their own docs explain the failure: "Imagine ORDER A gets a free gift item added by a rule. Later, a resend is created (ORDER B). If you do not filter out resends, ORDER B will also get the same free gift" (new, https://docs.linnworks.com/articles/documentation/adding-items-services-merged-split-resend-orders).
- **Cin7**: no evidence.
- **Brightpearl**: "each rule may only act on a single sales order once. If that order meets the same conditions at a later point, the actions of that rule will not be re-applied (this is to prevent "infinite loops" ...)" (new, Automation FAQs).
- **Complaints**: Linnworks' own warning above (duplicates on merge/split/resend) is the vendor admitting the problem.
- **Recommendation: ADOPT.** Why: a deterministic id is the cheapest way to get Brightpearl's "once per order" guarantee without Linnworks' operator-maintained guard conditions; it is internal and invisible to users.

### O2. Operator adds a gift manually: ok before routing; warn after routing; refuse after packing; warn after invoice

- **Linnworks**: edit in Open Orders ("Add Product", r3 `open-orders-create-edit`); Processed Orders offer only returns, refunds, notes, status, reprint (new, `processed-orders`: "Returns, Exchanges & Resends ... Refunds ... Add note ... Change status ... Reprint label"). So after processing (packing/despatch) it is effectively refused.
- **Cin7**: line discount "can be added at the Quote or Order of a sale order. If you wish to add a discount to sale order lines after the invoice has been authorized, see Customer Credit Notes and Refunds" (new, Discounts article).
- **Brightpearl**: "it's recommended that the rule adding the SKU runs before the sales order is fulfilled. This action also cannot be applied to an invoiced order" (new, Add a free SKU action).
- **Recommendation: SIMPLIFY** to two states: allowed until packed (with a plain warning after routing that a pack task changes), refused after packing. Drop the separate "after invoice" warning; packing comes after invoicing only in unusual flows, and when it does the existing correction path applies. Why: all three draw one hard line (fulfilment / processing / invoice) and do not maintain a four-stage matrix.

### O3. Allegro multipack (productSet qty > 1 on an offer mapped to one variant) is held; "check again" releases after operator defines "3 x coffee"

- **Linnworks**: pre-processing gate "Users can only process orders that ... All items are linked" (new, https://docs.linnworks.com/articles/documentation/general-order-management); multipack = composite of one child x N (r3 "It can be a set of different items or a pack of the same.").
- **Cin7**: hard stops until mapping exists: gift-card orders "will stay in Pending orders without processing until a gift card liability account is mapped" and Woo "Orders will be skipped on download if tax rules are not mapped" (r2/r4, C9/C25). Multipack = Additional Units of Measure or 1-component BOM (r4).
- **Brightpearl**: unknown SKU -> "miscellaneous line item ... cannot be shipped"; fix is create product, delete and re-download (r3/r4, S15/H19). Multipack = bundle with one component qty N.
- **Complaints**: Brightpearl's delete-and-re-download recovery is the clunky part.
- **Recommendation: ADOPT, but as the general "unmapped line" hold, not an Allegro-multipack special case.** Why: every vendor holds an order with an unresolvable line and releases it after mapping; OL's "check again" is better than Brightpearl's delete-and-re-download, and modelling the multipack as a 1-component bundle (x N) matches all three.

### O4. Ended promotion is read-only; to change it you duplicate it

- **Linnworks**: rules are always editable, plus "**Copy**: Clicking on the *copy* icon allows you to copy the existing rule" and enable/disable (new, `rules-engine-edit`). New rules are not retroactive: "Will creating a new rule update existing paid orders? No" (new, `rules-engine`).
- **Cin7**: deals have Active/Inactive and Effective From/To (new, Product Deals). Users ask "Ability to Delete Old Deals" (new, post 10440067696911) - old deals pile up.
- **Brightpearl**: rules editable; no read-only state found.
- **Recommendation: SIMPLIFY.** Keep promotions editable; store the rule snapshot (or rule version) on each gift line at the time it was added so history never changes; add "Copy" and "Archive". Why: none of the three locks ended promotions, and the history argument is already met by snapshotting the gift line, which O1 effectively does.

### D1. Gift on a receipt as 0,01 zl, the grosz taken from a paid line (same VAT rate first) so total = paid

- **Linnworks**: not native. Partner macro "Reduce Item's Discount" (Rishvi, third party): "It finds order items that have been given away free with a 100% discount and changes that discount to a configured value ... The value added to those items is then taken off a paid item on the same order by reducing its PricePerUnit, so the order total stays as close as possible to the original amount." and selection: "the macro picks the first item on the order where CostIncTax is greater than 0 and greater than the rebalance value" (new, https://docs.rishvi.co.uk/linnworks/ris-sm-1015-reduceitemdiscount). Linnworks itself promotes it as "runs as an action of the Rules Engine" (r1, T4).
- **Cin7**: gift = `Discount` 100 ("For free items discount is 100", r4 C14). Zero lines cause accounting trouble: "We don't create zero cost lines in Cin7 Core because Xero will reject whole invoices with zero costs" (r1/r4, C11), and "the sales tax often will not be $0, it will be 1¢ or 2¢ or 3¢" (new, post 11907031201679).
- **Brightpearl**: "The item is always added with a price of zero." (new).
- **Recommendation: ADOPT, with a simpler selection: take the grosz from the largest paid line with the same VAT rate, else the largest paid line.** Why: the only market precedent (Rishvi) does exactly this rebalance and merchants pay for it, which confirms the need; "largest" avoids Rishvi's failure case where no single line is big enough. (PL-specific need for a non-zero receipt line: not covered by these vendors.)

### D2. A line whose value does not divide by qty is split into two lines

- **Linnworks**: no evidence of splitting; discount "backward calculated from the line total, removing the tax" (new, `open-orders-order-calculations`).
- **Cin7**: keeps 4-decimal unit prices: `Total = ROUNDUP(ROUNDUP(Price (100 - Discount)/100, 4)Quantity, 2)` (r4, C14). Complaint: "the system rounds prices to 4 decimal places instead of 2, leading to discrepancies with customer purchase orders" (6 votes, new, post 10816468453391).
- **Brightpearl**: "a reconciliation line is required ... because Brightpearl calculates row totals using unit price multiplied by number of units, instead of taking a row total amount directly from BigCommerce. If this situation occurs, a reconciliation line is required to ensure the order total matches" (new, BigCommerce orders, Wayback 2023-02-03).
- **Recommendation: SIMPLIFY.** Apply the split only where the document format requires 2-decimal unit prices (the fiscal receipt); for invoices pass the exact line total and let the adapter round (ADR-063 already puts rounding in the adapter). Why: competitors either carry more decimals or add one reconciliation line, so splitting lines everywhere is extra complexity; it is justified only on the receipt.

### D3. Rounding remainder (1 grosz) goes to the largest paid line, never to a gift line

- **Linnworks**: order discount `AllEvenly` "split evenly across all items and any applicable postage" (r3/r4, channel integration Orders endpoint). Where the remainder goes: no evidence.
- **Cin7**: Shopify order discounts "proportionally applied to the order lines as a price reduction on each line" (r4, C10). Remainder: no evidence.
- **Brightpearl**: "All discounts, excluding shipping, will be spread across products using a weighted average based on price" (r3, S15) plus reconciliation line (above).
- **Recommendation: ADOPT.** Why: it is the same rule OpenLinker already uses in `splitShippingAcrossRates` ("remainder on the largest part"), and excluding gift lines keeps the 0,01 gift price stable; no competitor offers anything simpler.

### D4. Whole-order discount not allocated by the channel holds the document until the operator clicks "spread the discount"

- **Linnworks**: automatic, per connector: `Discount` + `DiscountType` = AllEvenly / ItemsThenPostage / PostageThenItems (r3/r4).
- **Cin7**: automatic: "Discounts applied to the entire order will be proportionally applied to the order lines as a price reduction on each line" (Shopify) or one order-level additional charge for other channels "without distribution by lines" (r2/r4, C10).
- **Brightpearl**: automatic weighted spread (r3, S15).
- **Complaints**: Cin7 users dislike the non-distributed charge: "Coupon discount price showing as separate line in invoice, it should be Deducted from Product Price. It was worked fine with our previous shopify integration" (new, post 11825652046479).
- **Recommendation: DROP the hold.** Spread proportionally to line values automatically (D3 remainder rule), record that it was spread, and allow the operator to override. Why: all three spread automatically and users complain only when it is not spread; a mandatory click stalls every such order for no decision.

### D5. EUR order with foreign VAT (Erli, DE 19%/7%): no PLN document auto-issued, order waits for review

- **Linnworks**: no evidence of a currency hold. "If Use channel tax setting is enabled, Linnworks will not perform any calculations" (r3, channels-tax).
- **Cin7**: tax mapping gate: "Orders will be skipped on download if tax rules are not mapped." (r4, Woo setup).
- **Brightpearl**: tax codes come from Brightpearl's own tax rules, amounts from the channel (r3, S15/S37).
- **Recommendation: SIMPLIFY.** Make it the general rule "no automatic document when the order's tax rate/country has no configured document route", not an EUR/Erli special case; OL already has the persisted sales-document block reasons (ADR-041, #2100) to carry it. Why: Cin7's "skip until tax mapped" is the same idea, generic, and avoids a currency-specific branch.

### D6. Returns

**(a) Two identical Allegro lines, one in a bundle discount: return matched to the line without the BUNDLE discount**
- **Linnworks**: operator chooses lines in Processed Orders > Refunds; "You cannot refund more than what the buyer paid for a single item." (new, https://docs.linnworks.com/articles/documentation/rma-refunds).
- **Cin7**: credit note lines chosen manually (r1/r2).
- **Brightpearl**: "Select the lines that are being credited, or returned" (r5, BP5).
- **Recommendation: SIMPLIFY.** Pre-select the cheaper-to-refund line as a suggestion only, operator confirms. Why: all three leave line choice to the operator; an automatic match is a guess that changes money.

**(b) A kept gift is never deducted automatically; operator decides**
- All three: nothing automatic. Linnworks "No link between gift and qualifying lines; RMA treats lines independently" (r2, G-11); Cin7 none (r2); Brightpearl "No logic for a gift threshold lost on return" (r3, G-11).
- **Recommendation: ADOPT** (default = do nothing, show a note). Why: matches the whole market and is the simplest safe behaviour.

**(c) Proposal to claw back the lost bundle discount when one component is returned (e.g. 5,33 zl), editable**
- **Linnworks**: manual: "You can use the Additional refund button if you need to add a refund that is not tied to a specific item" (new, `rma-refunds`); r2: "no lost-bundle-discount logic".
- **Cin7**: "No lost-bundle-discount computation" (r2, B-15). Partial refunds are already painful: "When we refund partial refunds ... No credit note for the partial refund value is being created in CIN7. ... This causes manual work" (new, post 12281237958159).
- **Brightpearl**: component rows are 0.00, refund value typed by hand (r3/r4, B-15).
- **Recommendation: DROP the computed proposal.** Show the component's allocated value and let the operator type the refund amount. Why: no vendor computes it, the formula depends on marketplace return rules OL does not control, and a wrong suggested amount is worse than an empty field.

### C1. "Take the composition from PrestaShop" button when OL bundle differs from the PrestaShop pack

- **Linnworks**: no import from channels; Magento switch "Should only be enabled if the bundle parent has a linked SKU to a composite parent in Linnworks with the correct and **exactly matching** child items. When disabled, bundle child and parent items will be downloaded as separate items." (r4, `magento-2-settings`).
- **Cin7**: no import of channel bundle definitions found (r2/r4).
- **Brightpearl**: "Brightpearl bundles need to be created and managed within Brightpearl, it is not possible to import a bundle from Shopify" (r1, S6); "DO NOT Connect Brightpearl bundle to Magento bundle ... any order downloaded will duplicate the bundle" (r4, H16).
- **Complaints**: the mismatch failure is silent in both Linnworks and Brightpearl (double counting); only warnings in docs.
- **Recommendation: SIMPLIFY** to: detect and show the mismatch (that is the part no competitor does and that causes silent errors); the copy button may stay as a one-way, on-demand copy with confirm, never an ongoing sync. Why: everyone keeps the bundle definition in the OMS; the real gap is detection, not synchronisation.

### C2. Small-gift register (PL VAT art. 7 ust. 3-4) keyed by resolved customer, not e-mail

- **Linnworks**: no evidence.
- **Cin7**: no register; users ask for a basic report: "a report showing the total sales quantity for specific SKUs, along with the total quantity of SKUs given away with a 100% discount" (new, post 10642124319247). Samples: "Using a sale with a 100% discount is not the way to go as it is recorded as a sale ... and books COGS instead of the applicable samples account" (new, post 13013247702671).
- **Brightpearl**: manual: custom field "Free sample?" and edit the cost-of-sales journal to "marketing expenses" (r3/r4, H21).
- **Recommendation: SIMPLIFY** to a gift report (who, what, purchase cost, date) keyed by the resolved customer, with per-person yearly totals; no enforcement or blocking. Why: no vendor has a legal register, merchants ask only for reporting, and the PL thresholds are a tax-adviser decision rather than something OL should enforce.

### C3. Separate document option "hold every document with a gift until a decision"

- No evidence in any of the three. Closest patterns are targeted holds (Cin7 "Pending ... until a gift card liability account is mapped", r2) not blanket "hold everything with X".
- **Recommendation: DROP.** Keep the four real options (omit / 1 grosz / priced-in share / internal record); operators who want manual review can pause auto-issue for the connection. Why: a blanket hold creates a queue nobody empties; no vendor offers it.

## Strongest findings

1. **The "spread the discount" hold (D4) goes against every competitor.** Linnworks, Cin7 and Brightpearl all spread whole-order discounts automatically (evenly, proportionally or weighted), and the only user complaint found (Cin7, post 11825652046479) is about a discount NOT being spread into line prices. Auto-spread + D3 remainder rule is the simple, proven path.
2. **The date choice in P5 is real and wanted.** Brightpearl ships two separate conditions ("Placed on date" and "Created date"), and a Cin7 merchant asks for exactly "a toggle ... system date or sale order date" because deals apply only on the entry date. Keep it, default to the channel's placed date.
3. **The 0,01 rebalance (D1) has a paid market precedent; budgets (P4) and a blanket gift hold (C3) have none.** Linnworks merchants buy a partner macro that re-values 100%-discount gift lines and takes the value off a paid line so the total is unchanged. No vendor has a money budget or a "hold every gift document" switch; drop those for simplicity.

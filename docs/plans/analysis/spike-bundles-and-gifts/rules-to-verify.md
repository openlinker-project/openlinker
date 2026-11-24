# Rules to verify (proposals in the UX prototype, not backed by the spike)

Goal of the check: simplicity and working functionality. We do not want to reinvent the wheel. For each rule, find what established tools and real sellers actually do, and recommend: ADOPT as is / SIMPLIFY (to what) / DROP (and what to do instead).

## Promotions
- P1. A gift promotion is skipped when the bundle in the order already contains that gift product as a component.
- P2. Per-customer gift limit is counted by the buyer's id in the channel (Allegro buyer id), not by e-mail (Allegro gives an alias e-mail per order).
- P3. Several matching promotions: priority number decides; a rule marked "does not combine" loses to a higher-priority one.
- P4. Budget: when the gift budget (purchase cost) is used up, the promotion pauses itself and can only be resumed after raising the budget. A promotion whose gift has no purchase cost cannot be activated with a budget.
- P5. Choice of which date counts (order placed vs received by the system), and a gift "per qualifying unit" (e.g. 1 gift per 2 mugs).

## Order and packing
- O1. Gift line id format `ol-gift:{ruleId}:{lineId}` (internal, deterministic).
- O2. Operator adds a gift manually: before routing OK; after routing warn (new pack task); after packing refused; after invoice warn (document has no gift).
- O3. Allegro multipack (productSet quantity > 1 on an offer mapped to a single variant) is held; after the operator defines a bundle "3 x coffee", "check again" releases it.
- O4. An ended promotion is read-only; to change it you duplicate it.

## Documents and returns
- D1. Gift shown on a receipt as 0,01 zł: the grosz is taken from a paid line (same VAT rate first) so the total equals what the buyer paid, instead of adding 0,01 on top.
- D2. A line whose value does not divide evenly by its quantity is split into two lines so qty x unit price matches.
- D3. A rounding remainder (1 grosz) goes to the largest paid line (never to a gift line).
- D4. A whole-order discount (not allocated to lines by the channel) holds the document until the operator clicks "spread the discount", which allocates it proportionally to line values.
- D5. EUR order with foreign VAT (Erli, DE 19%/7%): no PLN document is issued automatically; the order waits for review.
- D6. Returns: (a) two identical Allegro lines (same offer, one in a bundle discount): the return is matched to the line without the BUNDLE discount; (b) a kept gift is never deducted automatically, the operator decides (keep / ask back / deduct); (c) a proposal to claw back the lost bundle discount when one component of a discounted set is returned (e.g. 5,33 zł), editable.

## Configuration and analytics
- C1. A "Take the composition from PrestaShop" button when the OL bundle definition differs from the PrestaShop pack.
- C2. The small-gift register (PL VAT art. 7 ust. 3-4: 100 zł per person per year with a register; 20 zł unit purchase cost without) is keyed by the resolved customer, not by e-mail.
- C3. A separate document option "hold every document with a gift until a decision" (besides omit / 1 grosz / priced-in share / internal record).

## Assumptions only (no behaviour)
- A1. Mock figures in analytics; A2. Shoper issues receipts via eparagony and WooCommerce invoices via inFakt in the previews; A3. EUR rate 4,25.

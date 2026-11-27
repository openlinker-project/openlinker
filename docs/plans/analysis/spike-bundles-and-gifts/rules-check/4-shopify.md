# Rules check 4 - Shopify + leading gift/bundle apps

Date: 2026-11-04. Read-only. Rules from `../rules-to-verify.md` (P1-P5, O1-O4, D1-D6, C1-C3).

## Method and limits

- Reused earlier rounds first: `r1/phase2/6-shopify-admin.md`, `r2/phase2/6-shopify-admin.md`, `r3/phase2/5-shopify.md`, `r4/phase2/5-shopify.md`, `r5/5-competitors-global.md`. Quotes taken from them are marked [r1]..[r5].
- New primary sources this round:
  - help.shopify.com (two pages, read through a summarising fetch tool, marked [fetch]): buy-x-get-y, discount-combinations.
  - shopify.dev official Markdown exports (verbatim): `interfaces/Sale.md`, `objects/DiscountCodeBxgy.md`, `objects/DiscountOnQuantity.md`, `enums/DiscountStatus.md`, `apps/build/orders-fulfillment/order-management-apps/edit-orders.md`.
  - changelog.shopify.com RSS feed + post pages (verbatim).
  - BOGOS (Secomapp; "Free Gifts by Secomapp" is the same app) full docs `https://docs.bogos.io/llms-full.txt` (verbatim).
  - Swap returns help article on BXGY returns (verbatim).
  - App Store low-star reviews for BOGOS and Shopify Bundles (verbatim, merchant voice).
- Not reached: WebSearch/WebFetch hit a spend limit early; help.shopify.com pages beyond the two above and community.shopify.com threads were not fetched this round (I did not try to get past the help-centre bot check). "Gift Box" and "Gift Wrap" apps: no evidence gathered. Where nothing was found, the row says **no evidence**.

## Background in one paragraph

Shopify has no gift type. A gift is a normal line at full `originalUnitPrice` with a 100% discount allocation (BXGY "Free", manual 100% line discount, or Flow "Add for free"). Native BXGY never adds the gift to the cart; apps (BOGOS 5.0 / ~4.6k reviews [r1]) do. Bundles (first-party Shopify Bundles app) are component lines + a price-less `LineItemGroup`. Shopify issues no fiscal documents, so D1-D5 and C2 have no direct Shopify counterpart; only the money-allocation model is comparable.

## Per rule

### P1. Skip the gift promotion when a bundle in the order already contains the gift product
- **Shopify native**: no evidence of such a rule. BXGY only decides which item gets the discount: "The free or discounted 'get' item is never automatically added to the cart." [fetch] https://help.shopify.com/en/manual/discounts/discount-types/buy-x-get-y
- **BOGOS** has the closest equivalent, as an opt-in setting: "**Exclude added product:** Restricts customers from getting a gift if they already have the same item in their cart." Also "**Limit one selection per gift:** Restricts customers from picking a gift item a second time ... even if they meet the conditions of other offers with the same gift." https://docs.bogos.io (llms-full.txt, Settings 2.3 "Gift behavior and prices")
- Bundle-component case specifically: no evidence anywhere.
- Merchant voice: none found for this rule.
- **Recommendation: SIMPLIFY** - make it one opt-in checkbox per promotion, "Skip if the order already contains this product", that looks at all lines including bundle components; BOGOS shows a plain "already in cart" switch is enough and does not need a bundle-specific rule.

### P2. Per-customer gift limit counted by channel buyer id, not e-mail
- **Shopify**: "'Limit to one per customer' lets you limit a customer's email address or phone number to one use of the discount code." [fetch] buy-x-get-y page. API: `appliesOncePerCustomer` "Whether a customer can only use the discount once." https://shopify.dev/docs/api/admin-graphql/latest/objects/DiscountCodeBxgy
- **BOGOS** keys by the logged-in customer account, not by e-mail: "Limit to one use per customers: Customer is only able to get gift from this offer for one time only. Once an order is placed with gift from this offer, customers are not eligible to this offer any more." and "This sub-condition requires customers to log in to your store." (docs.bogos.io, 3.2 Customers' order history)
- Merchant voice: e-mail limit is bypassed with new addresses; apps match on shipping details instead ([r2], community, not re-verified this round).
- **Recommendation: ADOPT** - the channel buyer id is OL's equivalent of BOGOS's "logged-in customer", and Allegro's per-order alias e-mail would make an e-mail key useless.

### P3. Several matching promotions: priority number decides; "does not combine" loses to higher priority
- **Shopify native**: no priority. "then the best discount for the customer's cart is always applied." / "Multiple discounts are applied to an order only when the setting on each discount allows the combination." / "You can have a maximum of 25 active automatic discounts." [fetch] https://help.shopify.com/en/manual/discounts/discount-combinations . Since 2026-07: "Tag your discounts to group them ... Set which tagged discounts can combine." https://changelog.shopify.com/posts/multiple-product-discounts-on-the-same-item
- **BOGOS** does exactly the proposed rule: "**Priority:** Set a numerical priority level for this offer. Offers with a lower number (e.g., 1) have a higher priority than those with higher numbers (e.g., 2, 3)." and "**Stop lower priority:** Enable this setting to automatically stop offers with a lower priority if customers meet the conditions for this higher-priority offer." (docs.bogos.io, 5.1 Works with other offers)
- Merchant voice: none specific found.
- **Recommendation: ADOPT** - it is the market-leading gift app's model word for word (number + "stop lower priority"); Shopify's "best for customer" does not fit gifts whose value the operator, not the buyer, cares about.

### P4. Budget in purchase cost; promotion pauses itself at zero; no budget without a cost
- **Shopify**: only a count, not money: "setting a limit of 200 allows the discount code to be used 200 times across all customers." [fetch] buy-x-get-y; API `usageLimit` "The maximum number of times the discount can be redeemed." (DiscountCodeBxgy). Gift out of stock: "If free-item stock hits zero ... the discount can't be used" (paraphrase [fetch]).
- **BOGOS**: count limit ("Limit number of times this discount can be used in total") plus stock-based stop: "For When the gift is out of stock, select 'Stop the offers' (not 'Continue selling')." / "With 'Stop the offers' on, once a gift is out of stock, that offer stops". No money budget found.
- Merchant voice (BOGOS 2-star): "I was running a 24-hour BOGO sale, but your system stopped the offer because it required an upgrade ... we lost thousands of dollars" - an offer that stops silently is a real pain; the stop must be visible.
- Money budget by purchase cost: **no evidence** in Shopify or BOGOS.
- **Recommendation: SIMPLIFY** to "max number of gifts" (count) + automatic stop when gift stock is out, with a visible "paused: limit reached / out of stock" state; drop the cost budget and the "cannot activate without purchase cost" rule, because nobody in this market budgets gifts in money and it makes cost data a precondition.

### P5. Which date counts (placed vs received); gift per qualifying unit
- **Date**: Shopify has one clock - discount start/end are evaluated at checkout: "The time when the discount starts and ends depends on the time zone that you selected in your Shopify admin." [fetch]. No choice of date: **no evidence** of such an option anywhere.
- **Per qualifying unit**: Shopify "Set a maximum number of uses per order" [fetch]; API `usesPerOrderLimit` "The maximum number of times that the discount can be applied to an order." BOGOS: "**Multiply gifts with number of products:** If customers purchase more than the required products, they will get more gifts. Example: Buy 2 get 1, Buy 4 get 2, Buy 6 get 3".
- **Recommendation: SIMPLIFY** - drop the date choice and always use the channel's order-placed date (fall back to received time only when the channel has none); ADOPT "per qualifying unit" as a "multiply" checkbox with an optional per-order cap, which is the standard pair.

### O1. Gift line id `ol-gift:{ruleId}:{lineId}`
- **Shopify**: no gift id; Flow "Add order line item" has a field "Allow duplicate variants" [r1] - i.e. without it a re-run adds the gift twice. BOGOS marks gifts by cloned products with tag `bogos-gift` and title "Product Name (100% off)".
- Merchant voice (BOGOS 1-star): "After uninstalling the app, I discovered that a cloned product remained active on my store, allowing customers to purchase an offer that should have been automatically disabled" - marking gifts via separate catalogue products causes leaks.
- **Recommendation: ADOPT** - an internal deterministic line key is invisible to the operator and is the cheap way to make re-evaluation idempotent; do not copy the "clone product" marking.

### O2. Operator adds a gift manually (before routing OK; after routing warn; after packing refused; after invoice warn)
- **Shopify**: "You can edit only unfulfilled line items. If an edit changes the total order value, then a balance might need to be collected from or refunded to the customer." https://shopify.dev/docs/apps/build/orders-fulfillment/order-management-apps/edit-orders ; `notifyCustomer` true sends "an email invoice with the updated order information". Flow "Add order line item" "will add a line item without considering inventory" [r1/r3]. Since 2025-08 discounts can be added to fulfilled items (changelog "Discounts on fulfilled items").
- No routing/pack-task concept in Shopify; "after invoice" has no counterpart (no fiscal docs).
- **Recommendation: SIMPLIFY** to two states: allowed until the parcel is packed (with a stock check, unlike Flow), refused after; keep one warning "a document already exists" when a sales document was issued; drop the separate "after routing" warning and just regenerate the pack task.

### O3. Allegro multipack (productSet quantity > 1 on a single-variant mapping) is held until a bundle is defined
- **Shopify**: **no evidence** of a hold. Shopify never receives this shape from its own checkout; for marketplace imports "Create Order API: Not supported" for Cart Transform [r4], and Marketplace Connect bundle import is a per-store switch enabled by support [r3].
- **Recommendation: ADOPT** - holding an order whose quantity cannot be resolved is the only safe answer and no competitor offers a better one; put the "create bundle 3 x {product}" action on the hold itself so "check again" is one click.

### O4. An ended promotion is read-only; change it by duplicating
- **Shopify**: status `EXPIRED` "The discount has reached its end date and is no longer valid." https://shopify.dev/docs/api/admin-graphql/latest/enums/DiscountStatus . No documented rule that expired discounts are locked (not verified in the admin UI this round).
- **BOGOS**: status "Expired: Offers that have passed their end date"; "**Actions**: This allows you to duplicate or delete any offer"; bulk edit "lets you edit offer titles, dates, and enable all offers". Analytics keep "even deleted/expired offers".
- Merchant voice (BOGOS 2-star): "after the offer ends, the products become mysteriously 'unavailable' and not even Shopify could repair it" - ending a promotion must not damage anything else.
- **Recommendation: SIMPLIFY** - allow changing dates (extend/reactivate) on an ended promotion and require Duplicate only for changing conditions or gifts; orders already keep their own snapshot, so a full read-only lock adds friction without protecting history.

### D1. Gift on receipt as 0,01 zł taken from a paid line
- **Shopify**: gift = full list price + 100% discount; customer documents show "**Free**" when the total is zero [r1, grouped-view template]. No fiscal receipts, so **no evidence** for the 0,01 technique.
- **Recommendation: SIMPLIFY** - default to list price + 100% rebate (0,00) wherever the document provider accepts it; use the 0,01-from-a-paid-line move only as a fallback for providers/fiscal printers that reject a zero line (Shopify gives no reason to make the workaround the default).

### D2. Split a line whose value does not divide by its quantity
- **Shopify** does not split; it keeps line-level amounts and accepts unequal per-unit values: "In isolation, one line item might have a different tax or discount amount than another line item of the same price ... because the amount could not be divided evenly across the items." https://shopify.dev/docs/api/admin-graphql/latest/interfaces/Sale
- **Recommendation: SIMPLIFY** - send the line total and quantity; split only for document providers that verify qty x unit price = value (decide per adapter, not globally).

### D3. Rounding remainder (1 grosz) to the largest paid line, never a gift line
- **Shopify** has a fixed, simple rule: "the remaining currency units that couldn't be divided evenly are allocated one at a time, starting with the first line item, until they are all accounted for." and "currency units are never reallocated or redistributed among the line items." (Sale interface, verbatim)
- **Recommendation: ADOPT** - a deterministic remainder rule is standard; "largest paid line, never a gift" is as simple as Shopify's "first line" and avoids putting money on a free line; also copy "allocated once, never redistributed".

### D4. Whole-order discount holds the document until the operator clicks "spread the discount"
- **Shopify** spreads order discounts across lines automatically with no operator step (same Sale text: "amounts are divided across multiple line items, such as taxes or order discounts"; [r4] "Order-level discounts are allocated to lines too").
- **Recommendation: SIMPLIFY** - allocate proportionally to line values automatically and show the result on the order; drop the hold and the button (keep a manual override only).

### D5. EUR order with foreign VAT (Erli DE 19%/7%) waits for review instead of auto PLN document
- **Shopify**: **no evidence** of a comparable hold (Shopify issues no fiscal documents). Only adjacent fact: editing orders "placed in international currencies requires you to upgrade" (edit-orders.md).
- **Recommendation: ADOPT** (by default, no counter-evidence) - a wrong automatic PLN document under foreign VAT is costlier than a review queue; revisit when an OSS rule exists.

### D6. Returns
- (a) Two identical Allegro lines, return matched to the line without the bundle discount: **no evidence**; Shopify refunds per line the merchant picks, at the line's allocated price [r1, r3].
- (b) Kept gift never deducted automatically: Shopify native does nothing automatically; since 2026-05 the operator can "add, update, or remove a discount on any eligible item" on the refund page https://changelog.shopify.com/posts/apply-discounts-to-items-on-the-refund-page . The leading returns app **does deduct automatically**: "Refund = Total originally paid – full (undiscounted) price of items kept" and "The minimum refund is £0 ... the customer is not charged the difference." https://help.swap-commerce.com/en/articles/15958483-understanding-buy-x-get-y-returns-returns-v2
- (c) Proposal to claw back the lost bundle discount, editable: same Swap formula covers it; Shopify gives a manual edit.
- **Recommendation: SIMPLIFY** - merge (b) and (c) into one editable "refund proposal" computed with Swap's formula (paid total minus full price of what the buyer keeps, floor at 0), operator confirms; keep (a) as the default match with an operator override. One formula covers both gifts and broken bundles.

### C1. "Take the composition from PrestaShop" button when the OL bundle differs from the PS pack
- **Shopify**: one owner per composition - "After an app assigns components to a bundle, only that app can manage those components." [r4, productVariantRelationshipBulkUpdate].
- Merchant voice (Shopify Bundles 1-star): "it doesnt bring over the imagery - so you basically have to redo all the work you did originally."
- **Recommendation: SIMPLIFY** - pick one owner per bundle: if a PrestaShop pack exists, OL reads its composition and shows it read-only (re-synced automatically); no diff screen and no button.

### C2. Small-gift register keyed by resolved customer, not e-mail
- **Shopify / apps**: **no evidence** (PL VAT art. 7 ust. 3-4 has no Shopify counterpart). Same identity argument as P2.
- **Recommendation: ADOPT** - it must use the same customer key as P2, otherwise the register and the per-customer limit disagree.

### C3. Separate option "hold every document with a gift until a decision"
- **Shopify / apps**: **no evidence** of a gift-specific document hold; Shopify only has generic fulfilment holds and Flow tags [r5 SH9].
- **Recommendation: DROP** - keep the gift document policy (omit / 0,01 / priced-in / internal) and let the operator use the generic order hold when unsure; a fifth policy that only says "ask me" adds a queue nobody owns.

## Three strongest findings

1. **P3 is already the market standard**: BOGOS (the top Shopify gift app) ships exactly "Priority (lower number wins)" + "Stop lower priority"; Shopify's own "best discount for the customer" does not fit gifts. ADOPT as is.
2. **D3/D4 have a published Shopify rule**: remainders go "one at a time, starting with the first line item" and order discounts are always spread to lines automatically, "never reallocated". No hold, no button - spread D4 automatically.
3. **D6 has a ready formula**: Swap computes "Refund = Total originally paid – full price of items kept" (floor 0) for both lost gifts and broken BXGY; Shopify since 2026-05 lets the operator edit discounts on the refund page. Use one editable proposal for D6(b)+(c). Runner-up: nobody budgets gifts in money (P4) - a count limit + out-of-stock stop is the norm.

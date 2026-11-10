# ADR-084: Promotions are their own context; a gift is one benefit kind, not an automation rule

- **Status**: Proposed
- **Date**: 2026-11-10
- **Authors**: @norbert-kulus-blockydevs

## Context

ADR-083 rejected "a new promotion engine for gifts" because the automation engine already had storage, AND-only conditions, a dry run, run history and at-most-once firing. Gift rules (#3938) were built that way: an `automation_rules` row with trigger `order.ingested` and a single `add-gift` action, with `automation_gift_rule_state` and `automation_gift_grants` beside it.

It worked, and it bent the automation model in five places:

- A gift is evaluated inline during ingestion, so the trigger is never emitted and the action is never dispatched. Both exist only to satisfy the engine's vocabulary.
- Automation deliberately has no priority column (a silent tie-break on a money action is what ADR-041 forbids). Gifts need an ordered list, so `automation_rules.position` was added, used by one trigger.
- "Do not combine" and the unit cap live inside the action, so a promotion's definition mixes what it gives with how it stacks.
- Run history was written as `automation_runs` rows with a made-up step vocabulary, and the order page parsed them back out.
- Every further promotion idea (a threshold gift, a discount, free shipping) would have meant another action on the same trigger.

The conclusion of ADR-083 still holds for what it was about: do not build a rule engine twice. What changed is that the thing being stored is a promotion (conditions, a benefit, stacking, limits), and that is not an event-triggered action.

## Decision

1. **A `promotions` bounded context** (`libs/core/src/promotions`, `@openlinker/core/promotions`, not in the root barrel). It imports no sibling context: the order projects itself onto `PromotionOrderFacts` and plan lines, and the gift's stock arrives as a reader function. `orders -> promotions` is the only edge. It carries no state-machine, no scheduler and no job.
2. **A promotion** is: conditions (AND-ed), one benefit, a list `position`, `combinesWith`, limits `{unitCap, customerLimit}`, an effective window and an active flag. Its identity is `definitionHash` over conditions, benefit, combination and limits (not the name, window or position); an identical definition on an overlapping window is refused at save, and a unique `(definitionHash, effectiveFrom)` index backs it.
3. **Conditions are one descriptor table.** `PROMOTION_CONDITION_DESCRIPTORS` maps each field (`orderTotalGross`, `containsProduct`, `sourceConnection`, `sourceConnectionIn`, `orderCountry`) to its shape check and its pure evaluator. The narrower, the evaluator and the field list are read from it, and a mapped type makes a missing entry a compile error. Semantics are unchanged: a currency mismatch never matches (no conversion), an unasserted fact is `unknown`, never `false`, and a malformed persisted condition reads as "never matches".
4. **The benefit is a discriminated union with a policy per kind.** `PromotionBenefit` has one member, `free-gift`. `BENEFIT_POLICIES` is a mapped type over `PromotionBenefitKindValues`, so a new kind does not compile until it has a `BenefitPolicy` with two methods: `quantity` (what this order earns, or why nothing) and `supply` (can it be delivered, for a gift: stock). The planner owns everything common: list order, stacking, the unit cap, the customer limit and the pause lifecycle.
5. **Price-changing benefits are not part of this decision.** ADR-014 makes the marketplace's price the buyer-paid truth; a percentage or amount discount applied on top of it on a marketplace order would mean a refund on money OpenLinker does not own. A discount kind needs a channel-side design first (which channels can carry it, where the price change is written, how documents and returns see it) and arrives as a new union member with its own policy and its own ADR.
6. **Stacking is the list, with mutual consent.** Promotions are evaluated in `position` order. Each carries `combinesWith`: `{mode:'all'}`, `{mode:'none'}` or `{mode:'selected', promotionIds}` (amended from the first `combinable` boolean). Two promotions stack only when EACH allows the other (`all`, or `selected` naming the other id; `none` allows nothing). A later promotion P is skipped as superseded when some earlier promotion that actually APPLIED does not allow P, or P does not allow it, so `A allows B` is not enough if B does not allow A. Only applied promotions count: one that could not give its benefit (paused, out of stock, over its cap) does not deny the substitute below it. A `selected` list must name existing promotions, never itself, and is deduped; deleting a promotion removes its id from every other list in the same transaction. The old `combinable` converts true -> `all`, false -> `none` (migration `1939700000000`, whose `down()` is lossy: `selected` reads as not combinable).
7. **Limits and state.** `unitCap` pauses the promotion when reached and only an explicit resume, which adds units, lifts it (the operator decides whether it goes on). A stock shortfall pauses it and clears by itself when stock returns. Pause and the raised cap live in `promotion_state`, not on the definition, because the definition hash is the identity.
8. **The ledger is the idempotency.** `promotion_grants` has a unique `(promotionId, internalOrderId)`; the grant is written under a per-promotion advisory lock and before the order line, so a crash leaves "granted, line missing" (which self-heals from the grant) and never "line present, ungranted". A re-ingestion gives nothing twice; a cancellation releases the order's grants so the units return to the cap and the customer's limit. The order line keeps its key `ol-gift:{promotionId}:{lineId}` and `gift.ruleRef = promotionId`; the migration kept every id, so lines already written still resolve.
9. **The application log replaces the run history.** `promotion_applications` is append-only (`applied`, `skipped` with a reason code, `failed` for the fail-open case), keeps the promotion's name on the row, and carries the "sent without the gift" dismissal. It has no FKs, so history survives a deleted promotion.
10. **Automation loses what only gifts used**: the `order.ingested` trigger, the `add-gift` action and its legality and availability entries, the `containsProduct` and `sourceConnectionIn` conditions, the planner, the ledger, `GiftRuleService`, `automation_rules.position` and the two gift tables. The migration moves the rows (ids kept) and `down()` reverses it.

## Alternatives considered

- **Keep gifts as automation rules and add benefit kinds as actions.** Rejected: each kind would add an action that is never dispatched and never legal on any other trigger, and the ordered list would keep needing the position column automation refuses.
- **A generic rule engine shared by automation and promotions.** Rejected: the two differ where it matters (automation has no order, stops on first failure and spends money at most once; promotions are ordered, stack and are idempotent per order). A shared abstraction would be the union of both.
- **Put the planner in `orders`.** Rejected: promotions will have other consumers (the dry run, a future cart-side preview), and the planner is pure and needs no order type.
- **Store the benefit as columns.** Rejected: kinds differ in shape. The kind is a column-free discriminant in jsonb, narrowed on read, so an unrecognised persisted benefit drops the row instead of crashing a list.

## Consequences

**Pros:**
- Adding a condition is one table entry; adding a benefit kind is one policy plus one union member, and the compiler lists what is missing.
- The order side stays small: it projects facts, supplies stock and writes the line.
- Automation is back to event-triggered actions only.

**Cons:**
- A new context, four tables and a data migration with a reverse.
- The gift API moves from `/gift-rules` to `/promotions`, and the field names change (`rule` becomes `promotion`, `doNotCombine` becomes `combinable`, later `combinesWith`). The frontend is rewired separately.
- Reason codes (`gift-out-of-stock`, `unit-cap-reached`, ...) keep their gift names although the vocabulary is now generic; renaming them would change what the frontend and the order page read, so it waits for a second benefit kind.

## References

- Related ADRs: [ADR-011](./011-domain-entity-behavior.md), [ADR-014](./014-source-authoritative-order-pricing.md), [ADR-041](./041-sales-document-routing-policy.md), [ADR-083](./083-commercial-and-physical-order-lines.md)
- Issue: #3935
- Spec: [product-spec-oms-gifts](../../specs/product-spec-oms-gifts.md)

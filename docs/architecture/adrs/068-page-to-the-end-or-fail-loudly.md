# ADR-068: Page to the end or fail loudly - a truncated read must never be indistinguishable from a complete one

- **Status**: Accepted
- **Date**: 2026-08-27
- **Authors**: OpenLinker maintainers (retrospective documentation of decisions made across PRs #2598, #2608, #2616)

## Context

The PrestaShop Webservice returns a collection page, not a collection. Every unbounded list read in the adapter therefore had to page, and each one had grown its own loop. Epic #2590 hit the same defect **three separate times** - #2598's pack-component read, #2616's filter, and #2608 itself - which is what makes it a package-level decision rather than three bug fixes.

The defect is always the same shape and never announces itself. A loop stops after N pages (or reads one page and returns), the caller receives a short array, and nothing anywhere distinguishes *"that is the whole collection"* from *"that is as far as I looked"*. The consequences are silent and downstream: a pack whose components were half-read is priced wrong, a filter that returned page one links the wrong products, and - worst - a partial enumeration feeding anything that reasons about **absence** turns a paging bound into a false deletion.

This ADR sits directly beside [ADR-048](./048-incremental-catalog-replication.md)'s decision 2 ("absence is never the signal") and its deleted `MAX_PAGES` guard, which warned `pagination may be truncated` and then returned `outcome: 'ok'` - the identical failure one layer up.

Two further facts constrain the answer. Offset paging with no `ORDER BY` has **no tiling guarantee at all** - MySQL may return the same row twice and never return another - which is how the #2605 order-feed failure happened. And a PrestaShop page size is a per-connection configuration value, not a constant.

## Decision

**Every unbounded PrestaShop list read goes through one shared paging helper, which pages to the end of the collection or throws.** Concretely, in `libs/integrations/prestashop/src/infrastructure/http/prestashop-paged-read.ts`:

- Paging ends only on a **short page**. Filling the whole budget is not an end condition, it is an error: `PrestashopTruncatedReadException`, naming the resource, the connection, the budget it filled and an optional caller-supplied detail, and stating that it is refusing to return a truncated result.
- **Two row budgets, chosen by how narrow the read is** - `PRESTASHOP_NARROWED_MAX_ROWS = 5000` (the default) and `PRESTASHOP_UNNARROWED_MAX_ROWS = 50000` for a read that scans a whole resource. The budget is expressed in **rows** and converted to pages against the connection's real page size, so it means the same thing on a shop configured differently.
- **The page size comes from the client** (`getPageSize?()`, optional so older test doubles still compile), never a hardcoded 100.
- **A paged resource read injects `sort: ['id_ASC']`** unless the caller supplied its own sort, because an unordered offset scan is not a scan.
- The exception is classified **non-retryable**: a budget that was filled once will be filled again, so retrying spends the ADR-048 retry ladder to reach the same answer.

## Alternatives considered

- **Return what was read, plus a `truncated: true` flag.** Rejected: it is exactly the shape that failed three times. A flag is only as good as every caller checking it, and the callers that most need to (anything reasoning about absence) are the ones that read a shorter array as a smaller world.
- **Page forever, no budget.** Rejected: a runaway or misfiltered read against a large catalogue would hold a worker slot and hammer the shop indefinitely. A bound the operator can reason about beats an unbounded loop, provided crossing it is loud.
- **One budget for every read.** Rejected: sized for a whole-resource scan it stops bounding a narrowed read at all; sized for a narrowed read it refuses legitimate scans. Two named budgets say which kind of read a call site believes it is making, and the name is checkable in review.
- **Keyset paging instead of offset.** The correct long-term answer and not available here: the Webservice's `limit=[offset,]count` is offset paging, and there is no cursor to carry. `sort: ['id_ASC']` plus a bound is the honest approximation.
- **Make each call site's loop correct.** Rejected by evidence - that was the status quo, and the same defect recurred three times inside one epic.

## Consequences

**Pros:**
- A truncated read now fails where it happens, with the resource, connection and budget in the message, instead of surfacing days later as a wrong price or a phantom deletion.
- One place to change the policy: budgets, sort injection and the end-of-collection rule have a single implementation, so the next unbounded read inherits all three by using the helper.
- Paging a large resource is bounded by design, which is a shop-load property as well as a correctness one.

**Cons / trade-offs:**
- **A genuinely huge collection now fails instead of quietly under-reporting.** That is the trade this ADR makes deliberately, and it means the budgets are a real operational limit: an installation whose narrowed read legitimately exceeds 5 000 rows must narrow it further or move it to the unnarrowed budget in a reviewed change.
- **Neither budget is env-overridable**, on purpose: a per-deployment override would let an operator raise a bound whose job is to reveal a query that stopped being narrow, and a bound that can be raised in a `.env` is a bound that gets raised instead of fixed. The cost is that widening one is a code change.
- **Not every call site can rethrow.** The pack resolver, for example, degrades every *other* error to `null` and warns, and rethrows only the truncation - a deliberate split (an unresolved pack read is tolerable; a half-read one is not). Each caller has to make that choice explicitly, which is one more decision per site.
- The rule is **PrestaShop-scoped**. The same defect class exists behind any paginated adapter; nothing here generalises it, and nothing prevents the next integration from growing its own loop.

*Reversal gate (countable):* an unbounded paged list read in `libs/integrations/prestashop/**` that does not go through the shared helper - structurally detectable, and the signal that the helper is missing a shape rather than that a call site is special.

*Reversal gate (prose-only):* a second adapter package reproducing this helper. Two copies is the point at which the policy belongs in the plugin SDK rather than in one integration.

## References

- Related issues: #2608 (the policy and the helper), #2598 (pack components), #2616 (the filter), #2605 (the unordered offset scan), #2590 (epic)
- Related ADRs: [ADR-048](./048-incremental-catalog-replication.md) (budget-bounded runs; "absence is never the signal", and the deleted `MAX_PAGES` guard this generalises), [ADR-066](./066-prestashop-webservice-first-integration.md) (the Webservice-first decision that makes these reads the integration's main cost)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Core Bounded Contexts - Products / Inventory

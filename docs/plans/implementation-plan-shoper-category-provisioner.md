# Implementation plan - Shoper: CategoryProvisioner (#3713)

Layer: Integration (adapter + wiring). No CORE change. Branch `3713-shoper-category-provisioner`, stacked on `3712-shoper-product-publisher` (#3718), because the capability lives on the same adapter class.

Non-goals: browsing the shop's tree for the operator's picker (`ShopCategoryBrowser`), category rename/deletion, per-language names beyond the shop default.

## Live verification (sklep729770.shoparena.pl, 2026-10-07)

Categories created for the check were deleted again (shop back at 8 categories).

| Question | Observed |
|---|---|
| Create | `POST /categories` answers the bare id. Body: `parent_id` (REQUIRED, `0` = a root) and `translations.<lang>.name` (+ `active`). Without `parent_id`: 400 `Key 'parent_id' is required`. |
| Child | `parent_id: <id>` places it under that category; `GET /categories-tree` shows it nested. |
| Duplicate name | **Not refused.** A second `POST` of the same name under the same parent answered 200 and created a second node. So the lookup before every create is the entire idempotency. |
| Unknown parent | **Not refused.** `parent_id: 99999` answered 200 and created a category the tree does not show (an orphan). The adapter therefore only ever passes ids it found or created. |
| Delete | `DELETE /categories/:id` answers `1`. |
| Lookup | There is no by-name filter that was relied on: the tree carries structure (ids), the paged list carries names; the existing join (`joinShoperCategories`) already combines them. |

## Decisions

1. **Lookup-then-create per path node**, matching the exact trimmed name under the exact parent. Roots are categories at depth 0; a category the tree does not place is never a candidate (its parent is unknown, matching it would be a guess).
2. **Duplicates resolve to the LOWEST id.** Shoper accepts a duplicate, so two publishes that raced to create the same node both re-read after their create and settle on the same lowest-id node. The loser's empty twin is logged and left for the operator, never deleted: the other publisher may already have returned it.
3. **One reader.** The tree + list read moved out of the ProductMaster adapter into `ShoperCategoryReader`, which both adapters use; the join stays `joinShoperCategories`. ProductMaster still memoises its own directory; the provisioner reads fresh because it changes what it reads.
4. **All names are validated before anything is created**, so a refused path never leaves its first nodes behind.
5. `CategoryProvisioner` is declared in `supportedCapabilities` together with the adapter, dispatched to the SAME publisher instance (the registry refuses a declared name with no dispatch entry), and is not in `defaultEnabledCapabilities`.
6. Errors from Shoper propagate untouched (the retry classifier decides); only an empty path / blank name / unknown language are refused locally.

## Steps

1. `readers/shoper-category.reader.ts` - `ShoperCategoryReader.read()` (tree + paged list); ProductMaster delegates to it.
2. `mappers/shoper-category.mapper.ts` - pure `findShoperCategoryChild`.
3. `domain/types/shoper-product-write.types.ts` - `ShoperCategoryWriteBody`.
4. `ShoperProductPublisherAdapter implements CategoryProvisioner` - `provisionCategory`.
5. `shoper-plugin.ts` - manifest entry + dispatch entry.
6. Specs: provisioner (create root / nested / reuse / partial / other-parent / trim / language / race / adopt lower-id twin / refusals / error propagation), `findShoperCategoryChild`, plugin dispatch + guard.
7. Docs: one bullet in `docs/architecture-overview.md`.

## Risks / open

- A shop with thousands of categories pays two reads (tree + list pages) per `provisionCategory` and two more per created node.
- A race between two publishes can leave an empty duplicate category in the shop; it is reported in the log only.
- Names are matched in the shop's default language only.

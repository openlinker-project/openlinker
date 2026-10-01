# Implementation Plan: Shoper ProductMaster — categories (#3676)

Epic: #3640. Builds on #3675 (adapter class, factory, pagination). Branch is cut from the #3675 branch.

## Goal / non-goals

`getCategories()` (the master's whole directory) and `getProductCategories(productId)` on `ShoperProductMasterAdapter`. `assignCategories` stays not-supported. Not the destination taxonomy model (ADR-037) - this is the master category kind reached through `ProductMaster`.

## Live findings (trial shop, 1 Oct 2026) - they change the issue's plan

| Fact | Consequence |
|---|---|
| `GET /categories-tree` returns **ids and children only**: `[{"id":45,"children":[{"id":38,"children":[]},…]}]` - no names | The tree alone cannot produce a `Category`. It supplies STRUCTURE (`parentId`, `depth`). |
| `GET /categories` is paged (`limit` ≤ 50) and carries `category_id`, `root`, `translations.<lang>.{name, active}` | It supplies TEXT and `active`. Read all pages. |
| Product payload carries `categories: [38]` (ids) | `getProductCategories` = product's ids looked up in the directory. |

## Design

- `getCategories()`: read `categories-tree` (one call) and every page of `categories` (`order=category_id ASC`), join by id. `parentId` / `depth` come from the tree (root depth 0); `name` from the shop default language with the same fallback rule as products; `active` from that translation.
  - A category in the list but absent from the tree: kept, without `parentId` / `depth`, and logged (the tree is the less trustworthy source of membership).
  - A tree node absent from the list: skipped and logged - with no name it cannot be shown truthfully.
  - A node reachable twice / a cycle: first occurrence wins, guarded by a visited set, so a malformed tree cannot loop.
- `getProductCategories(productId)`: resolve the Shoper id, `GET /products/:id`, map its `categories` ids through the directory. An id absent from the directory is logged and skipped; a product with none returns `[]`.
- Mapper `shoper-category.mapper.ts`: pure `flattenShoperCategoryTree` + `mapShoperCategories`.
- Directory is read per call (no cache) - simple and correct; a per-adapter memo can come later if a caller loops.

## Steps

1. Types: `ShoperCategory`, `ShoperCategoryTreeNode` in `shoper-api.types.ts`.
2. `infrastructure/mappers/shoper-category.mapper.ts` + spec (root, nested, inactive, missing name, list-not-in-tree, tree-not-in-list, cycle).
3. Adapter methods + spec updates (remove `getProductCategories` from the not-supported list).
4. README; live smoke; invariants; lint; type-check.

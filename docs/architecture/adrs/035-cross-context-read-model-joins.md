# ADR-035: Cross-context read-model joins by table name

- **Status**: Accepted
- **Date**: 2026-07-17
- **Authors**: @norbert-kulus-blockydevs

## Context

The products catalog cockpit (#1720) needs the `GET /products` list to sort and filter by
aggregated stock (owned by `inventory`) and by listing gaps (owned by `listings`), with correct
results under **offset pagination**. Both facts live in sibling contexts' tables
(`inventory_items`, `identifier_mappings` joined through `product_variants`).

`docs/architecture-overview.md § Cross-context dependencies in core` already establishes the
contract for *service-level* composition — a context may import a sibling's `I*Service`,
Symbol tokens, and capability ports, never its `*RepositoryPort` or `*OrmEntity`. That seam works
for *display enrichment* (compose the current page's rows with sibling data after the fact — see
`ProductsController.listProducts`, which does exactly this for stock aggregates and listings
coverage via `IInventoryQueryService` / `IOfferMappingsService`).

It does **not** work for *server-side sort/filter across the full result set*: the products
repository's own query decides which 20-of-N rows exist on a page and in what order, so a stock
filter or a listing-gap filter has to be evaluated inside that same SQL query, before pagination
is applied. Composing after the page is fetched can enrich what's already there — it can't change
which rows are on the page.

## Decision

`ProductRepository.findMany` (products context) and `OfferMappingRepository
.countListedVariantsByProducts` (listings context) each contain a query-builder join onto a
sibling context's table **by table-name string** (`FROM inventory_items`, `.innerJoin
('product_variants', ...)`), never by importing the sibling's `*OrmEntity` class. Every such join
is:

- **read-only** — no join target is ever written to from outside its owning context;
- **commented in place** as a "read-model reporting join," citing this ADR;
- **fully parameterized** — table/column names are literal strings the code controls, all values
  flow through query-builder parameters, never string interpolation.

This is a narrow, explicitly-sanctioned escape hatch for the one case service composition can't
cover: same-query sort/filter/pagination across context boundaries. It is not a general license to
join across contexts wherever convenient — most cross-context reads still belong on the
`I*Service` seam, exactly as documented.

## Alternatives considered

- **New inventory-side "ordered product-id page" service returning a ranked id list, then products
  re-queries by those ids.** Rejected: doesn't compose with free-text search + offset pagination
  without doing set intersection across two round-trips, and still needs a second sibling-context
  query per filter dimension (stock, listing gaps) — more complexity for the same result.
- **Denormalize aggregated stock / listing-gap flags onto the `products` table**, updated by
  triggers or an event handler. Rejected for now: adds a write-path dependency and staleness
  window for a read-only reporting need; revisit if the joined-query cost becomes a real
  performance problem.
- **Materialized view joining the three tables.** Rejected: adds a refresh/staleness story and
  migration surface disproportionate to today's data volume; the plain joined query is fast enough
  at current scale.

## Consequences

**Pros:**
- Server-side sort/filter/pagination work correctly across context boundaries without inventing a
  new cross-context service contract for a narrowly-scoped need.
- No `*OrmEntity` or `*RepositoryPort` crosses a context boundary as a TypeScript import — the
  existing import-contract tests (`scripts/check-cross-context-imports.mjs`) stay meaningful.

**Cons / trade-offs:**
- `scripts/check-cross-context-imports.mjs` walks TypeScript imports, not SQL string literals, so
  it **cannot** detect misuse of this pattern (e.g. a join added without the read-only /
  parameterized / commented discipline above). Reviewers must catch violations by reading the
  diff — see the Code Review Guide checklist for cross-context changes.
- A sibling context renaming its table or a column referenced this way is a silent runtime break,
  not a compile-time one. Each join is commented with what it depends on for exactly this reason.

**Migration path (if applicable):**
- If join cost becomes a measured performance problem, revisit the "denormalize" alternative above
  with real numbers instead of pre-optimizing now.

## References

- Related PRs: #1722
- Related issues: #1720
- Primary doc section: [docs/architecture-overview.md § Cross-context dependencies in core](../../architecture-overview.md#cross-context-dependencies-in-core)

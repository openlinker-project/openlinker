# ADR-087: Order sync start and window import

- **Status**: Accepted
- **Date**: 2026-11-23
- **Authors**: @norbert-kulus-blockydevs

## Context

A new `OrderSource` connection used to import the source's whole order history on its first poll, which creates every old order in every destination. #4228 lets the operator choose where sync starts ("only new orders", "from a date", "all") and import older orders later; #4265 extended it to Shopify, Shoper and Subiekt. An audit of the first implementation found that an adapter without a head read silently fell back to reading history, that a restart could race a running poll and be swallowed by job dedupe, and that a refused start consumed the operator's choice.

## Decision

- The operator's choice is a **one-shot intent**, a `connection_cursors` row `orders.syncStart`, consumed by the first poll and deleted. An **absent intent means a legacy connection** and changes nothing. Enabling `OrderSource` later stores an intent too (default `now`).
- What an adapter can do is declared **statically** in the manifest (`orderSyncStartModes`, default `['now','all']`; `orderWindowImport`, default `false`), and implemented as three optional **guard-only** capabilities: `OrderFeedBootstrap.headCursor`, `OrderFeedDateBootstrap.cursorForDate`, `OrderWindowReader.listOrdersInWindow`.
- **Throw, never guess.** A request the adapter cannot honour raises the typed `OrderSyncStartUnavailableError`, which the worker records as a terminal `business_failure`. An adapter without `headCursor` is an error, not a history read.
- A **restart** runs under the order poll's own lock (409 when busy), writes the new intent before deleting cursors, and reports `{applied, reason?}`. Each seed's import run id carries a **nonce**; a newest-first seed **pre-flights page 1** before consuming the intent.
- Invariant enforcement: `scripts/check-order-source-start-declarations.mjs` and the `runOrderSourceStartContract` kit.

## Alternatives considered

- **Gate on a manifest capability name**: rejected. `enabledCapabilities` is stamped at connection create and never retro-filled (#2085), so a gate would drain nothing for existing connections.
- **Store the start in `Connection.config`**: rejected. A start date goes stale after the first poll and would read as a live setting; a one-shot row that is deleted cannot.
- **Silent history fallback for adapters without a head read**: rejected. It is exactly the full import the feature exists to prevent, and nothing tells the operator it happened.
- **Runtime cross-check of manifest against implementation**: rejected in favour of the invariant script and contract kit, which fail the build instead of a poll.

## Consequences

**Pros:**
- No migration; legacy connections behave as before.
- A bad declaration is caught in CI, a bad request is a named refusal, and a refused choice stays available to change.

**Cons / trade-offs:**
- Every `OrderSource` adapter must implement `headCursor`.
- An empty shop has no head. `headCursor` returning `null` is treated as "the source has no orders, so only new orders means every order": core writes the marker and the applied record, deletes the intent and the same poll reads from the beginning, so nothing is seeded past. (Allegro: an empty event journal on an account that has orders reads the journal from its start, which holds nothing older anyway.)
- Per-platform limits (date semantics, history cut-offs) are documented per plugin, not unified.

**Known limits** (details in each plugin README): Erli "all history" is only the unread inbox (at most 500 messages, never orders already acknowledged). Shopify may never import older than about 60 days, because `read_all_orders` is not grantable to custom apps in the admin scope picker and needs Shopify approval. WooCommerce "from a date" filters by last modified time (it also brings older orders changed since) and reads the day in UTC. Shoper "from a date" assumes order ids rise with dates, and a later status change on an order older than the start brings it in. PrestaShop oldest-first reads use `date_upd`, newest-first and the period read use `date_add`. Subiekt's date column is date-only (a back-dated or later-edited ZK is never re-read), and a bridge without `GET /api/orders/feed/head` makes OpenLinker walk the feed within a time budget (about 3 minutes) and then refuse. Allegro window import pages by offset sorted by purchase time with no tiebreaker and Allegro documents no maximum offset, so a very large all-history import may stop at an API ceiling (narrow the range and retry).

## References

- Related issues: #4228, #4265, #2085
- Related ADRs: [ADR-007](./007-syncjob-status-vs-outcome-split.md), [ADR-002](./002-capability-ports-with-sub-capabilities.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md)

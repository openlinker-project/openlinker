# ADR-038: Per-connection outbound rate limiting via a shared transport + ambient priority context

- **Status**: Proposed
- **Date**: 2026-07-30
- **Authors**: @jakubret

## Context

A user's shared-hosting PrestaShop VPS was blocked by their host (#1772) after OpenLinker's worker
sent outbound bursts against it. No integration in the repo has a proactive outbound throttle —
every plugin HTTP client fires `fetch` immediately; the only pacing anywhere is reactive
retry-after-failure. A repo-wide audit found **9 in-client HTTP call sites** across 9 integrations
(Allegro, PrestaShop, Erli, WooCommerce, InPost, DPD, infakt, KSeF, Subiekt) plus **7 ad-hoc `fetch`
bypasses** that skip their own client entirely — a per-call-site `acquire()` design is unenforceable
because any scheme that must be *remembered* per call site will leak, and it re-litigates for every
future integration.

#1815 already shipped a **minimal, PrestaShop-only** prerequisite (`PrestashopRateLimiter` +
`PrestashopRateLimiterRegistry`, wrapping `PrestashopWebserviceClient.requestWithRetry`) so an
operator could see rate-limit status while this generic architecture was still being designed. That
implementation is plugin-scoped, single-pool, has no `Retry-After` handling, and does not divide its
cap across worker replicas — explicitly deferred to this decision.

## Decision

Introduce one **shared transport seam** all outbound integration HTTP goes through, rather than a
per-call-site throttle:

1. A neutral `ConnectionConfig.rateLimit? : { requestsPerMinute?, maxConcurrent? }`, validated once
   in core `ConnectionService`, following the existing `invoicing` / `stockSafetyBuffer` /
   `pricingRule` sub-object precedent (no migration, no ORM change, no `Connection` constructor
   change).
2. `@openlinker/shared/rate-limit` (minimum-interval spacing + a concurrency semaphore, one bucket
   per connection with a background/interactive reservation) and `@openlinker/shared/http`
   (`HttpTransportFactoryPort.for(connection): FetchLike`), wired as a **required**
   `HostServices.http` field.
3. Priority (`background` vs `interactive`) and cancellation are carried by `AsyncLocalStorage`,
   entered once in `SyncJobRunner.processJob` and once in an apps/api `APP_INTERCEPTOR` — not
   threaded through `SyncJobHandler.execute` or any adapter signature.
4. Every plugin HTTP client takes an optional `fetchImpl: FetchLike = globalThis.fetch` constructor
   param; bare `fetch` becomes an ESLint `no-restricted-globals` error under `libs/integrations/**`,
   enforced by `scripts/check-outbound-http.mjs`.
5. A prerequisite fix: a `heartbeat` tick in `SyncJobRunner.processJob` so a job queued behind a
   saturated limiter for >15 minutes isn't duplicated by the existing stuck-job reclaim sweep.

#1815's PrestaShop-only limiter is **generalized, not duplicated**: `PrestashopRateLimiter` /
`PrestashopRateLimiterRegistry` are retired in favour of the shared `@openlinker/shared/rate-limit`
primitive, and `PrestashopConnectionConfig.requestsPerMinute` migrates to the neutral
`ConnectionConfig.rateLimit.requestsPerMinute` (with a config-read fallback so an operator's existing
value keeps working across the cutover — see the implementation plan's migration step).

## Alternatives considered

- **Per-call-site `acquire()` at each of the ~16 known sites.** Rejected: the original PrestaShop-only
  version of this issue found only 4 of 5 real sites in one package; unenforceable at 9 packages.
- **Widen `SyncJobHandler.execute(job, signal?)` across 26 handlers + the port** to carry priority
  explicitly. Rejected: the objection ("no such ambient primitive exists here") is an argument for
  adding one, not for threading a parameter through every handler forever, and does nothing for the
  apps/api request path.
- **A burst-tolerant token bucket** (the common default). Rejected: we are the sole client of a
  fragile remote; a cold capacity-100 bucket fires 100 requests instantly, and fixed-window bucket
  edges double the effective rate at boundary crossings.
- **Adopt `bottleneck`** (full feature set: per-key groups, priority, Redis quota). Rejected: last
  released 2019-08-03 — a frozen dependency on a control path. `rate-limiter-flexible` is a counter,
  not a scheduler; `p-queue` is single-process. ~150 dependency-free lines matches this repo's
  hand-rolled-retry idiom.

## Consequences

**Pros:**
- One mechanism, one enforcement point (`HostServices.http`) — a new integration writes zero
  rate-limiting code and cannot forget it (lint-blocked).
- Zero signature changes across 26+ sync-job handlers; priority/cancellation live in one place.
- `Retry-After` handling and multi-replica cap division become repo-wide free wins instead of
  9 one-off implementations.

**Cons / trade-offs:**
- `AsyncLocalStorage` is the first ambient-context primitive in this codebase — a new pattern
  reviewers must learn once, and a plugin that spawns detached async work outside the ALS-entered
  scope silently loses its priority classification (defaults to `background`, the safe direction).
- `HostServices.http` as a **required** field is a breaking change to the plugin contract at exactly
  5 typed construction sites — deliberate, so it cannot be silently skipped, but it is a coordinated
  cross-package change landing in one PR.
- In-memory-only bucket state means a multi-replica deployment needs the static
  `OL_WORKER_REPLICAS` division (v1) rather than a true shared cap; Redis-backed coordination is a
  documented, no-new-dependency follow-up behind the same `RateLimiterPort`.

**Migration path:**
- #1815's PrestaShop-only `PrestashopRateLimiter`/`PrestashopRateLimiterRegistry` and
  `PrestashopConnectionConfig.requestsPerMinute` (branch `1815-prestashop-rate-limit-observability`,
  PR #1941) have **not** merged to `main` as of this decision — verified via
  `git merge-base --is-ancestor`. No fallback-read migration is needed: that branch is rebased onto
  this mechanism and rewritten to consume `ConnectionConfig.rateLimit` / `HostServices.http` directly
  before it merges, so the bespoke primitive never lands in `main` at all. See the accompanying
  implementation plan's Phase 4 for the exact steps.

## References

- Related issues: #1810, #1772, #1815
- Related PRs: #1941 (PrestaShop-only #1815 prerequisite this ADR generalizes)
- Primary doc section: [docs/architecture-overview.md § Sync Manager](../../architecture-overview.md#7-sync-manager), [§ Plugin Manager / Integrations](../../architecture-overview.md#10-plugin-manager--integrations)

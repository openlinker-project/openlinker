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
   (`HttpTransportFactoryPort.forConnection(connection): FetchLike`), wired as a **required**
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
- **`apps/api` and `apps/worker` never share a bucket for the same connection, independent of
  `OL_WORKER_REPLICAS`.** `RateLimitModule` is `@Global()`, but that scopes a *single Nest process*
  — it provides one `HttpTransportFactory`/`RateLimiterRegistry` instance per process, not one per
  deployment. A connection's `config.rateLimit` is therefore enforced against two independent
  buckets: the worker's (background sync jobs) and the api's (webhook install/ping, "Test
  connection", and any future synchronous api-side adapter call as Phase 5 wires more plugins onto
  `HostServices.http`). `OL_WORKER_REPLICAS` divides the cap *within* each process type's own pool;
  it does not — and cannot, as an env-var-only division — make the two pools cooperate. Concretely,
  a connection configured for 60 requests/min can see close to 120/min of real outbound traffic
  (60 from each process's independent limiter) even with exactly one api replica and one worker
  replica. This is the same class of gap as the multi-replica case above and is closed by the same
  documented Redis-backed follow-up, but it applies unconditionally — not only under horizontal
  scaling — and is worth calling out on its own since it directly weakens the guarantee against the
  #1772 incident this ADR exists to prevent.

### Cross-process coordination — resolved (#2015)

The gap above is closed: `RateLimiterRegistry`'s construction site (`libs/plugin-sdk/src/rate-limit.module.ts`)
now resolves `RedisRateLimiterAdapter` (`libs/shared/src/rate-limit/redis-rate-limiter.adapter.ts`) instead of
the in-memory `RateLimiter`, backed by the same `'REDIS_CLIENT'` token `RedisConfigModule` already exposes to
both `apps/api` and `apps/worker`. `RateLimiterPort`'s method signatures are unchanged — every integration
adapter and `HttpTransportFactory` required zero code changes. The static `OL_WORKER_REPLICAS` division is
removed: once the bucket is shared across every process and replica, dividing it further would only shrink the
operator's configured cap for no reason.

Two Redis primitives, chosen to preserve the in-memory limiter's exact algorithm rather than substitute an
approximate one:

- **Pacing** (`requestsPerMinute`): a single CAS'd "next-available-at" timestamp key
  (`ratelimit:pace:{connectionId}`), advanced via a Lua script that reads Redis's own `TIME` (not the caller's
  local clock, so a skewed host cannot mis-pace relative to the other process). This is the same
  minimum-interval-spacing algorithm as the in-memory `RateLimiter`, not a windowed counter — preserving the
  "no burst" property this ADR argues for above. `noteRetryAfter` CAS-advances the same key, so a `Retry-After`
  observed by either process is honoured by the other's very next pacing check. The key's TTL is computed as
  `max(one-hour floor, time-until-the-stored-timestamp)`, not a fixed value — an earlier draft that used a fixed
  floor truncated any pacing interval or `Retry-After` delay longer than the floor almost immediately.
- **Concurrency** (`maxConcurrent`): the claim-then-rank sorted-set pattern already shipped in
  `McpRateLimiter.claimRank` (`apps/api/src/mcp/tools/ratelimit/mcp-rate-limiter.ts`, #1487) — add a scored
  member, evict anything older than a bounded call lifetime (self-heals a crashed caller that never released),
  admit iff this call's own rank is below the cap. Rank, not a count-then-compare, is what stays correct under
  concurrent admission from both processes.

Two trade-offs accepted for v1, both scoped to observability/fairness rather than correctness of the cap
itself:

- **`getStatus()` is per-process-approximate, not a live cross-process read.** `RateLimiterPort.getStatus()` is
  synchronous by contract, so a Redis-backed adapter cannot do a live network round-trip inside it — it reports
  only what the calling process instance has itself observed. `RateLimitStatusService` (#1941) is unchanged and
  now surfaces this approximation transparently; widening `getStatus()` to `Promise<RateLimitStatus>` was
  considered and rejected as an unrelated breaking change to a port every in-memory caller also implements, for
  a capability no consumer currently needs.
- **Priority (`background` vs `interactive`) is not arbitrated across processes.** The in-memory `RateLimiter`
  holds every waiter as a live in-process queue it can strictly reorder; a Redis-backed adapter has no such
  queue to reorder across processes without a materially heavier scheme (shared priority-weighted queues).
  Priority remains a local, per-process bias only (`RedisRateLimiterAdapter.pollDelayFor`) — real, but no longer
  a hard guarantee once two processes contend for the same connection's bucket.

### The cap is per connection

`config.rateLimit` means "this connection's total outbound rate". Exactly one axis divides that
number — `OL_WORKER_REPLICAS`, so the operator's value stays the true aggregate instead of being
multiplied by the process count. Nothing else may multiply it, and in particular **not the hostname**.

This was decided against a concrete temptation. Allegro serves REST from `api.allegro.pl` and image
uploads from `upload.allegro.pl` (#1968), so a per-host bucket looks natural: bulk image uploads stop
crowding out offer CRUD. It was rejected because the quota being paced against belongs to the
*remote*, and remotes scope quotas by credential, not by DNS name — Allegro publishes exactly one
ceiling, **9000 requests/min per Client ID**, plus optional lower **per-resource** sub-limits (e.g.
`GET /sale/product-offers/{id}` at 3500/min). No Allegro documentation suggests `upload.` draws from
a second pool. Splitting per host would therefore have (a) doubled a connection's real aggregate
against a single server-side budget, and (b) made one config field mean "per host" here while
meaning "divided across replicas" there — an operator reading the field would size it wrong.

Two consequences worth stating, since both are cheap to get wrong later:

- A plugin with several hosts per connection passes the *same* `FetchLike` to each of its clients
  (see `AllegroAdapterFactory`), rather than resolving one transport per host.
- `RateLimiterRegistry` keys are therefore plain connection ids. `RateLimitStatusService.getStatus`
  (#1941) reads `registry.getStatus(connectionId)` with the bare id, so it stays correct for every
  plugin. Had buckets been host-scoped, that readout would have reported `inFlight: 0, queued: 0`
  for an Allegro connection the transport was actively pacing — confidently wrong, and invisible
  until an operator trusted it.

Starving one host's traffic behind another's remains a real concern; the mechanism's answer is the
**priority** axis (interactive drains ahead of background), not a second bucket.

**Migration path:**
- #1815's PrestaShop-only `PrestashopRateLimiter`/`PrestashopRateLimiterRegistry` and
  `PrestashopConnectionConfig.requestsPerMinute` (branch `1815-prestashop-rate-limit-observability`,
  PR #1941) have **not** merged to `main` as of this decision — verified via
  `git merge-base --is-ancestor`. No fallback-read migration is needed: that branch is rebased onto
  this mechanism and rewritten to consume `ConnectionConfig.rateLimit` / `HostServices.http` directly
  before it merges, so the bespoke primitive never lands in `main` at all. See the accompanying
  implementation plan's Phase 4 for the exact steps.

## References

- Related issues: #1810, #1772, #1815, #2015 (closed the cross-process coordination gap — see § "Cross-process coordination — resolved" above)
- Related PRs: #1941 (PrestaShop-only #1815 prerequisite this ADR generalizes)
- Primary doc section: [docs/architecture-overview.md § Sync Manager](../../architecture-overview.md#7-sync-manager), [§ Plugin Manager / Integrations](../../architecture-overview.md#10-plugin-manager--integrations)

# Allegro upstream stub

Implements GitHub issue #2856. A single-process `node:http` stub that serves
just enough of the Allegro Public API for OpenLinker's real order-ingestion
adapter to run against it unmodified, so the throughput programme (#2840)
can measure OpenLinker's own cost without a live marketplace in the loop.

## What it serves, and why only this

Per #2856's own cost-model analysis of the real adapter, exactly two Allegro
endpoints are on the order-ingestion path:

| Method | Path | Cadence |
|---|---|---|
| `GET` | `/order/events?from={cursor}&limit={n}` | once per poll tick per connection |
| `GET` | `/order/checkout-forms/{id}` | once per ingested order (zero per line item) |

Plus `GET /me`, reached by the connection tester and by #2860's bootstrap
readiness check. Everything else answers `404` in Allegro's own error shape
(`{"errors":[{"code":"NotFound","message":"..."}]}`), because a 404 is
non-retryable in OpenLinker's Allegro retry classifier - a stray call fails
loudly on attempt 1 instead of burning a retry ladder.

## What it deliberately does not serve

- `PUT /order/checkout-forms/{id}/fulfillment`, `POST
  /order/checkout-forms/{id}/shipments` - fire only on a cancellation feed
  event or a dispatch writeback, off the ingestion path this stub exists to
  measure.
- The returns endpoints - gated behind two scheduler tasks that both default
  off.
- OAuth token exchange (`/auth/oauth/token`) - the token host is hardcoded in
  the real adapter (`allegro-token-refresh.service.ts`) and cannot be
  repointed by `config.apiBaseUrl`. **The workaround is credential shape, not
  code**: store the connection's credentials with `accessToken` only - no
  `expiresAt`, no `refreshToken`, no `clientId`/`clientSecret`. With
  `expiresAt` absent, the adapter's token-freshness check short-circuits
  before every request and no token call is ever made. See #2860's bootstrap
  for where this is wired.

## The one hard rule: never answer 401

If the stub ever answered 401, the real adapter would attempt a token
refresh against the real, hardcoded `allegro.pl` host - so a run would start
depending on the public internet, and a failed refresh flags the connection
`needs_reauth`. Every code path in `server.mjs` that could plausibly want to
say "unauthorized" (a missing bearer token, an unrecognised one, a malformed
control-endpoint request) instead degrades to something else - see
"Multi-tenancy" below. `test.mjs` asserts this directly across every served
path, every fault mode, and several bogus/missing tokens.

## Design decisions and why

**Transport: `node:http`, zero dependencies, standalone.**
`pnpm-workspace.yaml` globs only `apps/*`, `libs/*` and `libs/integrations/*`,
so `perf/` is not a pnpm workspace member and cannot be a package without
editing that file. The `perf/prestashop-baseline` precedent ships no
`package.json` either. Two endpoints plus a control surface do not need a
framework.

**State lives in memory, keyed by bearer token.** This is safe only because
ids are run-scoped and monotone (below) - a process restart resets counters
to zero, and that is fine precisely because a fresh run is never assumed to
continue a prior run's id space.

**Event ids are run-scoped, never process-scoped.** `eventKey` becomes the
child job's Redis dedupe key (`marketplace:{connectionId}:order:{eventKey}`,
7-day TTL). If ids were a function of process start alone, repeating a
scenario within that window would mint the identical keys the first run
already reserved and every enqueue would silently no-op (`n = 0`, cursor
still commits, and nothing in the result distinguishes a fully-deduped tick
from a fresh one). Ids are `{runId}-{6-digit-seq}`. `runId` defaults to
`STUB_RUN_ID` at boot, or is minted fresh automatically; a driver can also
start a brand-new run **without restarting the container** via
`POST /__stub/run`, which is what makes a same-process repeat produce
disjoint ids.

**Cursor shape is deliberately unrecognised by the real regression guard,
not a decimal counter.** `compareOrderCursors` in OpenLinker core recognises
four cursor shapes (decimal counter, ISO instant, naive wall clock,
wall-clock keyset) and treats anything else as `unrecognised`, which is
*never* read as a regression. A hyphenated `{runId}-{seq}` id can never match
any of the four regexes (the hyphen alone rules out the decimal-counter
shape), so a stub restart that resets its counter to zero can never trip the
`regressed` guard and wedge a connection. Using a plain decimal counter would
have armed that guard for no benefit.

**An unknown `from` cursor is tolerated, not 404'd.** OpenLinker's own
`connection_cursors` row persists across a stub restart; the stub's
in-memory state does not. A `from` value the stub cannot place (wrong run,
malformed, or simply unknown) is treated as "you are already caught up" -
the response carries no events and echoes back the current head as
`lastEventId`, with a warning in the request log, so the connection is never
told to replay history it may have already processed under a previous run.

**The driver pushes; the stub never self-generates on a schedule.** Every
order in the stub exists because `POST /__stub/tenants/{tenant}/orders` was
called. This is what makes order *arrival rate* a driver-controlled
independent variable rather than a stub constant.

**Control endpoints live under `/__stub/`, deliberately unauthenticated.**
No Allegro path uses that prefix, so it can never collide with the served
surface or be mistaken for a 404-able Allegro path. It carries no auth
because it is a local perf-harness control plane that OpenLinker itself
never reaches - there is no principal to check.

**Request log: JSON lines on stdout.** The lab stand's compose service
declaration for this image has no volume mount, so a file-based log would
die with the container. One line per request: `ts`, `runId`, `tenant`,
`method`, `path`, `status`, `latencyMs`.

**Latency is applied per tenant, not via a global mutex.** A shared lock
would make two tenants serialise, which would make the multi-tenancy
scenario measure nothing about concurrency at all. Each request independently
`setTimeout`s for its configured latency; two tenants' requests interleave
freely.

**Dockerfile lives in the stub's own directory**, `FROM
node:22.23.1-alpine3.24` - the exact tag the repo's root `Dockerfile` pins
for its `base`/`production`/`worker` stages. No install step: `server.mjs`
has zero dependencies.

## The offer-id contract with #2860

`OrderIngestionService` resolves every line item's `offer.id` against an
`identifier_mappings` row (`entityType='Offer'`, scoped per connection) to a
live `ProductVariant`. Without a pre-seeded mapping, every stub order dies
`awaiting_mapping` after exhausting its retries. This stub therefore mints
offer ids as a **deterministic function of tenant and index**:

```
{tenant}-offer-{n}      for n in 1..STUB_OFFER_POOL_SIZE
```

where `{tenant}` is the connection's configured name (`perf-allegro-a` /
`perf-allegro-b` by default) - the same value `#2860`'s bootstrap must use
when it seeds `identifier_mappings` rows ahead of any order being pushed.

**`STUB_OFFER_POOL_SIZE` must equal `ALLEGRO_OFFER_POOL_SIZE` in the
bootstrap.** `sku` on the resulting order line is the same value as
`offer.id` (`allegro-order-source.adapter.ts:802`), so it is not an
independent axis - the seeder does not need to track it separately.

Offer indices are assigned round-robin across the pool as line items are
minted (not per-order), so a small pool is exercised evenly even with many
orders.

## The buyer-identity decision

`OL_CUSTOMER_IDENTITY_MODE` defaults to `email_fallback`, and Allegro's
masked-email normalizer strips everything from `+` onward on any
`@allegromail.` address before hashing (`fixedPart+transactionId@...`, with
a stable `fixedPart` per real buyer). Minting a distinct `buyer.id` per
order but only varying the `+transactionId` suffix would therefore collapse
every synthetic order onto **one** internal customer - the normalizer erases
exactly that suffix, so per-order destination cost is understated from order
two onward and an independent-orders workload becomes contention on one
shared customer row.

This stub varies the masked-email **fixed part** itself:
`buyer{N}+tx{orderNumber}@allegromail.pl`, where `N` cycles across
`STUB_BUYER_POOL_SIZE` distinct slots (default 50). A driver wanting a
"warm" (repeat-buyer) scenario instead of "cold" (one buyer per order) sets
`STUB_BUYER_POOL_SIZE=1` and records that choice in the run manifest.

## Multi-tenancy

One process, tenants distinguished by the `Authorization: Bearer` token - a
path prefix cannot work (the real HTTP client builds URLs with `new
URL(path, baseUrl)`, which discards any path segment already in `baseUrl`).

Configure via `STUB_TENANTS` (default
`stub-token-a=perf-allegro-a,stub-token-b=perf-allegro-b`), a comma-separated
list of `token=name` pairs. Each tenant keeps an independent cursor, order/
event history and fault state.

**An unrecognised or missing bearer token still serves** - it is bucketed
under a shared `unknown` tenant rather than answering 401 (see "the one hard
rule" above). This bucket starts empty and is never populated by a push
(pushes are addressed by tenant *name*, and only configured tenants have
one), so it exists purely to keep every request answerable without ever
saying 401.

## Pacing and fault injection

| Env var | Default | Meaning |
|---|---|---|
| `STUB_PER_REQUEST_LATENCY_MS` | `120` | Delay applied to every served request |
| `STUB_LATENCY_EVENTS_MS` | falls back to the above | Per-endpoint override for `/order/events` |
| `STUB_LATENCY_CHECKOUT_MS` | falls back to the above | Per-endpoint override for `/order/checkout-forms/{id}` |

Latency is a fixed constant per endpoint, not a distribution - #2856 names
that as a real limitation (a mean cannot produce a tail), and a run manifest
should record it as such rather than imply a realistic latency profile.

Fault injection (`POST /__stub/tenants/{tenant}/fault`):

```bash
# Rate-limit tenant A for the next several requests, with an explicit
# Retry-After the real client actually reads and sleeps on.
curl -X POST http://localhost:8080/__stub/tenants/perf-allegro-a/fault \
  -H 'Content-Type: application/json' \
  -d '{"mode": "429", "retryAfterSeconds": 5}'

# Simulate an outage.
curl -X POST http://localhost:8080/__stub/tenants/perf-allegro-a/fault \
  -H 'Content-Type: application/json' \
  -d '{"mode": "503", "retryAfterSeconds": 10}'

# Hang past the real client's 30s abort (holdMs defaults to 31000; a smaller
# value is useful only for testing the stub itself, never for a real run).
curl -X POST http://localhost:8080/__stub/tenants/perf-allegro-a/fault \
  -H 'Content-Type: application/json' \
  -d '{"mode": "timeout"}'

# Clear a fault.
curl -X DELETE http://localhost:8080/__stub/tenants/perf-allegro-a/fault
```

A fault, once set, applies to every subsequent request from that tenant
against `/order/events`, `/order/checkout-forms/{id}` and `/me` until
cleared - it is not consumed after one request. Both 429 and 503 carry
`Retry-After` as integer seconds (the only response header OpenLinker's
Allegro client reads) and the Allegro error-body shape
`{"errors":[{"code":"...","message":"..."}]}`.

## Control surface (`/__stub/`)

All bodies are JSON, no auth required.

### `GET /__stub/health`

For a compose healthcheck. Returns `{"status": "ok", "runId": "..."}`.

### `GET /__stub/config`

The full resolved configuration - the run id, git sha, every latency value,
the offer pool size, the buyer pool size and the configured tenant names -
so a run manifest can assert against the stub's own running state rather
than only against what it was started with.

```bash
curl http://localhost:8080/__stub/config
```

### `POST /__stub/run`

Starts a new run: mints (or accepts) a run id and resets every tenant's
event/order history, counters and faults. This is what lets a driver repeat
the same scenario multiple times **within one process lifetime** and get
disjoint dedupe keys each time, without restarting the container.

```bash
curl -X POST http://localhost:8080/__stub/run \
  -H 'Content-Type: application/json' \
  -d '{"runId": "campaign-run-2"}'
# or, to auto-generate one:
curl -X POST http://localhost:8080/__stub/run -d '{}'
```

### `POST /__stub/tenants/{tenant}/orders`

The driver's entry point for order arrival. `{tenant}` is the configured
tenant **name** (e.g. `perf-allegro-a`), never the bearer token.

```bash
curl -X POST http://localhost:8080/__stub/tenants/perf-allegro-a/orders \
  -H 'Content-Type: application/json' \
  -d '{"count": 10, "lineItemsPerOrder": 3, "eventsPerOrder": 1}'
```

- `count` (default 1): how many orders to mint.
- `lineItemsPerOrder` (default 1): distinct line items per order, each drawn
  round-robin from the offer pool.
- `eventsPerOrder` (default 1): how many `/order/events` entries reference
  the same `checkoutForm.id` - set to e.g. 3 to exercise the real adapter's
  client-side dedupe-by-checkoutFormId behaviour.

Minted orders are served from `/order/events` on the very next poll of that
endpoint - the stub does not push anything itself. Pushing faster than
OpenLinker's own discovery ceiling (one page per cron tick, no loop inside
the adapter) simply queues inside the stub's in-memory event list; that is
expected and should be stated in the run manifest rather than read as a bug.

### `POST` / `DELETE /__stub/tenants/{tenant}/fault`

See "Pacing and fault injection" above.

### `GET /__stub/tenants/{tenant}/stats`

Per-tenant counters: requests served per endpoint, orders pushed, events
emitted, the current cursor head, and the active fault (if any).

```bash
curl http://localhost:8080/__stub/tenants/perf-allegro-a/stats
```

This is the source of truth for the "1 request per poll tick + 1 per
ingested order + 0 per line item" cost-model assertion.

## Pointing a connection at the stub

```json
{
  "config": { "environment": "production", "apiBaseUrl": "http://allegro-stub:8080" },
  "credentials": { "accessToken": "stub-token-a" }
}
```

`config.environment` remains mandatory on every Allegro connection
(`@IsIn(AllegroEnvironmentValues)`) but, with `apiBaseUrl` present, its only
remaining effect on this path is a cosmetic Sales Center deep link. Two
connections that differ only in `credentials.accessToken` (`stub-token-a`
vs. `stub-token-b`) are two independent tenants against one stub process.

Verify with `POST /connections/:id/test`, which reaches the stub's `/me` -
this is the bootstrap readiness check, not a manual step.

## Running the tests

```bash
node test.mjs
```

No install step, no pnpm workspace membership needed - `node:test` and
`node:assert` are both node core. The suite imports `server.mjs` directly
and starts it on an ephemeral port per test file (not per test - each test
calls `POST /__stub/run` first for isolation from prior tests in the same
process).

## What #2856 asks for that this implementation does NOT cover

Two acceptance criteria in #2856 are end-to-end properties of a real
OpenLinker install pointed at this stub, not something the stub alone can
satisfy or a unit test can assert:

- *"one order reaches `order_records.recordStatus='ready'` and a destination
  create"* - needs a running OpenLinker api/worker plus #2860's seeded
  `identifier_mappings`. This stub only guarantees its half of that contract
  (see "The offer-id contract with #2860" above).
- *"every default-ON Allegro scheduler task is either served by the stub or
  disabled... verified by zero dead `sync_jobs` rows"* - the five scheduler
  tasks #2856 lists (`offers-sync`, `taxonomy-sync`, `offer-status-sync`,
  `quantity-ack-reconcile`, `shipment-status-sync`) hit endpoints
  (`/sale/offer-events`, `/sale/categories`, `/sale/product-offers/{id}`,
  `/sale/offer-quantity-change-commands/{id}`,
  `/shipment-management/shipments/{id}`) that are genuinely out of scope for
  the two-endpoint ingestion path this stub measures, and #2856 explicitly
  frames disabling them in the stand's environment as the alternative to
  serving them. That is a stand-configuration decision (#2854/#2860's job),
  not code this stub ships. Left unserved here, they correctly 404 - fast
  and loud rather than silently degrading the measurement.

Everything else in the acceptance-criteria list is implemented and covered
by `test.mjs`.

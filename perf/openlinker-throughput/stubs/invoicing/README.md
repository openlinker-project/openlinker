# Invoicing-provider stub

Implements GitHub issue #3006. A single-process `node:http` stub that serves
one endpoint — `POST /invoices` — so a real, in-tree `InvoicingPort` adapter
(`@openlinker/integrations-invoicing-stub`) can exercise the ACTUAL
`InvoiceService.issueInvoice()` code path (per-order lock, `pending` row,
exactly-once idempotency gate, adapter call, `updateOutcome`) end to end,
with the provider's own response latency held at a fixed, operator-chosen
constant instead of a live authority's variance.

## What it measures, and what it does not

**It measures the `fiscal` lane's concurrency behaviour and the per-order
lock**, at a chosen provider latency `T`. That is the whole of it.

**It does not measure**: a real provider's variance (this stub always
answers in exactly `latencyMs`, never a distribution), its rate limits (none
are modelled), or its failure modes (every call succeeds — there is no
concept here of a genuinely invalid document to reject, which would be
exactly the "the mock is now the model" trap #2840 names by name). Any
figure derived from a run against this stub must say so.

## The one endpoint

| Method | Path | Behaviour |
|---|---|---|
| `POST` | `/invoices` | Reads the body, sleeps `latencyMs`, answers `201 {id, number, status: 'issued', issuedAt}`. |

Everything else is control surface under `/__stub/`:

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/__stub/health` | `{ok: true}` — compose healthcheck target. |
| `GET` | `/__stub/config` | Reports `{gitSha, latencyMs, requestsTotal, issuedCount, inFlight, maxInFlightObserved}`. |
| `PUT` | `/__stub/config` | Sets `latencyMs` for every subsequent `/invoices` call, with no restart. |
| `POST` | `/__stub/reset` | Zeroes `requestsTotal` / `issuedCount` / `maxInFlightObserved` for a clean per-arm read. `latencyMs` is the arm's independent variable and deliberately survives a reset. |

## Why latency is mutable at runtime

`stubs/allegro/server.mjs` reads its per-endpoint latency from the
ENVIRONMENT at container start, which the F8 scenario's own header notes
means changing it needs a container recreate. This stub's measurement
sweeps THREE latencies (2s / 10s / 90s) against TWO lane caps — six arms —
and a recreate per arm would multiply the sweep's wall-clock cost for no
benefit, since nothing about the stub's build changes between latencies.
`PUT /__stub/config` lets a driver script change `latencyMs` between arms
while keeping the worker's OWN recreate (which genuinely is needed, to
apply a new `OL_LANE_FISCAL_SCOPE_CAP`) as the only container churn in the
sweep.

## `maxInFlightObserved` is the load-bearing metric

The whole point of the scenario this stub serves is: does achieved
concurrency at the destination boundary reach the lane's `perScope` cap, or
does it stay at 1 regardless — i.e. is the bulk-issue serialisation claim in
`results-lane-caps-2026-09-07.md` § 4.5 (that `invoicing.issue` and
`fiscalization.register` share one per-order lock and are therefore
serialised by the LANE CAP alone, even over N distinct orders) true. Reading
concurrency off `sync_jobs` row timestamps is possible but coarse (the
runner polls at ~1 Hz, F7's own established floor); reading it off THIS
stub's own in-flight counter, taken at the exact point OpenLinker crosses
the provider boundary, is exact and free of that floor. `test.mjs` asserts
both directions of this claim directly: N genuinely concurrent calls report
`maxInFlightObserved = N`, and N genuinely sequential calls (the guard's
negative case) report `1`.

## Design decisions

Same as `stubs/allegro/README.md`'s: standalone `node:http`, zero
dependencies (this directory is not a pnpm workspace member — see
`server.mjs`'s own header for why), never answers with a status that would
trigger a real retry/backoff classifier on the OpenLinker side (there is
none registered for this adapter's own errors, since it never throws), and
`server.mjs` exports `{server, describeConfig, _resetForTest}` for
`test.mjs` to drive in-process on an ephemeral port rather than shelling out
to a second node process.

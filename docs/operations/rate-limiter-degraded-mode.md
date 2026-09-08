# Rate limiter degraded mode - what it is, how to see it, when to worry

`RedisRateLimiterAdapter` (`libs/shared/src/rate-limit/redis-rate-limiter.adapter.ts`)
throttles a connection's outbound traffic against **one shared bucket in
Redis**, so `apps/api` and `apps/worker` - two independent processes - pace
against the same limit instead of two independent in-memory pools (#2015,
ADR-038). This page documents its one failure mode and the two things an
operator can do about it today: read the log, and size for it. It does not
document a metrics-panel alert, because none exists (see "Why there is no
alerting rule" below).

## What "degraded" means

Every Redis call the limiter makes is bounded by a timeout
(`redisCallTimeoutMs`, default 1000 ms). If a call times out or the Redis
client rejects it, the limiter **fails degraded, not open**: that call falls
back to a private per-process in-memory limiter (`insuranceLimiter`) instead
of admitting the request unconditionally. The class doc calls this posture
out explicitly - degraded mode paces, it does not stop pacing.

The critical property: **the fallback is per process, not per call**. One
limiter instance exists per connection per process
(`libs/shared/src/rate-limit/rate-limiter-registry.ts`), and its insurance
limiter is scoped to that instance. On a single-replica install this changes
nothing about the *aggregate* rate seen by the destination - one process,
one insurance limiter, same declared limit. **On an N-replica install, each
replica paces independently while degraded**, so the destination can see up
to N times the declared limit for the duration of the episode.

## It does not need an unhealthy Redis to happen

`results-C-2026-08-27.md` (`perf/prestashop-baseline/`) recorded a degraded
episode in a normal run, not an induced one: 85 timeouts in one window (47
`claimConcurrency` + 32 `checkPace` + 6 `release`), with `redis-cli --latency`
reading 0 ms throughout. The diagnosis was the **worker's own event loop**,
blocked by concurrent `display=full` JSON parses, starving the ~1 ms Redis
needed to answer inside its 1000 ms budget - not a slow or unreachable Redis.
So sizing for this risk is about the worker's own CPU/loop headroom under
load, not about Redis's availability SLA.

## How to see it today: the log token

`enterDegraded` (private method, same file) now emits a stable, greppable
token at the transition and at most once every `DEGRADED_LOG_INTERVAL_MS`
while it persists:

| Event | Level | Token |
|---|---|---|
| Enters degraded mode | `error` | `rate_limiter_degraded_entered` |
| Still degraded (repeated) | `warn` | `rate_limiter_degraded_still_degraded` |
| Recovers | `log` | `rate_limiter_degraded_recovered` |

Each line carries `connectionId=<id>` so an operator can tell which
connection is affected. `grep` these tokens in the worker's (and api's) log
stream; there is nothing else in this repository that surfaces the
transition today.

## What `getStatus()` does and does not tell you

`getStatus()` reports the adapter's own local counters (`inFlight`, `queued`,
`lastAcquiredAt`). The insurance limiter's own bookkeeping is invisible to it
by construction - it is a separate, privately-composed instance. The
delegated call's in-flight/last-acquired bookkeeping is mirrored into the
outer adapter's local counters specifically so this panel does not read a
stale zero for the whole episode, but nothing on the panel says **"this
connection is currently degraded"**. The log token above is the only signal
for that today.

## Why there is no alerting rule

There is no Prometheus, Grafana, or Alertmanager anywhere in this repository,
and the metrics exporter (#2850) explicitly scopes production alerting out of
its own acceptance criteria. So "wire an alerting rule to this counter" would
alert nobody. The log token is the repository's actual production-alerting
primitive today: point your log shipper's existing pattern-match alerting
(if any) at `rate_limiter_degraded_entered`, the same way you would for any
other `error`-level token in this codebase.

## Sizing guidance for multi-replica installs

If you run more than one worker/api replica against a connection with a
configured `requestsPerMinute` or `maxConcurrent`, and that connection's
destination has degraded (slow, timing-out) infrastructure of its own,
understand that a degraded episode can pace at up to (replica count) x the
declared limit for its duration. This is a known, accepted limitation today,
not a defect being tracked for a fix - see "What was deliberately not done"
below. If your destination enforces its own hard rate limit with a
rejecting (not degrading) response, a multi-replica degraded episode is what
would trip it.

Revisit this page if you actually run multi-replica against a rate-limited
shop and want the N-replica shop-side consequence measured precisely; #2840
declined to build that measurement (multi-replica **and** a shop-side
instrument running simultaneously, for a probabilistic failure that needs
repeats to characterise) because single-replica installs - every install
today - are unaffected, and the mitigation would be the same regardless of
the precise multiplier.

## What was deliberately not done

- **No induced-latency measurement of the N-replica multiplier.** #2840/#2853
  recommend documenting and alerting on the failure instead of measuring its
  magnitude, because the value of a precise number does not change the
  mitigation, and a number taken under induced Redis latency would describe
  that injected profile, not anything OpenLinker does (results-C's own
  episode had a *healthy* Redis and a *blocked* event loop - the inverse of
  what a latency-injection rig would reproduce).
- **No alerting rule.** See above - there is no alerting stack in this
  repository to wire one into.
- **No change to `getStatus()`'s shape.** Surfacing a `degraded: boolean` on
  the API-facing status object is a reasonable follow-up but is out of scope
  here; the log token is the immediate, zero-risk deliverable.

## Related

- **#2853** - the issue this page answers, filed with an explicit
  recommendation not to measure the expensive half.
- **#2840** - the performance measurement programme this was filed off.
- `perf/prestashop-baseline/results-C-2026-08-27.md:206-237` - the one
  observed degraded episode and its single-replica caveat.
- ADR-038 - the decision to share one Redis-backed bucket across processes
  in the first place.

# ADR-066: The PrestaShop integration stays Webservice-first; shop-side PHP is added only where the Webservice loses structurally

- **Status**: Accepted
- **Date**: 2026-08-27 (accepted 2026-08-28 on the closing measurement — see the amendment below)
- **Authors**: @norbert-kulus-blockydevs

## Context

#2489 asked for a dedicated PrestaShop module, on the premise that API-based synchronisation puts significant load on the shop. The original design grew to twelve endpoints with a security envelope, a GDPR pack, version negotiation, key scopes and rotation, and an install self-test.

On 2026-08-27 the current integration was measured on a live stack: 10 000 products by 3 variants, counted in PrestaShop's own Apache access log, median of three runs, plus a control run on untouched code from a fresh container. Two of the three premises did not survive.

- **The shop does not slow down.** p95 under a full catalogue sweep is 0.989x idle, and 0.995x at 5.5 times the tempo.
- **Bulk reads already work.** 3 requests, 0.38 s, 1.33 MB for 100 fully hydrated products over the plain Webservice. `PrestashopProductMasterAdapter.getProducts` already implements this and has no caller anywhere in the repo.
- **There really are too many requests.** Two days of adapter work took requests per SKU from 7.96 to 3.97, reproducing within 0.4% against the control run.

One measured path is different. An eight-line order costs 27 requests, of which 16 are a `POST /specific_prices` plus `DELETE /specific_prices/{id}` pair per line. There is no bulk write on that resource, and the buyer-paid price must be pinned to the cart before `validateOrder` runs.

## Decision

The PrestaShop integration stays Webservice-first. Shop-side PHP is added only where the Webservice cannot express the operation at all, and only on a controller that already exists with its own secret and signature.

Concretely: #2489's ten acceptance criteria are closed by adapter work, a lane-policy decision under [ADR-050](./050-workload-isolation-concurrency-lanes.md), and a measurement campaign. The only PHP addition is an optional line-prices field on `controllers/front/importorder.php` (#2597). The twelve endpoints of the original design are not built.

## Alternatives considered

- **Build the module as specified.** Rejected: the load premise was measured and did not hold, the bulk-read premise was already satisfied by unreferenced code, and the remaining ten endpoints were infrastructure for a data channel we would then maintain forever. Estimated 352 to 576 person-days.
- **A new bulk order-import endpoint.** Saves 26 of 27 requests against 16 of 27 for the conditional field, at 5 to 8 days against 1 to 2, and brings a security envelope, GDPR pack and version negotiation with it. Rejected on cost per request saved.
- **Raise `OL_LANE_REALTIME_SCOPE_CAP` globally and stop there.** Rejected: that cap bounds every realtime job for every connection and is per-process, so it multiplies by replica count. ADR-050 chose it by cost of starvation, not throughput. The measurement proves the shop tolerates more; it says nothing about what a buyer's order tolerates.

## Consequences

**Pros:**
- No second data channel to secure, version, GDPR-audit and maintain.
- The gains are in code that every PrestaShop install already runs, with no module upgrade required.
- The real bottleneck is now named honestly: after the adapter fix it is OpenLinker's own concurrency policy, which the module would not have solved either.

**Cons and trade-offs:**
- **Incremental stock detection stays impossible.** `ps_stock_available` has no timestamp column of any kind, so the Webservice can never answer "what changed since X" and every stock sweep reads the whole catalogue. This is the one capability a shop-side module would provide that the Webservice cannot match. It is deferred to a spike with an explicit kill condition (#2612), not assumed away.
- **Acceptance criterion 1 of #2489, "dedicated module implemented", closes as not done by decision** unless #2597 is taken. Nine of ten is the expected outcome.
- Eight children still touch the existing module, because it already runs at customers and carries live defects. Choosing not to grow it is not the same as leaving it alone.

**Migration path:**
- None for existing installs on the adapter side. The two module children that change stored settings (#2602, #2604) ship upgrade scripts through the module's existing mechanism.
- #2597 is negotiated: the adapter falls back to the per-line path when the module reports the field unsupported.

## Amendment (#2625 / #2644 / #2657) - the closing measurement, and the two premises it corrects

This ADR was filed `Proposed` on a measurement of the *problem*. It is accepted on a
measurement of the *result*: `results-C` (the epic against the pre-change baseline, 10 000
products), `results-D` (the same code at 100 000) and `results-E` (the tree as it now
stands, after #2647, #2648, #2651 and #2652). All three are in
[`perf/prestashop-baseline/`](../../../perf/prestashop-baseline/). Every figure below is
**measured** in PrestaShop's own Apache access log, median of the repeat runs with the cold
run discarded, zero retries, and - this qualifies all of them - on a **single worker
replica**. Lane caps bound one process, so N replicas multiply every request-rate figure.

| per 100 products | baseline | after the adapter fix | **the epic** |
|---|---:|---:|---:|
| shop requests | 796 | 397 | **5.8** |
| requests per SKU | 7.96 | 3.97 | **0.058** |
| per stock position | 3.00 | 1.00 | **1.00** |
| inventory tick | 300 requests | 100 requests | **5 requests / 21 s** |
| catalogue tick | - | - | **29 requests / 46 s** for 500 products |
| eight-line order | 29 | 27 | **7** |

A control run on untouched code under the final stand conditions reproduced the baseline
within **0.4%** (799 requests against 796), so the improvement is attributable to the code
and not to anything the campaign changed around it. #2489's AC3, AC4, AC5 and AC10 are met
**without the twelve-endpoint module.** The decision stands.

**Correction 1 - the flagship store-impact figure in the Context above is an artefact, and
must not be quoted again.** The 0.989 and 0.995 ratios were taken with a probe that never
checked the HTTP status code, so a fast error under load counted as a fast sample. Both are
below 1.0, which asserts the shop answered *faster* while being swept - not a plausible
physical result. With a status-checked probe the direction is up.

**Correction 2 - and store impact is a function of cursor DEPTH, not catalogue size.**
`results-D` measured 1.403 at 100 000 products against 1.053 at 10 000 and read that as a
size effect. `results-E` re-measured it at two cursor positions under the same budget:

| cursor | p95 ratio vs idle | errors |
|---|---:|---:|
| offset 0 | **0.97** (no impact) | 0 |
| offset 98 000 | **1.39** | 0 |

Request count per tick is flat; what changes is the cost of each request
(`products?display=full&limit=100` costs 254 ms at offset 0 against 386 ms at offset
99 000) and the storefront shares MySQL with it. So impact is **not constant across a
cycle**: a tick early in a pass is free, a tick deep in one costs about 40% of p95 - on this
stand 76 ms against 54 ms, with zero errors in every window. The decision's practical
conclusion (a catalogue sweep does not meaningfully hurt the storefront) survives; the
unqualified claim that "the shop does not slow down" does not.

**Two conditions the headline throughput number carries.** The connection's declared
`requestsPerMinute: 60` - a placeholder, per the plugin's own comment and #1810's open
question - metered both sweeps flat at 60-61/min through every set-1 run. Raising the lane
cap changed how many OL jobs ran at once and did not change how many requests reached the
shop. Only the lane cap shipped as a default, so **an operator who deploys this epic and
changes nothing gets the request-count reduction in full and none of the throughput
headline**; "~2.4 h instead of 26.5 h" must be quoted with the configuration it requires.
After this epic the next real PrestaShop throughput gain is a rate-limit decision, not a
concurrency one.

**One cost the decision created and the measurement found.** The epic's process-scoped
resolver cache writes only on success, so a *permanently* failing read (here a missing
webservice permission on `product_options`) is never cached and is retried per product:
196 reads per 100 products became **996**, and a 1 134-warning window named the URL every
time without ever aggregating or reaching an operator-facing state. The correct shape ships
next door in the same epic - `prestashop-pack.resolver.ts` caches a *negative* answer under
its own short TTL. The attribute and feature resolvers are not on it. Pre-existing, and
reported because it dominated the measurement this ADR is judged by.

**What the campaign did not establish**, stated so it is not read as covered: no full
replication cycle was ever reached at 100 000 products (~2.8 days, derived); the A4 orders
priced at zero on the synthetic stand, so the request counts are valid and the orders they
produced are not correct orders; the module's PHPUnit suite did not execute; and the
Redis-limiter degraded-mode caveat (per-process insurance limiter, so N replicas can pace at
N x the declared limit during an episode) was never exercised - this campaign used one
replica.


## References

- Related issues: #2489, #2590, #2592, #2593, #2594, #2597, #2609, #2612, #2625, #2644, #2647, #2648, #2651, #2652, #2657
- Related PRs: #2627
- Related ADRs: [ADR-048](./048-incremental-catalog-replication.md), [ADR-050](./050-workload-isolation-concurrency-lanes.md)
- Measurements: [`perf/prestashop-baseline/results-C-2026-08-27.md`](../../../perf/prestashop-baseline/results-C-2026-08-27.md), [`results-D-2026-08-28.md`](../../../perf/prestashop-baseline/results-D-2026-08-28.md), [`results-E-2026-08-28.md`](../../../perf/prestashop-baseline/results-E-2026-08-28.md)
- Implementation plan: [docs/plans/implementation-plan-2590-prestashop-no-module.md](../../plans/implementation-plan-2590-prestashop-no-module.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md)

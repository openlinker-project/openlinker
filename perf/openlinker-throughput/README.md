# OpenLinker throughput stand

Load drivers and measurement reports for the OpenLinker API itself, as distinct
from `perf/prestashop-baseline/`, which measures a shop's own webservice.

## Layout

| Path | What it holds |
|---|---|
| `bootstrap.sh` | Brings up the lab stand's *upstreams* — PrestaShop, WooCommerce, the Allegro stub. It does **not** seed `order_records`. |
| `drivers/*.js` | k6 drivers, one per measurement. Each is self-contained and reads its configuration from env vars documented in its own header. |
| `results-*.md` | One report per run, named `results-{issue}-{subject}-{YYYY-MM-DD}.md`. |
| `results/` | Untracked. Raw k6 `--summary-export` JSON lands here; mount it into the container or the export silently fails. |
| `stand/`, `stand-*.txt`, `stand-*.env` | Untracked local state for whoever currently holds the stand. |

## Reports

| Report | Subject |
|---|---|
| [`results-2943-two-stage-total-2026-09-06.md`](./results-2943-two-stage-total-2026-09-06.md) | #2943 — the paginated total as a second stage. Time-to-rows vs time-to-total on `/orders` at 1M rows, with the unchanged combined route as an in-run control. |

## Writing a driver

Three rules, each of which was learned from a run that reported a plausible
number and was wrong:

1. **Check the HTTP status before recording a latency sample.** A fast error is
   not a fast response (#2590 correction 1).
2. **One `Trend` per named route, never a blended one.** Different routes
   measure different things and must not share a bucket (#2842).
3. **Set a `non_2xx_responses: ['count == 0']` threshold.** k6 omits a Counter
   that never received a sample, so a missing line in the summary cannot be
   told from a counter nobody wired — the threshold makes the run fail instead
   of leaving a reader to infer it.

## Writing a report

State separately what was measured and what was inferred; give each figure its
own `n`; name the control; and say what was **not** measured. A report that
cannot be reproduced from its own recipe is a claim, not a measurement — check
the recipe by running it before committing.

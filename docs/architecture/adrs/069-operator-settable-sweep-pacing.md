# ADR-069: Sweep pacing is the operator's decision, bounded by a two-tier ceiling, and what is reported must be what is enforced

- **Status**: Accepted
- **Date**: 2026-08-28
- **Authors**: OpenLinker maintainers (retrospective documentation of decisions made across PRs #2659, #2660)

## Context

[ADR-048](./048-incremental-catalog-replication.md) made every master sweep budget-bounded and resumable, and #2593/#2648 made a tick cheap. What it did not do is decide **how much catalogue an installation should replicate per tick** - and that is not a decision OpenLinker can take, because the answer depends on someone else's hardware, someone else's catalogue and someone else's tolerance for a slower storefront.

Until #2651 the answer was a code constant with an env-var override. Three things made that a poor surface, and the third is the one that turns it from a convenience issue into a correctness one:

- Changing a budget meant editing a `.env` and restarting the worker.
- Since #2279 moved the scheduler into the worker, `OL_MASTER_PRODUCT_RECONCILE_CRON` set on the api was **silently ignored** - no error, no effect.
- The pacing genuinely mattered. ADR-048's own amendment derives full-cycle times at 100 000 products of ~2.8 days (catalogue), ~10.4 days (inventory) and ~41.7 days (deletion audit), and the binding constraint is the number of TICKS - a budget-and-cadence question that no lane cap can answer.

Meanwhile the measurement said the shop tolerates more than the defaults ask of it, but **not uniformly**: `results-E` measured a p95 ratio of 0.97 at cursor offset 0 and 1.39 at offset 98 000 under the same budget. Impact varies with cursor depth, so there is no single number that is right for every install or even for every tick of one install.

## Decision

**Pacing is operator-settable at runtime, in a leaf `operational-settings` core context, bounded by a two-tier ceiling.** Four numbers (catalogue sweep budget, inventory sweep budget, sweep page size, deletion-audit budget) plus the deletion-audit cadence, on a singleton `operational_settings` row - the third instance of the shape `ai_provider_active_setting` and `reporting_currency_setting` already established.

Four rules make it safe:

**1. Resolution is `DB row -> env var -> code default`, and every value is reported with the rung that produced it.** Every column is nullable and `NULL` means *not set*, so an install that upgrades past the migration and never opens the page behaves byte-identically to before, and an install that had only ever set an env var keeps getting that value. The rung (`setting | env | default`) travels with the value so a UI renders `500 (default)` instead of comparing against a hardcoded number - a client-side comparison is a second copy of the default, wrong the day the default moves.

**2. Two kinds of ceiling, deliberately not conflated.** A `recommendedMax` is OUR judgement and is exceedable; an `absoluteMax` is refused whatever the request says. Each carries a reason string the UI renders rather than inventing one. Going above the recommendation requires `acknowledgeAboveRecommended: true` **on the request**, and that flag is **never persisted**: one decision to run past our advice must not silently license every later write, and a persisted flag would outlive the decision that justified it.

**3. Reported must equal enforced.** The bounds table is read by the API validator, by the response's `bounds` block and by the worker's own resolve-time clamp. That clamp uses `absoluteMax`, **never** `recommendedMax` - narrowing an acknowledged value back down would show 5 000 on the settings page and run 2 000 in the sweep, which is the reported-versus-enforced gap in its purest form. The DTO decorator is a fast rejection and an OpenAPI convenience, never the gate: the browser is not a trust boundary, and its `@Max` is therefore the absolute ceiling, since enforcing the recommendation there would refuse a legitimate acknowledged request before the service could weigh it.

**4. A budget applies per tick; a cadence applies at the next scheduler start, and the API says which.** Both sweep handlers and the audit handler resolve the settings **inside** `execute()` - a value needing a restart would be barely better than the env var it replaces. A `CronJob`'s expression is fixed at construction, so the scheduler snapshots the cadences immediately before `start()` and the response states `cadenceAppliesAt: 'next-scheduler-start'` rather than implying otherwise.

## Alternatives considered

- **Keep env vars and document them better.** Rejected: it cannot fix the restart requirement, and it leaves the #2279 trap (a scheduler var set on the wrong process) exactly where it was.
- **One ceiling, refuse above it.** Rejected: our judgement about a stranger's hardware is not a hard limit, and encoding it as one makes OL wrong on the installs that most need to go faster. Conversely a single *advisory* ceiling would let a typo (`50000` for `5000`) through on a shrug.
- **Persist the acknowledgement.** Rejected - see decision 2. It converts a reviewed exception into a standing permission, and the column would outlive every reason for it.
- **Clamp to the recommendation at resolve time and keep the API permissive.** Rejected explicitly: it is the exact defect this ADR's third rule exists to forbid, and it fails silently.
- **Make cadence-vs-budget uniform by re-registering crons per tick.** Rejected: cron registration is a boot-shaped operation and re-registering on a schedule invites a fleet with no scheduled tasks at all. Stating the asymmetry honestly is cheaper than engineering it away.
- **Let the operator disable the deletion audit.** Rejected: #2222 made `master.product.reconcile` the deletion authority, so switching it off silently reopens #1689 - a deleted product whose offers keep selling. The input carries a cadence and no enablement, the view reports `deletionAuditAlwaysEnabled: true` so the absence reads as a decision rather than an oversight, and a cadence firing less often than weekly is refused as a disable in disguise. One env var remains the only off switch.

## Consequences

**Pros:**
- An operator can pace OL against their own shop, from a page, without a restart, and with our recommendation and its reason visible instead of buried in a `.env` comment.
- **Measured end to end** (`results-E` § 3, single replica): a `catalogueSweepBudget` of 2 500 without acknowledgement answers 400 naming the ceiling and its reason; with the acknowledgement, 204; 50 000 with the acknowledgement is refused as above the absolute ceiling. And a budget change takes effect with **no worker restart** - 500 gave 5 batch children, 1 000 gave 10, with the container's `StartedAt` unchanged. Measured, not asserted.
- A platform's own wall stays where the request is built rather than being smuggled into this table as our opinion: an adapter **refuses** a page size above its own `per_page` rather than clamping to it (`exceedsAdapterPageSize`, and WooCommerce throws). Clamping was this ADR's first wording and it was wrong: `readPagedIds` infers end-of-collection from a page shorter than the size it asked for, so a clamped page reads as the end of the catalogue - a cycle "completed" after 100 products, the cursor cleared, and the same first 100 swept on every tick for ever behind one warn line. A refusal is loud and stops nothing silently. The message must also name the control that actually feeds the value (`OL_PRODUCT_SYNC_PAGE_SIZE` for the enumeration), not this page's `sweepPageSize`, which is the batch child's `groupSize`.

**Cons / trade-offs:**
- **The knob is real, so a bad value is real.** The recommendation is advisory by construction; an operator who acknowledges past it can slow their own storefront. That is the trade - the alternative is OL's guess binding somebody else's hardware.
- **The asymmetry between budgets and cadence is a permanent piece of vocabulary** an operator has to hold. It is stated in the API and in the page copy, and it will still surprise someone.
- **Only one task declares a settings-driven cadence.** Widening that to every scheduled task is a separate decision, so the page is not a general scheduler console and should not be read as one.
- The two per-sweep batch-size env vars survive as narrower overrides, consulted only while no operator has set the shared page size. Collapsing them would silently change the inventory sweep's page size for an install that had tuned only the product one - a behaviour change on upgrade, which the fall-through exists to avoid. The cost is one more resolution rule.
- **The calculator on the page models the tick, not the shop.** It projects a run linearly from the measured per-tick cost and over-predicts by about 16% at budget 2 000 (predicted 184 s, measured 156 s and 160 s) - the safe direction. It cannot predict where a shop breaks, and says so: per ADR-048's amendment the shop's own cost varies with cursor depth, which the calculator does not model.
- The outbound request rate limit is deliberately **out of scope** - `Connection.config.rateLimit` is per-connection and already edited on the connection form. Adding it here would give one value two homes.

*Reversal gate (prose-only):* an operator legitimately needing a value above an `absoluteMax`. That is evidence the ceiling encodes a mechanism that has changed (the `sweepPageSize` ceiling, for instance, is derived from the request-line length a `|`-joined id list produces), and the ceiling should be re-derived in a reviewed change rather than raised on request.

*Reversal gate (countable):* a second setting whose resolve-time clamp reads `recommendedMax`. One is a bug; two means the two-tier model is not being understood and should be collapsed or renamed.

## References

- Related issues: #2651 (the settings context and API), #2653 (the settings page and its calculator), #2657 (the measurements cited above), #2279 (the scheduler move that made a scheduler env var on the api inert), #2222 / #1689 (why the deletion audit has no off switch here)
- Related ADRs: [ADR-048](./048-incremental-catalog-replication.md) (budget-bounded resumable runs, and the cycle-length figures this exists to let an operator change), [ADR-050](./050-workload-isolation-concurrency-lanes.md) (lane caps - a different knob, which cannot shorten a cycle), [ADR-066](./066-prestashop-webservice-first-integration.md) (the measurement campaign), [ADR-040](./040-order-time-fx-stamping-against-a-system-reporting-currency.md) (the singleton-settings-row + reported-source shape reused here)
- Measurements: [`perf/prestashop-baseline/results-E-2026-08-28.md`](../../../perf/prestashop-baseline/results-E-2026-08-28.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Core Bounded Contexts - 20. Operational Settings

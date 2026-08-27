# ADR-066: The PrestaShop integration stays Webservice-first; shop-side PHP is added only where the Webservice loses structurally

- **Status**: Proposed
- **Date**: 2026-08-27
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

## References

- Related issues: #2489, #2590, #2592, #2593, #2594, #2597, #2609, #2612, #2625
- Related PRs: #2627
- Related ADRs: [ADR-048](./048-incremental-catalog-replication.md), [ADR-050](./050-workload-isolation-concurrency-lanes.md)
- Implementation plan: [docs/plans/implementation-plan-2590-prestashop-no-module.md](../../plans/implementation-plan-2590-prestashop-no-module.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md)

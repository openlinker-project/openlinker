# Publishing the campaign's figures externally (#2864)

**Status: design decision only. No public page exists yet, and this file is
not it.** #2864 is the child that publishes stable figures to a
prospective-user audience; #2840's own Assumptions section is explicit that
the programme "can otherwise be complete having published nothing" and that
publishing before figures are stable would discredit the honest numbers
alongside the weak ones. That gate is the reason this file stops at a plan.

## Why nothing is published today

#2864 depends on stable figures from #2842 (F3), #2843 (F5), #2844 (F6),
#2847 (F1), #2848 (F2), #2851 (F4), #2852 (F7), gated through #2845's
`VALID` / `DISCARDED` / `--quick` distinction.

Read against the tracker on 2026-09-08:

| Flow | Issue | State | Publishable today? |
|---|---|---|---|
| F1 order ingestion | #2847 | **closed** | figures exist (`results-F1-2026-09-07.md`) |
| F2 stock propagation | #2848 | open | not yet |
| F3 webhook ingress | #2842 | open | one clean sweep past 1000 req/s still owed (see #2842/#2931/#2933) |
| F4 claim contention | #2851 | **closed** | figures exist |
| F5 read path | #2843 | open | partial - see `results-F5-2026-09-06.md`'s own corrections and `results-reseed-2026-09-07.md` |
| F6 sweeps | #2844 | open | not yet |
| F7 cross-lane starvation | #2852 | open | not yet |
| #2845 run-all + quotability gate | #2845 | open | **the gate this generator reads does not exist yet** |

Two of seven flow dependencies are closed, and the mechanism that defines
"quotable" (#2845) is itself unbuilt. Publishing now would mean either (a)
shipping five blank rows next to two real ones - which reads worse than
publishing nothing, since a blank row invites a reader to assume "not yet
measured" rather than the correct "measured and it moved" for the flows that
already changed meaning mid-campaign (F5's withdrawn sub-linear conclusion,
`results-F5-2026-09-06.md`'s own masthead correction) - or (b) inventing a
gate ad hoc that #2845 will later define differently, which is exactly the
kind of drift the honesty ledger exists to prevent.

So this issue stays open, and this file records the decision that WOULD
otherwise need to be re-litigated once the remaining flows land.

## The location decision

**The repository, not a separate marketing site or docs site build.**
`perf/prestashop-baseline/` already established the precedent of committing
`results-*.md` reports directly into the tree; #2864's own text calls that a
"page equally unpublished today, a year of work later" and the fix is
narrower than standing up new infrastructure. The generated artefact is:

- **Source of truth**: the individual `results-*.md` files under
  `perf/openlinker-throughput/`, unchanged.
- **Generated page**: `perf/openlinker-throughput/PUBLIC.md`, produced by a
  generator script (below) from whichever `results-*.md` files carry a
  `VALID` verdict per #2845's manifest/verdict contract. Never hand-edited -
  a corrected figure is regenerated, not patched in two places.
- **Where a human reads it**: linked from the top-level repository `README`
  once it has content, so a prospective user or contributor finds it without
  knowing the `perf/` layout exists. No separate site build in scope here.

## The gate, stated precisely (for the generator to implement once #2845 exists)

A `results-*.md` file is eligible for `PUBLIC.md` iff, per #2845's contract:

1. Its run's `verdict.txt` reads `VALID` (never `DISCARDED`, never a
   `--quick` run — #2845's `NON-QUOTABLE` heading exists for exactly this
   purpose and this generator must not be a way around it).
2. Every figure pulled from it keeps its **measured / derived / extrapolated**
   label, verbatim, attached to the number - never summarized away.
3. Every **non-mixed** figure carries the idle-stand caveat (#2840's
   Assumptions: "every throughput figure other than the mixed-workload run
   is a best case taken on an otherwise idle stand").
4. The mixed-workload run (`results-sustained-mixed-load-*.md` /
   `results-mixed-load-fixed-*.md` once one of those closes `VALID`) is the
   **headline figure**, stated with its `n=1` limitation in the same
   sentence - it is the only number an operator can apply to their own
   Tuesday.
5. A **"what this did not establish"** section is mandatory on the generated
   page as a whole, not only inherited per-source-file - assembled by
   concatenating each included file's own such section, deduplicated.
6. Platform coverage is stated explicitly: PrestaShop plus a stubbed
   Allegro, a real-WooCommerce destination arm, no Erli (#2865 is the
   tracked gap).
7. A withdrawn or corrected figure (F5's sub-linear-scaling conclusion is the
   standing example, `results-F5-2026-09-06.md`'s masthead correction block)
   is represented by its **current, corrected** statement, never the
   original - the generator reads the masthead correction block as the
   authoritative current value when one is present.

## What exists today toward this

- **This decision file.** Location + gate rules, so the generator's shape is
  argued once rather than re-decided per-flow as each one closes.
- **Nothing else is populated.** No `PUBLIC.md` exists. Writing the
  generator script itself is deferred to when there is a second `VALID`
  mixed-workload-class figure to feed it - a generator tested against a
  single-file input verifies nothing about the multi-file dedup/label-
  preservation logic that is the actual risk here, and building it against a
  fabricated second input would repeat the campaign's own named trap ("the
  mock is now the model") one layer up, in tooling instead of a stub.

## Closing condition

This issue is closeable when: `PUBLIC.md` exists, is generated (not
hand-written), passes the gate above against every currently-`VALID` result
file, carries the mixed-workload run as its headline with `n=1` stated, and
is linked from the top-level README. None of that is true yet.

## Related

- **#2840** - names this child in its Assumptions.
- **#2845** - owns the `VALID` / `DISCARDED` / `--quick` distinction this
  file's gate depends on; also open today.
- **#2846** / the Allegro sandbox latency baseline (#2861, closed) -
  prerequisites for quoting F1 externally, per #2864's own Assumptions.
- **#2865** - Erli's inbox cliff, the one platform gap this page must state
  rather than silently omit.

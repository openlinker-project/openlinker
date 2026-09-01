# PR #2675 review — apps/web, scripts, docs, .eslintrc.js (WIP)

Base: origin/oms-programme-wave-2 @ 06994c4aa. Node 22.22.1.

## Gate inventory (derived)
- 77 chain steps in `pnpm check:invariants`; 43 distinct `check-*` scripts (42 `.mjs` + `check-fixture-purity.sh`); 0 scripts on disk unwired.
- 34 steps carry `--self-check`.
- Baseline: `pnpm check:invariants` exits 0.

## Falsification results (in progress)
See final report.

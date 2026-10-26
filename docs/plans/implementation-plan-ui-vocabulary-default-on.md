# Implementation plan: check-ui-vocabulary covers every feature slice by default (#2737)

## 1. Goal and layer

`scripts/check-ui-vocabulary.mjs` enforces design rule P9 (nine banned
model-internal words in operator-facing copy) but only over a hand-maintained
`SCAN_ROOTS` list: 8 of ~38 slices under `apps/web/src/features/`. `features/connections`
is not covered, and a slice added tomorrow is not covered either.

Layer: DX / invariant script (no backend, no frontend runtime code, no migration).

**Non-goals**: scanning `pages/`, `shared/`, `plugins/`; per-surface scoping of the
banned list (issue point 3 - no evidence needs it, see below); widening what counts
as "copy" (JSX text next to `{expr}` stays a known gap, shared with
`check-provider-name-boundary.mjs`).

## 2. Evidence (trial run on `origin/main` eb11df527)

Adding all 30 uncovered slices to `SCAN_ROOTS` on a throwaway copy produced **zero
banned-word findings**. It produced only structural complaints:

- `features/{adapters,cursors,health,webhook-deliveries}` contain no `.tsx` and no
  copy module, so today's per-root "Z3: a root must contain a scannable file" rule
  would fail them although they legitimately hold no operator copy.
- `features/analytics/lib/{data-coverage-copy,needs-attention-copy}.lib.ts` name
  themselves copy but the scanner does not recognise the `.lib.ts` spelling
  (Z4 "copy-module escapee") - their sentences are unchecked today.

So the feared "unbounded diff across unrelated features" does not materialise; the
change is the script's shape plus two renames.

## 3. Design

1. **Default-on discovery.** Scan roots are every direct subdirectory of
   `apps/web/src/features/` found at run time. No per-slice list, no `owner`/`pending`
   fields. A new slice is covered the moment its folder exists.
2. **Exempt by exception.** `EXEMPT_FEATURES` (Map slug -> reason, empty at ship) for a
   whole slice; the existing file-level `EXEMPTIONS` stays. A feature exemption naming
   a folder that does not exist fails (a typo exempts nothing).
3. **Zero-case rules, re-stated for discovery** (this repo's recurring lesson - a gate
   that passes because it matched nothing):
   - Z1 (spec table parses to zero terms) - unchanged, FATAL.
   - Z2 (parent `features/` missing) - now FATAL, since nothing is "pending" any more.
   - Z3 per-root "must hold a scannable file" -> **global**: the run FAILS when it
     scanned zero files, or when fewer than `MIN_SCANNED_SLICES` slices hold a scannable
     file (floor, so a broken walk/extension test that empties most slices still fails
     while the four copy-less slices pass). Slices with no scannable file are listed in
     the success line, not silently dropped.
   - Z4 (copy-named `.ts` not scannable) - unchanged, now over all slices.
4. **Rename the two analytics escapees** to `*.copy.ts` (+ their imports, the e2e
   comment, the test file) so their sentences are scanned.
5. **Docs**: header "WHAT THIS GATE DOES NOT CATCH #1" says all feature slices, still
   not `pages/` / `shared/` / `plugins/`.

## 4. Steps and acceptance

| # | File | Change | Acceptance |
|---|---|---|---|
| 1 | `scripts/check-ui-vocabulary.mjs` | replace `SCAN_ROOTS` by `discoverScanRoots()`; `EXEMPT_FEATURES`; global Z3 with floor; update header + success/failure output | script green on the tree; trial of a new slice with a banned word fails |
| 2 | same, `--self-check` | pure `selectScanRoots` / floor / exemption-typo cases; drop `owner`/`pending` assertions | `--self-check` green; each new rule has a case that fails when the rule is removed |
| 3 | `apps/web/src/features/analytics/lib/*` + importers + `apps/e2e/src/pages/analytics.page.ts` comment | rename the two `*-copy.lib.ts` (and `.test.ts`) to `*.copy.ts` | tsc + vitest green; the renamed modules are now scanned and clean (or any finding fixed) |
| 4 | `docs/lessons.md` (only if a mistake surfaces) | - | - |

## 5. Validation

- Architecture: no core/integration code touched. Naming: `*.copy.ts` is the
  documented convention (`docs/frontend-architecture.md`).
- Testing: script `--self-check`; real-tree run; manual red run by planting a banned
  word in a temporary new slice (then reverted).
- Risk: another open PR adding a `SCAN_ROOTS` entry will conflict with this rewrite.
  Mitigation: the rewrite removes the array, so such a PR only needs to drop its entry.
- Pre-implement gate (`/pre-implement`): skipped - single self-contained script, no
  port/service/DI token/barrel/DTO/ORM surface to collide with.

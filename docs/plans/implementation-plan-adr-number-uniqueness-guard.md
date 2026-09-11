# Implementation Plan: Enforce Unique ADR Numbers via `check:invariants`

**Issue**: #2082
**Type**: DX / tooling
**Layer**: N/A (repo scripts) — no core/domain/interface layer impact

---

## 1. Problem

ADR numbers are allocated by hand with nothing enforcing uniqueness. Two ADRs
claiming the same number have *different filenames*, so git merges both
cleanly with no conflict marker — each PR passes review in isolation and only
the *second* one to merge produces a silent duplicate in a record
`docs/architecture/adrs/README.md` describes as append-only.

This has already cost review time three times in two days (#2050 vs #2056 on
`040`; #2056's own reservation note pointing the next author at the wrong
number; #2066 colliding with three branches on `039`/`040`/`041`
simultaneously). Hand-written "reserved numbers" notes in the README don't fix
it — a note can't see a PR opened after it was written.

This mirrors the migration-timestamp collision (#374/#1013), which
`scripts/check-migration-timestamps.mjs` already guards with the same shape:
uniqueness, filename/body consistency, and a cross-branch-vs-`origin/main`
check.

## 2. Goal

Add `scripts/check-adr-numbers.mjs`, wired into `check:invariants` (and
therefore `pnpm lint` and the pre-commit hook), that makes an ADR-number
collision fail the build instead of silently merging.

## 3. Scope

- **New file**: `scripts/check-adr-numbers.mjs`
- **Changed**: root `package.json` `check:invariants` chain (append the new
  check, following the existing `--self-check` then real-run pairing)
- **Changed**: `docs/architecture/adrs/README.md` — point § Numbering at the
  guard instead of "check the index below", and retire the hand-written
  "Reserved numbers" footnote paragraph now that the guard supersedes it.
- No production code, no core/domain impact, no migration.

## 4. Design

Five assertions, evaluated over every `*.md` file directly under
`docs/architecture/adrs/` **except** `README.md` and `template.md`:

1. **Filename shape** — `NNN-kebab-case-title.md`, 3-digit zero-padded
   prefix (matches every current file, `001`–`071`, verified).
2. **Uniqueness (local)** — no two files in the working tree share a 3-digit
   prefix.
3. **Heading consistency** — the file's `# ADR-NNN: Title` first line must
   carry the same number as the filename prefix. Catches the half-rename
   where filename/heading/README/architecture-overview pointers/spec
   references get updated on one side only (the #2056 failure mode named in
   the issue).
4. **Not already taken on `origin/main`** — a file that is *new relative to
   `origin/main`* (i.e. its exact filename doesn't exist there) must not
   claim a number that a **different** filename already holds on
   `origin/main`. This is the assertion that actually catches the cross-PR
   collision, since it's only visible when compared against the trunk — the
   local-uniqueness check (2) can't see a sibling branch's file. Mirrors
   `check-migration-timestamps.mjs`'s ordering-check git-availability
   handling exactly:
   - `origin/main` resolvable → checked.
   - `git` present, `origin/main` ref missing → **notice** locally, **hard
     failure** under `CI=true` (the lint workflow already fetches
     `origin/main` after checkout for the migration check, so no workflow
     change is needed — same fetch step covers this).
   - `git` binary absent entirely → skipped even in CI (environment
     limitation, not a per-PR failure).
5. **README index bijection** — `docs/architecture/adrs/README.md`'s
   `## Index` table must have exactly one row per ADR file and no row
   without a matching file. Also checks a row's own `[ADR-NNN](./MMM-...)`
   link for an internal heading-vs-link-number mismatch. This is the
   "also worth including" ask from the issue — the index is what an author
   actually reads to pick the next number, and it has drifted from the file
   list twice already (confirmed clean today: 71 files, 71 rows).

Each rule is implemented as a pure, I/O-free validator function
(`validateEntries`, `validateAgainstBaseline`, `validateReadmeIndex`) taking
plain data and returning `{ ok, violations }`, mirroring
`check-migration-timestamps.mjs`'s structure exactly — this is what lets the
`--self-check` mode drive every rule (including the git-unavailable
degradation paths) against inline fixtures with no filesystem or git
dependency, matching the existing precedent's `--self-check` convention that
every other entry in the `check:invariants` chain already follows.

`git ls-tree -r --name-only origin/main -- docs/architecture/adrs` supplies
the baseline file list (no checkout needed), exactly as the migration guard
resolves its baseline.

### What deliberately mirrors the migration guard 1:1

- `resolveMissingBaselineAction({ isCi })` and `classifyBaselineError(error)`
  — identical logic, kept as separate small functions per file (not
  factored into a shared module) because `check-migration-timestamps.mjs`
  itself is self-contained with no shared helper module, and every other
  script in `check:invariants` follows that same one-file-per-check
  convention. Introducing a shared util module for two call sites would be
  a divergence from the established pattern, not a simplification.
- The exit/violation-reporting shape (`console.error` per line, then a
  count, then `process.exit(1)`).
- The `--self-check` / real-run split at the bottom of the file, with the
  same `process.argv.includes('--self-check')` gate.

### What's new relative to the migration guard

- Assertion 5 (README bijection) has no counterpart in the migration
  guard — migrations have no hand-maintained index to drift. This is a
  self-contained addition, not a divergence from the mirrored shape.
- Assertion 4's phrasing is "already claimed under a different filename" (a
  *collision* check) rather than the migration guard's "must sort after
  everything in the baseline" (an *ordering* check) — ADR numbers have no
  ordering requirement (unlike TypeORM migration execution order), only a
  uniqueness requirement. This is the correct mirror of "what does #1013 for
  migrations map to for ADRs" per the issue's own framing (issue says
  "unique" as assertion 1, not "ordered").

## 5. Verification performed during planning

Built the script against the current worktree and ran both modes:

```
$ node scripts/check-adr-numbers.mjs --self-check
adr-numbers: self-check OK

$ node scripts/check-adr-numbers.mjs
adr-numbers: OK (71 ADRs; uniqueness vs origin/main: checked)
```

Confirms AC "Passes clean against current `main`" and "Behaviour with
`origin/main` unavailable matches `check-migration-timestamps.mjs`" (verified
via the self-check's `expectAction`/`expectClass` fixtures, same as the
migration guard's own self-check).

Self-check fixtures directly exercise the three named failure shapes from
the issue:
- #2050/#2056 shape: two filenames, same number → `shares ADR number`.
- #2056 half-rename shape: filename/heading disagree →
  `filename number 042 ≠ heading number ADR-040`.
- #2066 shape: a new filename reusing a number already on `origin/main` under
  a different filename → `already claimed on origin/main`.
- README drift (both directions): file-with-no-row and row-with-no-file.

## 6. Remaining work to actually ship (not yet committed — plan only)

1. Move `scripts/check-adr-numbers.mjs` into the repo (done in this
   worktree, uncommitted).
2. Append to `check:invariants` in root `package.json`, following the
   existing pairing convention:
   `... && node scripts/check-adr-numbers.mjs --self-check && node scripts/check-adr-numbers.mjs`
   (append at the end of the existing chain, after the
   `check-css-structure.mjs` pair).
3. Edit `docs/architecture/adrs/README.md`:
   - § Numbering: change "check the index below" to reference
     `scripts/check-adr-numbers.mjs` (mirroring how § Numbering already
     could point to a mechanical guard, per the reversal-gate-marker
     precedent's own callout style for `check-architecture-gates.mjs`).
   - Retire the "Reserved numbers: ..." footnote paragraph under the index
     table (or trim it to note the guard now enforces this, dropping the
     per-PR hand-maintained claim list) — but only for numbers this guard
     will actually check going forward; leave the historical narrative if a
     future reader benefits from it, per author judgment at implementation
     time.
4. Run `pnpm lint` once wired in, to confirm the full `check:invariants`
   chain still passes end-to-end (not just this script standalone) and that
   package.json's shell chaining doesn't break on the append.
5. Add the acceptance-criteria checkboxes' items as committed test coverage
   — the self-check function above already covers every AC item that's
   testable in isolation; no additional `*.spec.ts`/`*.mjs` test file is
   needed since every other `check:invariants` script uses the same
   `--self-check` convention rather than a separate Jest file.

Per the user's instruction, no commit/push/PR/comment happens as part of
this planning task — the script and this plan exist only in this worktree,
uncommitted, ready for a follow-up implementation pass.

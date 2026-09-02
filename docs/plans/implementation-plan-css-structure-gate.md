# Implementation Plan: Structural CSS Parse Gate (`check-css-structure.mjs`)

**Date**: 2026-08-30
**Status**: Ready for Review
**Estimated Effort**: 3–4 hours
**Issue**: [#2674](https://github.com/openlinker-project/openlinker/issues/2674)
**Base branch**: `oms-programme-wave-2` (Wave-2 hygiene — PR targets that branch, not `main`)

---

## 1. Task Summary

**Objective**: add a structural check for every stylesheet in the repository to `pnpm check:invariants`, so an unbalanced brace, a stray `}` or an unclosed comment fails the build with a usable file:line location.

**Context**: nothing in the pipeline parses `apps/web/src/index.css` (21 029 lines). ESLint does not look at CSS, Vitest does not evaluate it, `tsc` has no view of it. A merge conflict resolution dropped the closing brace of `.stock-at-risk-callout__items` and passed `pnpm lint`, `pnpm type-check`, 4 142 `apps/web` tests and 130 integration suites. Under CSS nesting a missing closing brace does not error — it silently re-scopes every following rule as a descendant of the unclosed selector, so the stylesheet still loads, the build still succeeds, and an arbitrary number of later rules simply stop applying. A defect of this exact shape had already shipped in the preceding merge commit. Existing `who-decides-styles.test.ts`-style coverage cannot catch it: those assert a class *appears* in the file, and after a dropped brace it still does.

**Classification**: DX / Testing (a repository invariant guard). No runtime code, no CORE/Integration surface, no schema.

---

## 2. Scope & Non-Goals

### In Scope
- `scripts/check-css-structure.mjs` — a zero-dependency Node scanner with a `--self-check` mode, following the `check-nul-bytes.mjs` shape.
- Wiring into the root `check:invariants` chain (34 checks → 35).
- Coverage of **every** `.css` file found by a filesystem walk (today: `apps/web/src/index.css`, `.design-sync/fonts.css`).
- A documented out-of-scope list for stylesheet-bearing files the walk deliberately does not read.
- Red-first evidence per assertion.

### Out of Scope
- **Any edit to `apps/web/src/index.css`.** A sibling agent (#2388, the Wave-2 responsive audit) owns that file concurrently. If the new check finds a real defect, it is **reported with file and line**, never fixed here.
- **A real CSS parser (`postcss`).** See § 7 Alternative 1 — rejected on dependency and blast-radius grounds, with the acceptance criteria fully met without one.
- Semantic CSS validation (unknown properties, invalid values, unused selectors). The issue asks for *structural* damage detection; a linter is a different tool with a different failure budget.
- `<style>` blocks inside `docs/plans/**/*.html` mockups — see § 5.
- Formatting or style opinions (Prettier already owns those for files it is run against).

### Constraints
- Node 22. Zero new dependencies (see § 4).
- Must run identically in CI, where **`git` may be absent** — so a filesystem walk, never `git ls-files` (the constraint `check-nul-bytes.mjs` and `check-repo-urls.mjs` already document).
- Must not slow `pnpm lint` materially: the whole corpus is ~21 k lines / ~700 KB.

---

## 3. Architecture Mapping

**Target Layer**: none — repository tooling under `scripts/`, outside the hexagon. It imports no application code and is never imported by any.

**Capabilities Involved**: none.

**Existing Patterns Reused**:
- `scripts/check-nul-bytes.mjs` — the closest prior art and the structural template: a **pure scanner** + a **pure line locator**, both exported so `--self-check` can exercise them against synthetic input with no filesystem; a `SKIP_DIRS` filesystem walk with the "CI has no git" rationale in a comment; bounded read concurrency; one violation line per finding; `--self-check` dispatch at the bottom.
- `scripts/check-design-tokens.mjs` — the only existing script that reads `index.css` at all (by regex, for `--*` declarations). Establishes the path constant but **does not parse structure**, which is precisely the gap.
- The `--self-check` convention itself: 17 of the 34 chained checks ship one. It is how this repo institutionalises "verify by making it fail first" — the guard proves its own detection against synthetic defects on every run, so a refactor of the detection cannot silently pass.

**Core vs Integration Justification**: not applicable — no domain code. Placing it in `scripts/` beside the other 34 guards is the established location; a Vitest test inside `apps/web` was considered and rejected in § 7 Alternative 2.

---

## 4. External / Domain Research

### Why not `postcss`

`postcss` **is not installed anywhere in the workspace**. Verified:

```
node_modules/postcss/package.json                    → absent
root package.json  dependencies/devDependencies      → no postcss, no tailwind
apps/web package.json devDependencies                → @vitejs/plugin-react, @vitest/coverage-v8, vite, vitest
```

Vite bundles its own PostCSS internally, but it is not a declared dependency and is not resolvable from a root-level `scripts/*.mjs`. Adding it would mean a new root `devDependency` for one guard, and would additionally engage `scripts/check-workspace-dep-declarations.mjs` (which enforces both directions of the manifest/import relationship and **fired for real** on #2390). Every one of the 34 existing checks is zero-dependency by construction. See § 7 Alternative 1 for the full trade-off; the short version is that a hand-written scanner meets all three acceptance criteria and a parser adds a dependency to catch nothing extra within the stated scope.

### Corpus survey (the constructs the scanner must survive)

Measured against `apps/web/src/index.css` on this base (`a93b83c67`):

| Construct | Count | Consequence for the scanner |
|---|---|---|
| `{` / `}` | 3 230 / 3 230 | currently balanced (naive count) — the file has grown from the 3 063 quoted in the issue, because #2388 is editing it |
| `/* … */` comments | 688 / 688 | must be handled |
| **apostrophes inside comments** | 7+ (`badge's`, `doesn't`, `don't`, …) | **decisive** — see below |
| `content:` declarations | 165 | strings must be handled |
| `url(…)` | 14 | may contain unquoted characters |
| `@media` | 109 | brace-bearing at-rules, nest one level |
| `@keyframes` | 13 | brace-bearing, nest two levels |
| `@font-face` | 14 | brace-bearing |
| CSS nesting (`&`) | 0 today | irrelevant to the fix — a dropped brace re-scopes under plain descendant semantics regardless |

**The apostrophe finding is the load-bearing one.** A scanner that checks string state *before* comment state reads `badge's own tone dot` (inside a `/* … */` block) as opening a single-quoted string that never closes, then treats every subsequent `{`/`}` as string content and reports the whole file as unbalanced — a **false positive on the exact file the guard exists to protect**, which would be discovered as "the new check is broken" and disabled. Correct precedence is therefore mandatory and is an explicit assertion:

- **Inside a comment**, nothing else is special (no strings, no braces).
- **Inside a string**, comments are not special (`/*` inside `content: "/*"` opens nothing).
- Backslash escapes are honoured **inside strings only**.
- Strings do not span newlines in CSS — an unterminated string is closed at the newline and reported, rather than swallowing the rest of the file.

### Other stylesheets

A filesystem walk of the repo (excluding `node_modules`, `dist`, build output) finds exactly two `.css` files: `apps/web/src/index.css` and `.design-sync/fonts.css`. Both are covered by the walk, satisfying acceptance criterion 3 for real files rather than by a hardcoded list.

---

## 5. Questions & Assumptions

### Assumptions
- **`.scss` / `.sass` / `.less` are matched by the walk though none exist today.** Cheap, and means a future preprocessor file is covered on arrival rather than silently uncovered. The scanner's brace/comment/string model is valid for SCSS syntax; `//` line comments are additionally handled so a future `.scss` cannot produce a false positive.
- **The check runs over the working tree, not a diff.** Consistent with every sibling guard, and correct: the defect being prevented arrives via merge resolution, where a diff-scoped check is exactly what fails to see it.
- **A finding is reported once per file, at the first location that proves the defect**, plus the unmatched-open location where applicable. Reporting all 3 000 subsequent brace positions would bury the actionable line.

### Open Questions (answered with a stated default, none blocking)
- *Should `docs/plans/**/*.html` mockup `<style>` blocks be parsed?* **No — out of scope, with reason.** Ten mockup files carry `<style>` blocks. They are design artifacts, not shipped code: nothing imports them, no build compiles them, and a structural defect in one degrades a reference document rather than the product. Extracting CSS from HTML also needs an HTML parser, which reintroduces the dependency question for zero product risk. Recorded here so the exclusion is a decision, not an oversight (acceptance criterion 3 requires it be *listed with a reason*).
- *Should the check also fail on a missing final newline / tabs / etc.?* No. Scope creep into formatting; Prettier's domain.

### Documentation Gaps
- `docs/frontend-architecture.md` § *Design tokens* documents `check-design-tokens.mjs` as the guard over `index.css`. It should gain a sentence pointing at the new structural guard, so the next reader does not conclude the token check is the only thing watching that file.

---

## 6. Proposed Implementation Plan

### Phase 1 — The pure scanner

**Goal**: a dependency-free function that, given CSS source text, returns every structural defect with a 1-based line and column.

1. **Create `scripts/check-css-structure.mjs` with the pure core**
   - **File**: `scripts/check-css-structure.mjs`
   - **Action**: implement and export `scanCssStructure(source)` returning `CssDefect[]`, each `{ kind, line, column, detail }`. One single-pass character walk holding exactly one state: `code | comment | lineComment | singleString | doubleString`. A brace is counted **only** in `code` state. Precedence is comment-first, then string, per § 4. Track an explicit stack of open-brace `{line, column}` so an unclosed block reports **where it opened**, not merely that a count differs.
   - **Defect kinds** (a closed vocabulary, `as const`-style):
     - `unclosed-block` — EOF with a non-empty stack; reports the **innermost unclosed open brace's** line/column.
     - `unexpected-close` — a `}` with an empty stack; reports its own line/column.
     - `unclosed-comment` — EOF inside `/* …`; reports the opener.
     - `unterminated-string` — a newline inside a quoted string; reports the opener.
   - **Acceptance**: exported, pure (no I/O, no `process`, no mutation of input), returns `[]` for well-formed input.
   - **Dependencies**: none.

2. **Export the locator alongside it**
   - **Action**: line/column are accumulated during the single walk (incrementing on `\n`, resetting column), not recomputed by a second scan. `check-nul-bytes.mjs` recomputes because a NUL-bearing buffer is not reliably decodable; here the source is text and a second pass is pure waste.
   - **Acceptance**: a defect on line 1 reports `line: 1`; a defect after two newlines reports `line: 3`. `\r\n` counts once.

### Phase 2 — The walk and the reporting

3. **Add the filesystem walk**
   - **Action**: reuse `check-nul-bytes.mjs`'s `SKIP_DIRS` set and `walk` generator verbatim in shape (`.git`, `.claude`, `node_modules`, `dist`, `build`, `coverage`, `.next`, `.vite`, `.turbo`, `.cache`, `.pnpm-store`, `.husky`), matching `STYLESHEET_EXTENSIONS = {.css, .scss, .sass, .less}`. Carry the same comment explaining the fs-over-git choice.
   - **Acceptance**: on this base the walk yields exactly `apps/web/src/index.css` and `.design-sync/fonts.css`.

4. **Add the empty-corpus hard failure** ← *the #2673 defence*
   - **Action**: if the walk yields **zero** stylesheets, `console.error` and `process.exit(1)` with a message saying the guard found nothing to check and is therefore not guarding anything. Additionally assert that `apps/web/src/index.css` is **among** the files found, and fail naming it if not.
   - **Rationale**: this repo has shipped a guard that silently degraded to a no-op — #2673, a mirror keyed on a declaration name that was renamed, where "not found" and "pending" were indistinguishable so it reported green over a live divergence. A walk that stops matching (an extension rename, a `SKIP_DIRS` entry that grows to cover `apps/`, a future move of `index.css`) must be **loud**, not vacuously green. The named-file assertion is the stronger half: a generic "found ≥1 file" check would still pass if `index.css` moved and only `fonts.css` remained.
   - **Acceptance**: temporarily narrowing `STYLESHEET_EXTENSIONS` to `.nonexistent` exits 1 with the "no stylesheets" message; temporarily pointing `REQUIRED_STYLESHEETS` at a missing path exits 1 naming it.

5. **Report findings**
   - **Action**: one line per defect — `  {relative/path}:{line}:{column} — {human sentence}`. The sentence names the fix, following the house style of the existing guards (`check-nul-bytes` says *"Write \\0 instead; git treats a NUL-bearing file as binary"*). For `unclosed-block`: *"block opened here is never closed. Under CSS nesting this does not error — it silently re-scopes every following rule as a descendant."* Success prints `✓ check-css-structure: N stylesheets parse cleanly (M rules).`
   - **Acceptance**: a seeded defect prints a path, a line, a column and a sentence; exit code 1.

### Phase 3 — Self-check and wiring

6. **Implement `--self-check`**
   - **Action**: exercise `scanCssStructure` against synthetic sources covering each defect kind **and** each false-positive trap, in the `check-nul-bytes.mjs` `expect(label, actual, expected)` style. Minimum table:

     | Case | Expect |
     |---|---|
     | `.a { color: red; }` | no defects |
     | `.a { color: red;` | `unclosed-block` at 1:4 |
     | `.a { } }` | `unexpected-close` |
     | `/* unclosed` | `unclosed-comment` |
     | `/* it doesn't { */ .a { }` | **no defects** ← the apostrophe-in-comment trap |
     | `.a { content: "}"; }` | **no defects** ← brace in string |
     | `.a { content: "/*"; }` | **no defects** ← comment opener in string |
     | `.a { content: "\\""; }` | **no defects** ← escaped quote |
     | `.a { content: "oops` | `unterminated-string` |
     | `@media (x) { .a { } }` | no defects |
     | `@media (x) { .a { }` | `unclosed-block` at the `@media` |
     | `// scss comment {` then `.a{}` | no defects |
     | empty string | no defects |

   - **Acceptance**: `node scripts/check-css-structure.mjs --self-check` exits 0 and prints the `✓ … --self-check` line; mutating any single scanner branch makes it exit 1.

7. **Wire into `check:invariants`**
   - **File**: `package.json`
   - **Action**: append `&& node scripts/check-css-structure.mjs --self-check && node scripts/check-css-structure.mjs` to the chain, following the `--self-check`-then-run convention every guarded sibling uses.
   - **Acceptance**: `pnpm check:invariants` runs 35 checks (34 → 35) and exits 0.

8. **Document it**
   - **Files**: `docs/frontend-architecture.md` (§ Design tokens — one sentence noting the structural guard beside the token guard), `docs/lessons.md` (the generalisable half already recorded by body B; add the guard's name so the lesson points at its remedy).
   - **Acceptance**: a reader of the token-drift paragraph learns `index.css` is also structurally parsed.

### Phase 4 — Red-first verification (mandatory, per the issue)

9. **Prove each assertion fails first**
   - **Action**: for each of the four defect kinds, seed the defect in a **scratch copy** of `index.css` outside the worktree (`$SCRATCH/index-defect.css`), run the scanner against it, and record the exact output line. **`apps/web/src/index.css` is never edited** — #2388 owns it. Additionally run the two subject-less mutations from step 4.
   - **Beware a red for the wrong reason**: a sibling's first removal test went red on an unused-import `TS6133` with `Tests: 0 total`, which would have been a false pass. Each red must be verified to be *the scanner reporting the seeded defect at the seeded line*, not a crash, not a different file, not a zero-case run. Record the asserted line number alongside the seeded line number and confirm they match.
   - **Acceptance**: a table in the PR body, one row per assertion: what was seeded, where, what the check printed, exit code.

---

## 7. Alternatives Considered

### Alternative 1 — Run a real CSS parser (`postcss`) in `check:invariants`
The issue names this as "better". Rejected, with the reasoning recorded because the suggestion is reasonable and will be raised again:
- **It is not installed.** Not at root, not in `apps/web`, not transitively resolvable from a root script. Adding it means a new root `devDependency` whose only consumer is this guard, plus engagement with `check-workspace-dep-declarations.mjs`.
- **It catches nothing extra within the stated scope.** All three acceptance criteria are unbalanced blocks, stray `}` and unclosed comments — every one of which is decided by the same lexical state machine a parser runs before it builds an AST. A parser additionally rejects things this file may legitimately contain, converting a green build into a fight about valid-but-unusual CSS.
- **It contradicts the established pattern.** All 34 existing checks are zero-dependency `.mjs`. A single dependency-bearing guard is a maintenance outlier and a supply-chain surface for a build-blocking script.
- **Reversibility**: the pure `scanCssStructure` seam means swapping in a parser later is a one-function change with the `--self-check` table as its regression suite. If a semantic need appears, the swap is cheap.

### Alternative 2 — A Vitest test inside `apps/web`
Rejected: it would run only under `pnpm test`, not `pnpm lint`, so it would not gate the pre-commit hook the way the other invariants do; and it would cover only `apps/web`, missing `.design-sync/fonts.css` and any future stylesheet elsewhere. The issue explicitly asks for `check:invariants`.

### Alternative 3 — Brace-count-only (the issue's stated minimum)
Rejected as the *whole* design, though it is the floor the issue accepts. A bare count reports "unbalanced" with no location, failing acceptance criterion 2, and — decisively — **a dropped brace plus a stray one still counts equal**, so the count is green over two real defects. It also cannot see an unclosed comment at all. The stack-based scanner is barely more code and is strictly stronger.

### Alternative 4 — Hardcode `apps/web/src/index.css` as the only input
Rejected: it fails acceptance criterion 3, and it is the exact shape of the #2673 silent no-op — a guard keyed on a name, which reports green forever the day the name changes. The walk plus a *named required file* assertion gets both breadth and loudness.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No hexagon layer touched; no CORE/Integration boundary involved.
- ✅ No `any`, no `console.log` in application code (a `scripts/*.mjs` guard writes to `console.error`/`console.log` by design, as all 34 siblings do — the shared `Logger` is not available or appropriate outside the apps).

### Naming Conventions
- ✅ `scripts/check-{subject}.mjs` matches all 34 siblings.
- ✅ `UPPER_SNAKE_CASE` module constants; `camelCase` functions.

### Existing Patterns
- ✅ Pure-core + `--self-check` + fs-walk, all three lifted from `check-nul-bytes.mjs`.

### Risks

| Risk | Mitigation |
|---|---|
| **False positive on the live `index.css`** — the worst outcome, because it makes the guard look broken and invites disabling it. Concretely: the apostrophe-in-comment trap. | Comment-before-string precedence is asserted in `--self-check` with a real-shaped case, and the guard is run against the actual 21 k-line file before commit. |
| **`index.css` moves under me** — #2388 is editing it concurrently. | The guard reads by walk, not by pinned content, so ordinary edits cannot break it. Rebase before the PR and re-run. The one coupling is the `REQUIRED_STYLESHEETS` path assertion, which fails **loudly** if the file moves — the intended behaviour. |
| **The guard finds a real pre-existing defect.** | Report to the coordinator with file and line. Do not fix — #2388 owns the file. If it blocks the gate, report and await routing rather than editing. |
| **A future preprocessor file uses syntax the scanner mismodels.** | `.scss`/`.less` are matched and `//` comments handled; anything beyond that surfaces as a false positive on arrival, at which point the `--self-check` table is the place to encode the new rule. |
| **Performance.** | ~700 KB across two files, one pass, bounded concurrency. Immeasurable against a lint run that already takes minutes. |

### Edge Cases
- **Empty file** → no defects (vacuously well-formed), but it still counts toward the corpus so the "no stylesheets" guard is not tripped.
- **`\r\n` line endings** → counted as one line break.
- **A brace inside `url(...)` unquoted** → `url(` content is not a CSS string; a literal `{` there would be invalid CSS anyway. Accepted: the scanner counts it, which would report a defect on genuinely malformed input. No occurrence in the corpus (14 `url(` uses, all font/asset paths).
- **Nested `/* /* */`** → CSS comments do not nest; the first `*/` closes. Modelled correctly.

### Backward Compatibility
- ✅ No runtime behaviour changes. The only way this changes anything is by failing a build that was previously, wrongly, green.

---

## 9. Testing Strategy & Acceptance Criteria

### Self-check (the primary suite)
`node scripts/check-css-structure.mjs --self-check` — the case table in step 6, run on every `pnpm lint`. (Deliberately not stated as a count: the table grew during implementation, and a number in prose goes stale.) This *is* the unit-test layer for a `scripts/` guard; the repo has no Jest project covering `scripts/`, and all 17 self-check-bearing siblings use exactly this mechanism.

### Live-corpus run
`node scripts/check-css-structure.mjs` against the real working tree — proves the guard is green on a healthy repo and that the walk finds real files.

### Red-first evidence
Per step 9: four seeded defect kinds + two subject-less mutations, each with seeded location, reported location, and exit code recorded.

### Acceptance Criteria
- [ ] An unbalanced brace in `apps/web/src/index.css` fails `pnpm check:invariants`, demonstrated by making it fail first (in a scratch copy — the real file is not edited).
- [ ] The check reports a usable location — file, line, and column — not just "unbalanced".
- [ ] Every other stylesheet in the repo is covered (`.design-sync/fonts.css`) or explicitly listed as out of scope with a reason (`docs/plans/**/*.html` `<style>` blocks).
- [ ] A subject-less run (zero stylesheets found, or `index.css` absent from the corpus) is a **hard failure**, not a silent pass — proven by mutation.
- [ ] `pnpm check:invariants` reports 35 checks and exits 0.
- [ ] `pnpm lint`, `pnpm type-check`, `pnpm test`, `pnpm test:integration` all green.
- [ ] No modification to `apps/web/src/index.css`.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture — n/a, tooling outside the hexagon, imports no application code
- [x] Respects CORE vs Integration boundaries — untouched
- [x] Uses existing patterns (no unnecessary abstractions) — `check-nul-bytes.mjs` shape, `--self-check` convention
- [x] Idempotency considered — the check is a pure read, repeatable
- [x] Event-driven patterns — n/a
- [x] Rate limits & retries — n/a
- [x] Error handling comprehensive — unreadable file skipped (as `check-nul-bytes` does), fatal error caught and exits 1, empty corpus is a hard failure
- [x] Testing strategy complete — self-check table + live run + red-first evidence
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan saved as markdown

---

## Related Documentation

- [Engineering Standards](../engineering-standards.md)
- [Architecture Overview](../architecture-overview.md)
- [Testing Guide](../testing-guide.md)
- `scripts/check-nul-bytes.mjs` — the structural template
- `scripts/check-design-tokens.mjs` — the other `index.css` reader (regex, non-structural)

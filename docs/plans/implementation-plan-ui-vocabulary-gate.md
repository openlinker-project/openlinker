# Implementation Plan: `check-ui-vocabulary.mjs` — the OMS UI vocabulary gate (#2384)

**Date**: 2026-08-25
**Status**: Ready for Review
**Estimated Effort**: ~4 hours
**Issue**: [#2384](https://github.com/openlinker-project/openlinker/issues/2384) (`W2-46a`, Wave 2, stream S3)
**Epic**: [#2389](https://github.com/openlinker-project/openlinker/issues/2389)
**Design of record**: design rule P9; Wave-2 product spec §2.1

---

## 1. Task Summary

**Objective**: ship `scripts/check-ui-vocabulary.mjs`, wired into `pnpm check:invariants`, which fails
the build when any of nine banned model-internal terms appears in operator-facing copy under the three
Wave-2 feature folders — and which is itself mirror-checked against the spec table that defines the nine.

**Context**: design rule P9 ("no model-internal vocabulary in user-facing copy") is aspirational until
something fails the build on it. It constrains *every* Wave-2 surface, which is why the issue is
scheduled first in the wave: the gate must exist before the copy it governs is written. The Wave-2 spec
§2.1 states the rule as binding and names this script as its enforcement.

**Classification**: DX / Tooling. No runtime code, no layer, no port. The hexagonal-architecture
sections of the plan template are answered "not applicable" honestly rather than padded.

---

## 2. Scope & Non-Goals

### In scope

- `scripts/check-ui-vocabulary.mjs` — two independent rules (mirror + scan), `--self-check` mode.
- One fence added around the spec §2.1 banned-term table so the parser never guesses which table it owns.
- Two lines in `package.json`'s `check:invariants` chain (self-check, then the real run), matching every sibling.

### Out of scope

- Building any of the three feature folders. They do not exist yet; this gate ships **before** them,
  which is the entire scheduling rationale.
- The responsive audit (#2388 / `W2-46b`), deliberately split from this issue because the two halves
  have opposite scheduling constraints.
- Widening the scan to `pages/`, `shared/ui/`, or other features. §2.1 scopes the rule to three folders.
- Any judgement about copy *quality*. This gate is a floor, not a copy review — see §5 Coverage.
- The `.eslintrc.js` `no-restricted-imports` slug groups the issue mentions. Verified absent today
  (`grep` finds no `fulfillment-authority` / `automation` / `returns` group); they land with the feature
  issues that create those barrels, per `frontend-architecture.md § Feature Public Surface`. This gate
  does not create them, and deliberately does not cross-check against them yet — see §5 Open Questions.

### Constraints

- Zero dependencies, plain `.mjs`, textual parsing only — every sibling in `scripts/` holds this line.
- Must not fail today, when all three scan roots are absent, **and** must not silently pass forever.

---

## 3. The design question, settled

A vocabulary gate can be an **allow/deny list over copy** or a **mirror between a canonical module and
its consumers**. The issue and spec call for **both**, as two independent rules in one script, and
neither alone satisfies the acceptance criteria:

| | Rule A — mirror | Rule B — scan |
|---|---|---|
| Question | "is the script's banned list still the spec's list?" | "does any shipped string contain a banned term?" |
| Sides | `BANNED_TERMS` in the script ↔ fenced §2.1 table | script ↔ `apps/web` source |
| Satisfies AC | "banned list is exactly the nine terms … mirror check fails when either side gains or loses a term" | "introducing 'authority' into a rendered string fails `pnpm check:invariants`" |

**Why not a mirror to a code module instead of to the spec.** The obvious repo-native shape would be an
`as const` array in `libs/core` mirrored into the script, like `AuthorityKindValues`. Rejected: the nine
terms are not a domain vocabulary the runtime consumes — they are a *prohibition* on rendering, and
`libs/core` has no reason to hold a list of words the frontend must not print. Worse, the terms are drawn
from *several* contexts (`authority`, `FulfillmentWork`, `atpEffect`, `Orchestrator`, `Gateway`), so no
single module owns them. The spec table is the genuine source of record, and §2.1 says so explicitly
("this table and the script are one list, mirror-checked against each other").

**A fence is added to the spec table.** `docs/capabilities.md` sets the precedent
(`<!-- authority-kinds:start -->`), and the reasoning transfers verbatim: §2.1 contains **two** markdown
tables (the "renders as" translation table and the nine-term banned table), so an unfenced parser would
have to guess, and would silently pick the wrong one the moment either is reordered. The fence is one
comment line on each side and makes ownership explicit.

**The `Matched as` column is mirrored too, not just the term.** Half the nine terms carry a non-obvious
match mode (`FulfillmentWork` also matches the spaced *"fulfillment work"*; `atpEffect` also matches
*"ATP"*; `AvailabilityAuthority` is exact-only). Mirroring the term alone would let the spec say
"case-insensitive word match" while the script quietly did exact — the list would agree and the *rule*
would have drifted, which is the failure this gate exists to make impossible.

---

## 4. "Matched nothing" — three distinct zero-cases

The repo has been bitten by checks that pass because they matched nothing. Here every zero is classified,
and only one of the three is a pass:

| Zero-case | Today? | Verdict | Rationale |
|---|---|---|---|
| **Z1** — the fenced spec table parses to zero terms | no | **FATAL** | the parser or the fence broke; a gate with an empty deny-list is a gate that cannot fire |
| **Z2** — a declared scan root does not exist | **yes, all three** | **informational note, exit 0** | the folder ships in a later Wave-2 issue; this is the `check-authority-kind-mirror` `PENDING_MIRRORS` idiom, reused rather than reinvented |
| **Z3** — a scan root exists but yields zero scannable files | no | **FAIL** | a feature folder with no `.tsx` and no `*.copy.ts` means the extension logic or the walk broke; passing here would be the silent-nothing trap |

**Z2 carries the typo guard.** An absent path is a pass, so a misspelt declared path would pass *forever* —
exactly the hazard `check-authority-kind-mirror` records under its `#2441 review S-6` comment. The same
mitigation applies: assert the **parent** directory (`apps/web/src/features`) exists. A typo in a feature
slug is then caught immediately, while the slug itself is legitimately allowed to be absent.

**Z2 also names its owning issue**, so the note printed on every run reads as a declared gap with a
retirement plan rather than as noise: `fulfillment-authority — pending W2-8 (#2335)`, etc.

The three pending entries are retired by hand as each folder lands. That is deliberate: an automatic
retirement would need the script to decide a folder is "done", which it cannot know.

---

## 5. Coverage — what the gate does NOT catch

Stated prominently, and repeated in the script header, because an overstated gate is worse than none:
reviewers stop reading copy when they believe a script already did.

1. **Only three folders.** Copy in `pages/`, `shared/ui/`, or any other feature is unscanned. A Wave-2
   surface that puts operator copy in a shared primitive escapes entirely.
2. **Only literal strings.** A banned term assembled at runtime (`` `${noun} authority` ``, a
   concatenation, a value from a lookup keyed elsewhere) is invisible. The gate reads source text, not
   rendered output.
3. **Backend-sourced copy is out of reach.** A message the API returns and the UI renders verbatim can
   carry any of the nine terms; nothing here sees it.
4. **Identifiers, comments, imports and props are deliberately unscanned.** P9 bans the vocabulary from
   *rendering*, not from existing — §2.1's own words are "the domain vocabulary stays in the code". A
   variable named `authorityKind` is correct and must stay lint-clean.
5. **It cannot judge permitted words.** "Decided by" being clearer than "owner" is a copy-review question.
   The gate proves only that nine specific words are absent.

Consequently the acceptance line in the spec ("no banned vocabulary word appears in any shipped string;
the lint gate proves it") is true only for literal strings in the three folders. The script header says so.

---

## 6. Detection design

### Rule A — mirror

- Parse `BANNED_TERMS` from the script's own module (it is the script's own constant — compared in-process,
  no parsing needed) against the fenced §2.1 table parsed textually.
- Compare **as a set of `(term, matchMode)` pairs, order-independent**. This deviates from
  `check-authority-kind-mirror`, which is order-sensitive, and the deviation is deliberate: an
  `as const` array's order is load-bearing for a runtime vocabulary, whereas the numbering of a prose
  table is presentational. Failing a build because a doc table was alphabetised would train people to
  distrust the gate. Membership and match mode are what carry meaning.
- Report asymmetric differences by name (`in the spec but MISSING from the script`, and the converse),
  plus per-term match-mode disagreement.

### Rule B — scan

**Which files.** Under each existing scan root, recursively: every `.tsx`, and every `*.copy.ts`.
(`.ts` generally is excluded — that is where the vocabulary legitimately lives.)

**Which text, per file kind:**

- **`*.copy.ts`** — *every* string literal (single, double, template). The file's entire purpose is
  operator copy, so the heuristic is "all of it", which is both simpler and stricter than any parse.
- **`.tsx`** — two sources: JSX text nodes (text between `>` and `<` outside of an expression), and
  string-literal values of a small, named allow-list of user-facing JSX attributes
  (`title`, `label`, `placeholder`, `aria-label`, `alt`, `description`, `heading`, `emptyMessage`, …).
  Attribute-scoped rather than all-literals-in-a-tsx, because a `.tsx` also legitimately contains
  `useQuery(['authority'])`, `className="authority-row"`, and imports.

This is a heuristic, as the issue's Assumptions section already concedes. It is tuned to under-report in
the identifier direction and over-report nowhere structurally, and false positives are silenced by
**named file exemption with a reason** — never by weakening a term's match mode, per AC.

**Match modes** (mirrored from the table):

- `word` — case-insensitive, `\b`-delimited whole word.
- `exact` — case-sensitive, substring (these are `PascalCase` / `camelCase` identifiers; a case-insensitive
  word match on `AvailabilityAuthority` would be redundant with `authority` anyway).
- `word` + additional spaced alternate — for `FulfillmentWork` (+ `fulfillment work`) and `atpEffect` (+ `ATP`).
  `ATP` is matched **case-sensitively as a whole word**, so the common English word "atp" (there is none)
  and, more importantly, substrings inside longer words are not flagged.

**Report shape**: `file:line — term 'authority' (word match) in "…the authority that decides…"`, so a
developer can fix it without re-running anything.

### Exemptions

`const EXEMPTIONS = new Map([[relPath, reason], …])` — by file, with a prose reason, per AC. Empty at
ship time (there is nothing to exempt yet). `--self-check` asserts the structure is a file→reason map and
that no entry's reason is blank, so an exemption can never be added without stating why.

---

## 7. Implementation steps

### Phase 1 — make the spec parseable

1. **Fence the §2.1 banned-term table.**
   - **File**: `docs/specs/product-spec-oms-wave2-operator-experience.md`
   - **Action**: wrap the nine-row table in `<!-- ui-vocabulary:start -->` / `<!-- ui-vocabulary:end -->`.
     Add one sentence naming the script as the fence's consumer.
   - **Acceptance**: the fence brackets exactly the nine-term table, not the "renders as" table above it.

### Phase 2 — the script

2. **Write `scripts/check-ui-vocabulary.mjs`.**
   - **File**: `scripts/check-ui-vocabulary.mjs` (new)
   - **Action**: header docblock stating both rules, the three zero-cases, and §5's coverage limits
     verbatim. Exported pure functions: `parseSpecTable`, `diffBannedTerms`, `extractCopyStrings`,
     `extractTsxStrings`, `findBannedTerms`. A `main()` that runs Rule A then Rule B and aggregates.
   - **Acceptance**: `node scripts/check-ui-vocabulary.mjs` exits 0 and prints an OK line naming
     **nine terms compared** and **three pending scan roots**.

3. **Write `--self-check`.**
   - **Action**: exercise every pure function against synthetic inputs, including deliberately drifted
     fixtures that MUST fail — a term dropped from the spec side, a term added, a match-mode disagreement,
     a spec table that parses to zero rows (Z1), an existing-but-empty scan root (Z3), a `.tsx` whose only
     `authority` is an identifier (must NOT flag), a `.tsx` with `authority` in JSX text (must flag), a
     `*.copy.ts` string (must flag), and the exemption-shape assertions.
   - **Acceptance**: `--self-check` exits 0 and prints a one-line confirmation; each drifted fixture is
     asserted to be **not ok**, so the check proves it can fail, not merely that it can pass.

### Phase 3 — wire it in

4. **Chain into `check:invariants`.**
   - **File**: `package.json`
   - **Action**: append `&& node scripts/check-ui-vocabulary.mjs --self-check && node scripts/check-ui-vocabulary.mjs`
     at the end of the chain, matching every sibling's self-check-then-run pairing.
   - **Acceptance**: `pnpm check:invariants` passes with the new step visible in its output.

### Phase 4 — verify the gate actually bites

5. **Manual negative test.** Temporarily create
   `apps/web/src/features/returns/components/x.tsx` containing `<p>who has authority</p>`; confirm
   `pnpm check:invariants` **fails** naming the file, line and term; delete it. This is the issue's
   first AC and is verified by hand because the repo has no fixture-tree convention for `scripts/`.

---

## 8. Alternatives considered

**A. ESLint rule instead of a standalone script.** Rejected: the mirror half has no ESLint expression
(ESLint cannot assert a markdown table matches a rule's config), so it would split one invariant across
two mechanisms. The `scripts/` family is also where every comparable repo invariant already lives.

**B. Mirror to an `as const` in `libs/core`.** Rejected in §3 — the terms are a rendering prohibition,
not a runtime vocabulary, and span several contexts, so no module legitimately owns them.

**C. Scan all of `apps/web`.** Rejected: §2.1 scopes the rule to three folders, and the pre-existing app
certainly contains `phase`, `gateway` and `authority` in shipped copy today. A gate that fails on merge
day gets disabled on merge day. Widening is a deliberate follow-up once Wave 2's surfaces exist.

**D. Full TypeScript/JSX parse (via a parser dependency).** Rejected: every script in `scripts/` is
zero-dependency by convention, and the heuristic's residual error is handled by named exemptions.

---

## 9. Validation & risks

- **Naming**: `check-ui-vocabulary.mjs` — the exact name the issue and §2.1 both specify.
- **Pattern consistency**: `--self-check` mode, exported pure parsers, textual parsing, precise OK line,
  failure naming file + reason, `Promise.resolve(main()).catch(...)` fatal handler. Matches siblings.
- **Risk — heuristic false positives.** Mitigated by named-file exemptions and by the attribute allow-list
  (not all `.tsx` literals). Accepted and documented in the header.
- **Risk — heuristic false negatives.** The larger risk, and §5 is the mitigation: state the coverage
  boundary loudly so reviewers keep reading copy.
- **Risk — the gate reads green forever if all three folders are renamed.** Mitigated by the Z2 parent-
  directory typo guard and by the per-run pending note naming each owning issue.
- **Backward compatibility**: none needed. New script, additive `check:invariants` entry, one fence in a
  spec doc. Nothing existing changes behaviour.

---

## 10. Testing strategy & acceptance criteria

`scripts/` has no Jest suite; `--self-check` is the repo's established test mechanism for this family,
and it is held to the same bar (each drifted fixture asserted **not ok**).

- [ ] Introducing `"authority"` into a rendered string fails `pnpm check:invariants` (Phase 4 manual test)
- [ ] The banned list is exactly the nine §2.1 terms, in the same match modes; the mirror fails when
      either side gains, loses, or re-modes a term
- [ ] The banned-term list is a closed, enumerated array — no open-ended clause
- [ ] Exemptions are by file with a reason, not by pattern; `--self-check` asserts the shape
- [ ] `--self-check` passes, and fails on every deliberately drifted fixture
- [ ] All three zero-cases behave per §4 (Z1 fatal, Z2 note+0, Z3 fail)
- [ ] `pnpm lint`, `pnpm type-check`, `pnpm test`, `pnpm check:invariants` green

---

## 11. Questions & assumptions

**Open questions (non-blocking, recorded for the wave):**

- §2.1 cites the script as "§7.5"; the spec has no §7.5. Dangling cross-reference, not chased here.
- The issue asserts the three slugs "appear in both `.eslintrc.js` `no-restricted-imports` pattern
  groups". They do not yet. Once they do, a fourth mirror (script scan roots ↔ eslint slug groups) becomes
  possible and would be worth it — filed as a note for the wave, not built now against absent lists.

**Assumptions:**

- Feature folder slugs are `fulfillment-authority`, `automation` (singular), `returns`, per #2335/#2354/#2364.
- `*.copy.ts` is the settled name for a copy module. No such file exists yet anywhere in the repo, so the
  convention is being established by the Wave-2 issues; the scan also covers `.tsx` so a surface that never
  adopts `*.copy.ts` is still partially covered.

---

## 12. What Wave-2 FE issues must do to adopt this

1. Put operator-facing copy for the three features either in JSX text or in a `<feature>/lib/*.copy.ts`.
2. When a folder lands, **remove its `PENDING_SCAN_ROOTS` entry** — the run prints the note naming the
   owning issue as the reminder, and Z3 then guarantees the folder is really being scanned.
3. Never silence a hit by rewording the match mode. Silence it by a named file exemption with a reason,
   or — far preferably — by fixing the copy, which is the point.
4. A tenth banned term is an edit to §2.1's fenced table **and** to `BANNED_TERMS` in the same commit.

---

## Related documentation

- `docs/specs/product-spec-oms-wave2-operator-experience.md` §2.1
- `docs/engineering-standards.md`
- `scripts/check-authority-kind-mirror.mjs` (pending-mirror idiom), `scripts/check-stream-writes.mjs` (tree-scan idiom)

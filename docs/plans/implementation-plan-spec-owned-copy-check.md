# Implementation plan: hold spec-owned operator copy against its spec (#2795)

## 1. Understand

**Goal.** A new `check:invariants` step that fails when an operator-facing string,
which a spec declares itself the canonical owner of, differs from the code that
renders it - or when the check cannot locate either side.

**Layer.** DX / tooling. A zero-dependency `scripts/*.mjs` guard, like the ~40
`check-*-mirror.mjs` siblings. No runtime code, no schema, no backend.

**Why.** The mirror family holds code against code. `check-attention-reason-mirror`
M6 held two code copies of `This return is not matched to an order` identical while
both disagreed with the spec's trailing period (#2673). A code-to-code mirror can
only prove two halves are equally wrong.

**Non-goals.**
- Not all copy. Only strings a spec explicitly claims ownership of: returns spec
  § 5.4 (`restock_blocked`) and § 5.5 (orphan return) say *"canonical copy source"*.
- Not sentences with placeholders (`{connection name}`, `{n}`, `{sku}`). The code
  splits those into fragments (`bodyPrefix` / `bodySuffix`) that are interpolated at
  render time, so the spec's sentence does not exist in code as one value. Comparing
  fragments would need a prose matcher and a normalisation policy; that is a
  separate decision, recorded as a known gap.
- Not whether a sentence is good (that is `check-ui-vocabulary`).
- Editing specs or copy to make them agree beyond what the check finds.

## 2. Research (what we reuse)

- Pattern: `scripts/check-attention-reason-mirror.mjs` - textual parsing (no TS
  import), `--self-check` fixtures, pure decision functions, "matched nothing is a
  FAILURE" (#2384), no pending mode (#2673).
- Wiring: `package.json` `check:invariants`, next to the attention-reason mirror
  (`--self-check` first, then the live run).
- Owned strings found in the specs' canonical sections:
  - § 5.4: `**Stock was not added.**`, `` `Restock blocked` `` (badge),
    `` `[Mark stock handled manually]` ``, `` `[Why did this happen?]` ``,
    `**OpenLinker can publish your stock, but it can't always change it.**`
  - § 5.5: `**This return is not matched to an order.**`, `` `[Match to an order]` ``
  - Code declarations: `restock-blocked.copy.ts` (`RETURN_RESTOCK_BLOCKED_COPY`,
    `RETURN_RESTOCK_BLOCKED_EXPLAINER`), `return-detail.copy.ts`
    (`RETURN_ORPHAN_BANNER_COPY`), and the two restated titles in
    `fulfillment-authority/lib/attention-reason.copy.ts` (`ATTENTION_REASON_COPY`
    keyed `'restock-blocked'` / `'return-unmatched'`).

## 3. Design

One script, `scripts/check-spec-owned-copy.mjs`. One declared table `SPEC_OWNED_COPY`
of pairs `{ id, spec, section, kind, code: { file, declaration, path } }`.

For each pair:
1. Locate the spec section by its heading line (exactly one match, else FAIL).
2. Extract the emphasised runs of the pair's `kind` from that section:
   `bold` (`**x**`), `code` (`` `x` ``), `button` (`` `[x]` ``, inner text).
3. Read the code value TEXTUALLY: balanced-brace the declaration, walk the `path`,
   read a plain string literal. Anything else (template literal, concatenation, a
   missing key, a duplicate key) is a FAILURE, never a skip.
4. PASS only if the code string equals one run of that kind, byte for byte. There is
   no third copy of the string in the table: the spec and the code are the only two
   sides, so the table cannot itself drift.
5. On failure name BOTH sides (spec file + section + the candidate runs, code file +
   declaration + the value) and say when the difference is only a trailing period or
   case, which is exactly the #2673 symptom.

**Narrowing (added after tech review).** Matching is section-wide, which is only evidence
about the canonical rendering when exactly one run could match. A pair where several runs
equal the code value fails as AMBIGUOUS; it is narrowed with `lineContains` (an anchor
phrase on the canonical line, not an owned string) and, if that line names the string
twice, `occurrence`. Measured on the live spec: `Restock blocked` matches 5 code runs in
§ 5.4 and `Why did this happen?` 2 button runs, so those two pairs are narrowed; the other
five have exactly one match.

Decision logic lives in pure functions (`classifyPair`, `extractRuns`,
`readCodeString`, `findSection`) so `--self-check` can prove every arm with
in-memory fixtures; an arm reachable only through the filesystem is an arm no fixture
can pin.

Hard failures: zero declared pairs (cannot pass by discovering nothing, #2792); a
section with no runs of the declared kind; unreadable file; unlocatable declaration.

## 4. Steps

| # | File | Change | Acceptance |
|---|---|---|---|
| 1 | `scripts/check-spec-owned-copy.mjs` | New script + `--self-check` fixtures | self-check proves: match, drift (period), drift (case), spec run missing, section missing / ambiguous, declaration missing, key missing, duplicate key, non-literal value, zero pairs fatal |
| 2 | `package.json` | add self-check + live run to `check:invariants` | `pnpm check:invariants` runs it |
| 3 | demonstrate red | temporarily break a code string and a spec string, observe failure naming both sides, revert | both break cases fail with the right message |
| 4 | docs | one paragraph in the returns spec § 5.4 canonical note and in the script header: what is and is not held, the placeholder gap | docs name the gap |

## 5. Validate

- Architecture: tooling only, no layer boundary touched. Zero dependencies.
- Naming: `check-spec-owned-copy.mjs`, the sibling convention.
- Testing: the script's own `--self-check`, plus the red demonstration (AC 3). No
  unit/integration tests apply (scripts are not under a jest package).
- Security: reads repo files only, no network, no eval.
- Risk: the table must stay honest. Adding a pair whose spec run does not exist
  fails immediately, so a stale entry cannot hide.

## Known gaps (stated, not hidden)

1. Placeholder sentences (the § 5.4 line-row body, attested-state sentence,
   explainer body) are NOT compared; the code holds them as fragments.
2. Only emphasised runs are compared. A spec string written as plain prose is
   invisible to this check until someone marks it up.
3. It proves code equals spec, not that a component renders the constant.

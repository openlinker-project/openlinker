# Implementation Plan: Preset change confirmation with a generated diff (#2355)

**Date**: 2026-08-27
**Status**: Ready for Review
**Estimated Effort**: ~0.5 day

---

## 1. Task Summary

**Objective**: replace the placeholder confirm dialog on `/settings/who-decides` with one whose
body is **generated from `POST /fulfillment-authority/presets/preview`** — plain sentences naming
exactly which decisions change and what each new answer means operationally, the always-present
prospective-only (P7) line, and a **blocked save** when the resulting arrangement would be
ambiguous, naming and linking every conflicting connection.

**Context**: spec stories S1-2 / S1-3 / S1-4. A static "are you sure" would let an operator change
what OpenLinker decides about their stock without being told. Static copy also rots: a new preset or
a new decision row would ship a dialog that is simply untrue. The sentence set is therefore derived
from the server's diff.

**Classification**: Frontend (Interfaces). **No backend change, no migration.**

---

## 2. Scope & Non-Goals

### In Scope
- Preview wire types, Zod parse, API client method, query key, query hook.
- A pure `lib/` diff→sentence module and its unit tests.
- A `WhoDecidesPresetConfirm` component rendering loading / error / empty / changes / blocked.
- `ConfirmDialog` gains an optional `confirmDisabled` prop (shared-ui, additive).
- CSS rules for every new class; barrel exports; component tests.

### Out of Scope
- The `Changed just now` row marker (S1-2's second half) — belongs with #2356's row work.
- Any backend edit. The preview endpoint, its authorisation and its diff shape are #2353's.
- The "link to the affected orders" half of S1-3 — `affectedOrderCount` has no per-order route in
  this feature yet; #2356 owns the `?attention=` filter that would make such a link honest.

### Constraints
- `apps/web` cannot import `@openlinker/core` (#591) — every union is a local mirror.
- A `.copy.ts` in this feature may not import from a path containing a banned §2.1 term
  (`check-ui-vocabulary` scans import paths in copy modules). All new modules keep the
  `who-decides*` / `preset*` naming.
- Selection and dialog state stay component-local `useState`; never a search param.
- `.nullish()`, never `.optional()` (#939). No `as never` in tests. No `any`.

---

## 3. Architecture Mapping

**Target layer**: `apps/web/src/features/fulfillment-authority` (Interfaces tier), plus one
additive prop on `apps/web/src/shared/ui/confirm-dialog.tsx`.

**Reused**:
- `resolveAnswer` (`lib/who-decides-view.ts`) — a `AuthorityPresetChange.before/after` **is** an
  `AuthorityAnswerRow`, so the diff renders answers through the same function the table uses. No
  second copy of answer rendering.
- `ATTENTION_REASON_COPY` / `ATTENTION_UNKNOWN_COPY` + `isAuthorityAttentionReason` (#2357) for the
  "what would stop working" body of each blocking conflict — the §4.2 body has exactly one home.
- `QUESTION_LABEL_COPY`, `WHO_DECIDES_PAGE_COPY.prospectiveOnly`, `PRESET_ACTION_COPY`.
- `useConnectionsQuery` + the panel's existing `nameFor`, which falls back to **the id**.

**New**:
- `api/who-decides.types.ts` — `AuthorityPresetChange`, `AuthorityPresetPreview`.
- `api/who-decides.schema.ts` — `parseAuthorityPresetPreview`.
- `api/who-decides.api.ts` — `previewPreset`.
- `hooks/use-preset-preview-query.ts`.
- `lib/preset-diff.ts` — pure `buildPresetDiff`.
- `lib/who-decides.copy.ts` — `PRESET_CONFIRM_COPY` + `PRESET_CHANGE_MEANING_COPY`.
- `components/who-decides-preset-confirm.tsx`.

**Why the frontend does not compute the diff**: resolution lives in `libs/core`; a browser-side diff
would have to reimplement it and would drift. The endpoint already ships `changes`, the resulting
ambiguities and `blocked`, precisely so no consumer re-derives any of it.

---

## 4. Research

### The wire contract (#2353, verified in-tree)
`POST /fulfillment-authority/presets/preview` → `{ presetId, changes[], resultingAmbiguities[],
blocked }` where each change is `{ question, before: AuthorityAnswerRow, after: AuthorityAnswerRow }`
and each ambiguity is an attention item carrying `question` + `connectionIds`.

`previewPreset` is authorised for `admin | operator | viewer` — it is a **read**. `applyPreset` is
`admin` only. The Save control therefore stays **absent** (not disabled) for a non-admin, unchanged
from #2354.

**Preview commits nothing.** `AuthorityStatusService.previewPreset` runs the same pure `mutate` over
an in-memory copy and never calls `connectionService.update`. Frontend-side, the dry run is a
`useQuery`, structurally distinct from the apply mutation — pinned by a test asserting that opening
and cancelling the dialog never calls `applyPreset`.

### The refusal envelope
`{ message, presetId, ambiguities }`, ids one level down on `ambiguities[].connectionIds`. Already
read correctly by `readAmbiguousConnectionIds`; the blocked-save preview path reads the **preview
response**, whose `resultingAmbiguities` has the identical item shape.

### `openlinker-decides` preserves assignments
`disableClaimsPreservingAssignment` sets `enabled: false` and keeps the connection, its `scopes` and
its `isPrimary`. The diff must make that legible, or the dialog reads as a deletion of configuration
the operator cannot reconstruct.

---

## 5. Questions & Assumptions

- **Assumption**: the preview response is sufficient to build every sentence without re-resolving —
  confirmed by reading the DTO; the only thing the browser adds is connection *names*, which the page
  already loads.
- **Assumption (stated, not hidden)**: an unrecognised answer kind cannot occur, because the Zod
  parse rejects the whole envelope first. The sentence builder still switches exhaustively with a
  `never` check rather than an `otherwise` arm.
- **Open**: whether a blocked dialog should also list the changes it refuses to apply. Decided **no**
  — see §7 Alternative 2.

---

## 6. Implementation Plan

### Phase 1 — transport

1. **`api/who-decides.types.ts`** — add `AuthorityPresetChange { question, before: AuthorityAnswerRow,
   after: AuthorityAnswerRow }` and `AuthorityPresetPreview { presetId, changes, resultingAmbiguities,
   blocked }`. *Acceptance*: types compile; no new union invented.
2. **`api/who-decides.schema.ts`** — extract the existing row mapper into a reusable `toRow`, add
   `previewSchema` + `parseAuthorityPresetPreview` returning `AuthorityPresetPreview | null`.
   Whole-envelope parse, same as the status parse: a half-read diff is a dialog making a partial
   claim about what a save does. *Acceptance*: unit test parses a real-shaped payload and returns
   `null` for an unknown answer kind.
3. **`api/who-decides.api.ts`** — `previewPreset(presetId)`; POST, body `{ presetId }`, response
   through the parse. Docblock states it is a read that commits nothing.
4. **`api/who-decides.query-keys.ts`** — `preview: (presetId) => [...all, 'preset-preview', presetId]`.
5. **`hooks/use-preset-preview-query.ts`** — `useQuery` keyed per preset, `enabled` only while the
   dialog is open with a preset selected, so no preview fires on mere selection.

### Phase 2 — the pure sentence builder

6. **`lib/preset-diff.ts`** — `buildPresetDiff(changes): PresetDiffView`:
   - one `PresetDiffLine` per change: `{ question, label, before: AnswerRendering,
     after: AnswerRendering, meaning }`, `meaning` keyed on the **after** answer kind via an
     exhaustive switch with a `never` default;
   - `preservesAssignment: boolean` on the view — true when any change moves **away from** a
     configured list of systems (`before.kind === 'holders' && after.kind !== 'holders'`), which is
     exactly the shape "a claim was switched off". Derived from the diff, never from the preset id.
   *Acceptance*: unit tests over a fixture diff — one line per change, meaning per kind,
   `preservesAssignment` true for `holders → openlinker` and false for `manual → openlinker`.

7. **`lib/who-decides.copy.ts`** — `PRESET_CHANGE_MEANING_COPY` (one sentence per answer kind, so a
   sentence exists because an *answer* exists, not because a preset does), plus `PRESET_CONFIRM_COPY`:
   `changesHeading`, `noChanges`, `assignmentPreserved`, `blockedTitle`, `blockedIntro`,
   `loading`, `unreadable`, `retryLabel`. No banned §2.1 term; "systems", never the banned noun.

### Phase 3 — the dialog

8. **`shared/ui/confirm-dialog.tsx`** — optional `confirmDisabled?: boolean`, OR-ed into the existing
   `isConfirming` disable. Additive; every existing call site is unaffected. Reusing `isConfirming`
   for a refusal was rejected: it would make "in flight" and "not allowed" the same state.
9. **`components/who-decides-preset-confirm.tsx`** — the dialog body, given `preview`, `isLoading`,
   `isError`, `connectionNames`. Five renderings:
   - **loading** — a plain line, `aria-busy`; confirm disabled (never let a save go out before the
     dialog can say what it does);
   - **unreadable** — the honest error plus a retry; confirm disabled;
   - **blocked** — an error-toned `Alert`: per conflict the §4.2 body, then the conflicting
     connections as links (`nameFor` → the id when unresolvable); confirm disabled. The change list
     is **not** rendered here (see §7);
   - **empty diff, not blocked** — one neutral sentence, confirm **enabled**;
   - **changes** — the generated list, plus the reversibility line when `preservesAssignment`.
   The P7 prospective-only line renders in **every** one of the five.
10. **`components/who-decides-panel.tsx`** — mount it as the `ConfirmDialog` `description`, pass
    `confirmDisabled`, keep `runApply` as the single apply call site.
11. **`index.css`** — rules for every new `who-decides__*` class (the styles test asserts this).
12. **`index.ts`** — export the new hook, api method, parse, builder and component.

### Phase 4 — tests

13. `lib/preset-diff.test.ts` (pure), `api/who-decides.schema.test.ts` additions, and
    `components/who-decides-panel.test.tsx` additions: generated list from a fixture diff, P7 line
    present, empty-diff wording with an enabled Save, blocked path naming + linking the connection
    with a disabled Save, an unresolvable id rendering as the id, and **cancel never calls
    `applyPreset`**.

---

## 7. Alternatives Considered

**Alt 1 — compute the diff in the browser from two status reads.** Rejected: it reimplements
`resolveAuthorities`, cannot see the proposed config at all, and would drift from the server the
moment resolution changes. The endpoint exists precisely to prevent this.

**Alt 2 — render the change list *and* the block together.** Rejected: nothing on that list would
happen, so listing it states an outcome that will not occur. S1-4 asks the dialog to say what would
stop working — the conflict, not the ambition. An empty diff and a refusal must read differently and
this is what makes them do so.

**Alt 3 — a per-preset paragraph.** Rejected: it is the static copy the issue exists to remove.

---

## 8. Validation & Risks

- ✅ Dependency direction `features → shared`; no `shared → features` edge added.
- ✅ Server state via TanStack Query; dialog/selection local `useState`.
- ✅ Exhaustive switch + `never` for the meaning map — no `otherwise` arm relying on a core invariant.
- **Risk — preview and apply disagree.** The preview is a snapshot; a connection can change between
  preview and save. Mitigation: the server re-checks on apply and the existing 422 path already
  renders the refusal. The dialog is an explanation, never the guarantee.
- **Risk — a slow preview blocking the operator.** Mitigated by disabling confirm rather than
  spinning the whole dialog; cancel is always available.
- **Edge — blocked *and* empty diff** (an already-ambiguous install picking the no-op): renders the
  refusal, which is the true statement. Covered by a test.

---

## 9. Acceptance Criteria

- [ ] The dialog lists exactly the changed rows, generated from the preview response (fixture test).
- [ ] The prospective-only line is present in every dialog state.
- [ ] An ambiguity-producing selection blocks save and names the conflicting connection, linked.
- [ ] Usable at 375 px; tap targets ≥44 px; no new row height outside the Density list.
- [ ] Component tests cover the blocked path, the empty diff and the non-mutating cancel.
- [ ] `pnpm lint` / `type-check` / `apps/web` tests green (390 test files).

---

## 10. Tech-lead review of this plan (pre-implementation) and the resulting amendments

Reviewed against `docs/frontend-architecture.md`, `docs/frontend-ui-style-guide.md`,
`docs/engineering-standards.md` and the live tree. Four findings; all applied above and below.

### BLOCKING — `ConfirmDialog.description` renders inside a `<p>`, so the diff list cannot live there

`ConfirmDialog` passes `description` to `DialogDescription`, which is Radix's `Dialog.Description`
and renders a **`<p>`** (`shared/ui/dialog.tsx:38-44`, typed `HTMLParagraphElement`). The plan put an
`Alert` (a `<div role="alert">`, `shared/ui/alert.tsx`) and a `<ul>` of connection links inside it.
That is invalid DOM nesting: React warns, and the HTML parser **closes the `<p>` early**, so the
flow content escapes the element Radix wires as the dialog's `aria-describedby` target — the
accessible description silently becomes the empty remainder. #2354 already nests two `<p>`s there,
so the defect is pre-existing; this slice would have made it structurally worse.

**Applied**: `ConfirmDialog` gains an optional **`body?: ReactNode`** slot rendered as a sibling
`<div className="dialog__body">` *after* the description, and this feature puts the generated diff,
the block Alert and every list in `body`. `description` keeps exactly one thing — the spec-verbatim
P7 sentence — which is phrasing content, valid in a `<p>`, and is precisely the sentence that must
be the dialog's accessible description. Additive and optional, so all 20 existing call sites are
unaffected. Chosen over `asChild`-ing `DialogDescription` into a `<div>`, which would change the
rendered element for every one of those call sites to fix one.

### IMPORTANT — pin the discriminant, not the field name

The Zod mapper renames the wire's `holders` array to `parties`, but the **discriminant stays
`'holders'`**. `preservesAssignment` therefore tests `before.answer.kind === 'holders'`, and a test
must pin that: a reviewer reading `parties` in the view model will reasonably assume the kind
renamed too, and "no change reported" is a silent failure — the reversibility line simply never
renders and nobody notices.

**Applied**: named in step 6 and asserted in `preset-diff.test.ts`.

### IMPORTANT — state that the apply invalidation already covers the preview

`useApplyPresetMutation` invalidates `whoDecidesQueryKeys.all`, and the new preview key is built from
`...all`, so a stale diff cannot survive an apply. That is load-bearing rather than incidental — a
preview key rooted anywhere else would leave the dialog explaining a change that already happened.

**Applied**: step 4 spells the key as `[...whoDecidesQueryKeys.all, 'preset-preview', presetId]`.

### SUGGESTION — component filename casing

`CLAUDE.md`'s summary says components are `PascalCase.tsx`; `docs/frontend-architecture.md`
§ Components And Pages says **kebab-case file, PascalCase export**, which is what every file in this
feature and in `shared/ui` actually does. The plan follows the specific doc and the live practice
(`who-decides-preset-confirm.tsx` exporting `WhoDecidesPresetConfirm`). No change; noted so the
choice reads as deliberate.

### Verdict

🔄 **Approve with changes** — the BLOCKING nesting defect is fixed by the additive `body` slot above,
which is now part of step 8. No architectural or boundary issue: no new cross-layer edge, no state
moved out of its owner, no raw `fetch`, no `any`, no migration.

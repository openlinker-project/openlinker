# Implementation Plan: "Who decides what" settings page (#2354)

**Date**: 2026-08-26
**Status**: Ready for Review
**Estimated Effort**: ~1 day

---

## 1. Task Summary

**Objective**: Ship the operator-facing `/settings/who-decides` page — three preset cards
and the always-rendered seven-row question table — on top of the `#2353` HTTP surface and
the `#2357` copy layer.

**Context**: Wave-2 product spec §3. The operator has no single place answering *"who is in
charge of what"*. §2.3's zero-config visibility rule is the hard requirement: every row
renders a concrete answer **and a why line** with no configuration, never an empty state.

**Classification**: Frontend / Interface.

---

## 2. Scope & Non-Goals

### In Scope

- New route `settings/who-decides` + a `SettingsPage` tile.
- Three preset cards (spec §3.2 verbatim copy), single-select, card 3 disabled-with-reason.
- The persistent prospective-only (P7) line below the cards.
- The seven-row table (§3.3): question / answer / why / state badge, always rendered.
- The A6 locked row and the A7 delegated **link** row.
- Preset apply (`PUT …/presets`) behind `useWriteAccess` + `ReadOnlyLock`, including the
  **partially-applied** and **422 ambiguity** outcomes.
- Responsive: mobile + tablet + desktop.
- Re-pointing `scripts/check-authority-kind-mirror.mjs`'s pending entry to the file this
  issue creates, and flipping the `check-ui-vocabulary` scan root to `pending: false`.

### Out of Scope

- **The `Needs attention` section and cross-surface badges** — #2356. This page consumes
  `attention.counted` only to resolve an ambiguous row's why-line (below); it renders no
  attention section, no count and no filter chip.
- **The generated-diff confirm dialog** — #2355. This issue ships a plain `ConfirmDialog`
  carrying only the spec-verbatim P7 sentence, which #2355 replaces with the preview-fed
  version. No static per-row change copy is written here, so #2355 deletes nothing it then
  has to re-author.
- Per-authority override (§1.1 — the table is read-only in v1).
- `POST …/presets/preview` — #2355 owns the preview call.

### Constraints

- `apps/web` cannot import `@openlinker/core` (#591). Shared vocabulary is a guarded mirror.
- No migration.
- Operator copy must pass `scripts/check-ui-vocabulary.mjs` — the nine banned terms include
  **`authority`**, **`holder`** and **`phase`** as whole words. The feature *folder* is named
  `fulfillment-authority` and that is fine (P9 bans the vocabulary from **rendering**, not
  from existing); no rendered string may contain them.
- Dependency direction `app → pages → features → shared`; `shared` may not import `features`.

---

## 3. Architecture Mapping

**Target layer**: `apps/web` — Interface. No backend change, no core change.

**Existing surfaces reused**:

| Concern | Reused |
|---|---|
| Page chrome | `shared/ui/page-layout` (`PageLayout`: eyebrow / title / description / `backTo`) |
| Tile | the `panel panel--dense` + `eyebrow` / `section-title` / `panel__meta` shape of `SalesDocumentsTile` |
| Write gating | `useWriteAccess('connections:write', demoMode)` + `ReadOnlyLock` + `DEMO_READ_ONLY_ACTION_MESSAGE` |
| Transport | `app/api/api-client.ts`'s bound `ApiRequest`, `ApiError` |
| Server state | TanStack Query; `use-*-query.ts` / `use-*-mutation.ts`, one hook per file |
| Response parsing | Zod (`zod/v4`), the `features/returns/api/returns.schema.ts` precedent |
| Badges / alerts | `shared/ui/status-badge`, `shared/ui/alert`, `shared/ui/feedback-state` |
| Confirm | `shared/ui/confirm-dialog` |
| Connection names | `useConnectionsQuery` from the `features/connections` **barrel** |
| Copy | `lib/attention-reason.copy.ts` (#2357) for §4.2 bodies; a new `who-decides.copy.ts` for this page's own furniture |

**New components**: one feature slice under `features/fulfillment-authority/` (`api/`,
`hooks/`, `components/`, `lib/`), one page module, one route module.

**Why the frontend and not the backend**: every field #2353 returns is a **code**. All
operator English is the frontend's by construction — a backend string would bypass
`check-ui-vocabulary` and could never enter the `t(key, fallback)` seam.

---

## 4. Domain Research

### The API contract (#2353), as shipped

`GET /fulfillment-authority/status` → `AuthorityStatusResponseDto`:

- `rows: AuthorityAnswerRowDto[]` — **exactly seven**, in `AuthorityQuestionValues` order,
  each carrying `question`, `state`, `source`, `answer`, `why`,
  `inactiveClaimantConnectionIds`.
- `attention: { counted[], routine[], affectedOrderCount }`.
- `presets: { id, available, unavailableReason }[]`.
- `applied?: { updatedConnectionIds, failedConnectionIds }` — **apply response only**.

`PUT /fulfillment-authority/presets` (`@Roles('admin')`) → the same status shape **plus**
`applied`. `400` unknown/unavailable preset, `422` the result would be ambiguous.

Closed unions this page reads:

```
AuthorityQuestionValues  availability | sourcing | fulfillment-execution |
                         order-lifecycle | returns-disposition | refund-trigger |
                         sales-documents
AuthorityStateValues     resolved | default | ambiguous | unavailable
AuthoritySourceValues    default | operator-config | fixed-by-design | delegated
answer.kind              openlinker | holders | manual | default-today |
                         nobody-to-route | cannot-tell | configured-elsewhere
why                      { kind:'default', code } | { kind:'ambiguous', reason }
AuthorityPresetIdValues  leave-as-they-are | openlinker-decides | keep-other-system
```

### Five contract facts that shape the rendering

1. **Render from `state` and `source`, never from a question literal.** `deriveAuthorityState`
   is the single producer (the #2100 `blocksIssuanceElsewhere` rule). A7 carries
   `kind: null` / `source: 'delegated'` / `state: 'unavailable'`; A6 carries
   `source: 'fixed-by-design'`. Testing `question === 'refund-trigger'` in the browser would
   be a second copy of a rule that lives in core.
2. **`attention.routine` is always empty today and that is correct** — every union member is
   `counted: true`, and §4.3's routine states live on the who-decides **row** as a
   state/source/answer. Do not invent a client-side split.
3. **The 422 guard is on the RESULT, not the delta** — an already-ambiguous install is
   refused by *every* preset including the no-op `leave-as-they-are`.
4. **`failedConnectionIds` non-empty means PARTIALLY applied.** The apply is N independent
   saves and cannot be atomic. Re-submitting the same preset converges.
5. **`openlinker-decides` disables claims while PRESERVING the assignment** — reversible by
   re-enabling. The operator must be able to tell that from the UI, so card 2's copy says so.

### The ambiguous why-line, resolved without a new mirror

Spec §3.3: an ambiguous row's why-line is **replaced** by the matching §4.2 body copy.
Rather than mirroring `AuthorityKind → AuthorityAttentionReason` a second time in the
browser, the row finds its own entry in `attention.counted` **by `question`** — a field the
API already ships on every derived item — and renders
`ATTENTION_REASON_COPY[item.reason].body`. Nothing is re-derived; an unrecognised reason or
a missing item degrades to `ATTENTION_UNKNOWN_COPY.body`, which is the honest reading of
"this build cannot name the cause".

---

## 5. Questions & Assumptions

### Assumptions

- **`connections:write` is the right permission.** The apply writes `Connection.config`
  rows through `IConnectionService`; `sales-document-rules-list.tsx` gates the analogous
  write on the same permission.
- **The tile is NOT admin-gated — a deliberate deviation from all five existing tiles.**
  `Currency`, `Mailer`, `PostHog`, `MCP tokens` and `Sales documents` are every one of them
  `{isAdmin ? <XTile /> : null}` with a matching gated `toolbar-chip`. #2353 nevertheless
  authorises `GET status` for `admin | operator | viewer` **precisely** so a read-only role
  can see who decides what, and this issue's own AC requires it — gating the tile would make
  the page unreachable for exactly the role the endpoint was widened for. The tile and its
  chip therefore render for every authenticated session; the *write control* is what
  `useWriteAccess` gates.
- **`Chosen` renders `tone="success"`.** Spec §3.3 says "accent"; `StatusBadgeTone` has no
  `accent` member and `info` is already spoken for by `Always`. Documented at the mapping.
- **A preset id the response carries but this build does not recognise is not rendered.**
  The catalogue is closed and server-side; inventing a card for an unknown id would put
  words in the backend's mouth. Cards render in the copy module's declared order, looked up
  by id in the response — a preset the server did not offer is likewise not rendered.
- **A `holders` answer whose `connectionId` resolves to no known connection renders the raw
  id** in `mono-text`. That IS what the backend said; substituting "Unknown" would assert
  something the response does not.

### Documentation gap (noted, not blocking)

Spec §3.2's prose says *"the third card is the current default and is not a preset"* while
its own card listing makes **card 1** (*Leave things as they are*) the current default with
the `Current` badge. The card listing and the shipped `AuthorityPresetIdValues` order agree
with each other, so the listing wins; the prose sentence appears to be a stale ordering.

---

## 6. Proposed Implementation Plan

### Phase 1 — Vocabulary mirror and copy

1. **`lib/authority-kind.ts`** — the frontend mirror of `AuthorityKindValues`, one member
   per line, no computed keys (the mirror script reads it **textually**). Header states that
   the browser bundle cannot depend on `@openlinker/core` (#591) and that
   `scripts/check-authority-kind-mirror.mjs` is the enforcement.
   *Acceptance*: `node scripts/check-authority-kind-mirror.mjs` reports it as a live mirror.

2. **`scripts/check-authority-kind-mirror.mjs`** — **re-point** the `PENDING_MIRRORS` entry's
   `file` and `pending` fields at the file from step 1 (its declared path is
   `features/orders/lib/authority-kind.ts`, a directory chosen only because this folder did
   not yet exist).

   There is **no separate "live mirror" list to move it into** — `PENDING_MIRRORS` is the
   script's only mirror array, and its handler already enforces the mirror the moment the
   declared file exists (absent + parent dir present ⇒ note; absent + parent dir missing ⇒
   drift, the anti-typo guard; present ⇒ parsed and diffed against core in order). Two
   `--self-check` assertions (`PENDING_MIRRORS.length > 0`, and every entry naming a non-empty
   owning wave) make **deleting** the entry a build failure, so re-point, never remove and
   never stub.

   Consequent hard requirement on step 1's file: it must export
   `export const AuthorityKindValues = [ … ] as const;` carrying the **six** core values in
   the **same order**, one literal per line and no computed keys — `parseKindValues` reads it
   textually after stripping comments.

3. **`lib/who-decides.copy.ts`** — every operator string for this page: page furniture
   (eyebrow / title / lede / section headings / counter), the three preset cards (verbatim
   §3.2, including `bestIf`, `whatThisChanges` and card 1's *"Nothing changes when you pick
   this"*), the unavailable-reason code → sentence map, the persistent P7 line, the seven
   question labels, the answer-kind labels, the why-code map, the badge labels, the
   partially-applied and 422 sentences, and the tile copy.
   It **imports** `ATTENTION_SECTION_COPY` / `ATTENTION_UNKNOWN_COPY` / `ATTENTION_REASON_COPY`
   from `attention-reason.copy.ts` rather than restating them — #2357 owns those.
   *Acceptance*: `node scripts/check-ui-vocabulary.mjs` green; no rendered string contains
   `authority`, `holder`, `phase`, `posture`, `Gateway`, `Orchestrator`, `ATP`.

4. **`scripts/check-ui-vocabulary.mjs`** — flip the `fulfillment-authority` scan root to
   `pending: false` (the folder exists, so it is already being scanned; the flag only
   controls whether the run reports a gap that has closed).

### Phase 2 — Transport

5. **`api/authority-status.types.ts`** — the code unions as `as const` arrays + derived
   types, plus the view interfaces. Mirrors #2353's wire shape; carries no copy.
6. **`api/authority-status.schema.ts`** — Zod (`zod/v4`) parse of the response.
   **Every optional-on-the-wire field is `.nullish()`, never `.optional()`** (#939): OL
   serialises an absent optional as JSON `null` and `.optional()` rejects `null`, which is
   what once dropped a whole address section. `applied` and `unavailableReason` are the two
   that bite here. The envelope parse is **non-fatal per concern**: an unreadable envelope is
   reported as such rather than rendered as "seven rows, none of them here".
7. **`api/authority-status.query-keys.ts`** — `{ all, status() }`.
8. **`api/authority-status.api.ts`** — `createFulfillmentAuthorityApi(request)` with
   `getStatus()` and `applyPreset(presetId)`. Registered as the `fulfillmentAuthority`
   namespace on `CoreApiClient` in `app/api/api-client.ts` and stubbed in
   `test/test-utils.tsx`'s `createMockApiClient`.
9. **`hooks/use-authority-status-query.ts`**, **`hooks/use-apply-preset-mutation.ts`** — the
   mutation invalidates `authorityStatusQueryKeys.all` on success.

### Phase 3 — Rendering

10. **`lib/who-decides-view.ts`** (pure, unit-tested) — `resolveAnswerLabel(row)`,
    `resolveWhyLine(row, attention)`, `resolveRowBadge(row)`. The badge resolution order is
    load-bearing and is asserted by a spec:

    | Test, in order | Badge | Tone |
    |---|---|---|
    | `source === 'fixed-by-design'` | `Always` | `info` |
    | `source === 'delegated'` | `Elsewhere` | `neutral` |
    | then an **exhaustive switch on `state`**: | | |
    | `ambiguous` | `Nothing is deciding` | `error` |
    | `default` + `answer.kind === 'nobody-to-route'` | `Nothing to route` | `neutral` |
    | `default` | `Default` | `neutral` |
    | `resolved` | `Chosen` | `success` |
    | `unavailable` (not `delegated`) | `Not available` | `neutral` |

    `Nothing is deciding` is the only badge that is ever red.

    **The `state` switch is exhaustive with a `never` default, not a fall-through.** An
    `otherwise → Chosen` arm would be total only because `deriveAuthorityState` currently
    reaches `'unavailable'` exclusively via `source === 'delegated'` — an invariant that lives
    in `libs/core` and which `apps/web` can neither import (#591) nor observe. Were core ever
    to reach it another way, that arm would render **`Chosen` on a row where nothing is
    decided**: a positive claim that an operator picked a decider, which is the wave's
    "a UI must not assert what the backend did not say" rule broken in the most expensive
    direction. `unavailable`-but-not-`delegated` is unreachable today and gets its own neutral
    rendering rather than inheriting a confident one. Same shape as the `never`-default
    exhaustiveness #2286 shipped across all five `OrderLifecycleEvent` consumers.

11. **`components/who-decides-question-row.tsx`** — one row: question, answer, why, badge,
    plus the `inactiveClaimantConnectionIds` note (*"A switched-off connection still claims
    this"*) when non-empty. The A7 row renders a `<Link to="/settings/sales-documents">` and
    **mirrors no state**. The A6 row renders locked with its reassurance why-line.
12. **`components/who-decides-questions-panel.tsx`** — the seven rows + section furniture.
13. **`components/who-decides-preset-cards.tsx`** — the radiogroup. Follows the
    `SegmentedControl` roving-tabindex ARIA idiom already used by `PublishDestinationRail`.
    Card 3 renders `aria-disabled` with its reason visible inline; card 1 carries the
    `Current` badge while selected. The P7 line renders below, always, never a tooltip.
14. **`components/who-decides-panel.tsx`** — composes 12 + 13, owns the query, the loading /
    error / apply states, `useWriteAccess`, `ReadOnlyLock`, and the `ConfirmDialog`.
15. **`components/who-decides-tile.tsx`** — the settings tile.
16. **`index.ts`** — extend the existing barrel with `WhoDecidesPanel`, `WhoDecidesTile`, and
    the view helpers/types #2355 and #2356 will need.

### Phase 4 — Wiring

17. **`pages/settings/who-decides-page.tsx`** — thin `PageLayout` wrapper,
    `backTo={{ to: '/settings', label: 'Settings' }}`.
18. **`app/routes/who-decides.route.tsx`** — `path: 'settings/who-decides'`, a
    `handle.crumb` (`route-handle.test.ts` asserts every lazy leaf carries one), `lazy`
    import. Appended to `coreChildren` in `root.route.tsx`.
19. **`app/routes/route-lazy.test.ts`** — bump `EXPECTED_LAZY_ROUTE_COUNT` 56 → 57 and add
    the route to the itemised breakdown comment.
20. **`pages/settings/settings-page.tsx`** — mount the tile + its `toolbar-chip`.

### Phase 5 — Styles and tests

21. **`index.css`** — `who-decides-*` rules. Responsive by CSS grid reflow (single column
    ≤ 768 px), **not** by hiding the why column — §3.3 calls the why line "the whole point
    of the table", so a breakpoint that drops it would delete the feature on mobile.
22. **`who-decides-styles.test.ts`** — every `who-decides-*` class the feature puts on an
    element has a rule in `index.css`. Copied from `features/returns/returns-styles.test.ts`,
    which exists because nine class names once shipped with no rule behind them and nothing
    failed.
23. Component tests: zero-config render (all seven rows carry an answer **and** a why, no
    empty state); card 3 disabled with its reason visible; the A6 locked row and the A7 link
    row; a read-only session sees the whole page and no write control; a partially-applied
    response; a 422; an ambiguous row taking the §4.2 body as its why-line.

---

## 7. Alternatives Considered

**Render the table with `DataTable` + `cardView`.** Rejected: the mobile affordance
`DataTable` offers is column-hiding plus a card renderer, and the only column cheap enough to
hide is the why line — the one §3.3 says the table exists for. Seven fixed rows of rich
content (a link, a lock, a badge, a claimant note) also fit a definition-style list better
than a sortable virtualised grid.

**Mirror `AuthorityKind → AuthorityAttentionReason` in the browser** to resolve the ambiguous
why-line. Rejected: the API already ships `question` on every derived attention item, so the
join needs no new rule — and a second mirror is a second thing to drift, guarded by nothing.

**Ship the preset cards read-only and leave apply entirely to #2355.** Rejected: it would
render a chooser that cannot choose. Splitting at "apply here, confirmation there" keeps each
issue independently shippable and makes #2355 a strictly additive change at one call site.

**Gate the tile on `isAdmin`, matching `SalesDocumentsTile`.** Rejected: #2353 deliberately
authorises the read for `viewer`, and hiding the tile would make that read unreachable.

---

## 8. Validation & Risks

- ✅ Dependency direction: `pages` → `features` → `shared`; the one cross-feature import
  (`useConnectionsQuery`) goes through the `features/connections` **barrel**.
- ✅ Feature public surface: the barrel already exists and `fulfillment-authority` is
  already in **both** `.eslintrc.js` `no-restricted-imports` pattern groups (#2357) — AC
  bullet 1 is satisfied and must not be re-added.
- ✅ No `any`, no `console.log`, no raw `fetch`.

### Risks

- **The vocabulary gate is easy to trip.** The feature's own name contains a banned word.
  Mitigated by putting every operator string in `who-decides.copy.ts` (the tightest scan
  mode) and running `check:invariants` before commit.
- **`EXPECTED_LAZY_ROUTE_COUNT` and the crumb contract are two separate gates.** Both must be
  satisfied in the same commit or `route-lazy.test.ts` / `route-handle.test.ts` fail.
- **`createMockApiClient` must stub the new namespace**, or every existing page test that
  renders the settings grid throws on an undefined namespace.
- **Worker starvation in the `apps/web` suite** makes a red run read green (starved files
  count as *errors*, not failures). The baseline is **386 files / 4091 passed**; compare
  file counts between runs and retry rather than bypassing.

### Backward compatibility

Additive only. No migration, no backend change, no change to an existing component's props.

---

## 9. Testing Strategy & Acceptance Criteria

**Unit** (`*.test.ts`): `who-decides-view` badge/answer/why resolution across all seven rows
and all four states; `authority-status.schema` including a `null`-for-absent-optional payload
(the #939 shape) and an unreadable envelope.

**Component** (`*.test.tsx`): as listed in Phase 5 step 23, via `renderWithProviders` with a
`createMockApiClient` override and `createAuthenticatedSessionAdapter`.

**Gates**: `pnpm lint` (chains `check:invariants` → the two mirror scripts + the vocabulary
gate), `pnpm type-check`, `pnpm --filter @openlinker/web test` on **Node 22**.

### Acceptance Criteria (from #2354)

- [ ] The feature barrel and both ESLint pattern groups exist *(already satisfied by #2357 — not re-added)*
- [ ] Every Zod schema over a new backend projection uses `.nullish()`, never `.optional()`
- [ ] All seven rows render an answer and a why line on a zero-config install
- [ ] Preset 3 renders disabled with its reason text visible
- [ ] The refund row is locked and explains why; the documents row links out and mirrors no state
- [ ] A read-only role sees the whole page and no write control
- [ ] Copy passes the vocabulary gate; component tests cover the zero-config render

---

## 10. Alignment Checklist

- [x] Follows the app's `app → pages → features → shared` direction
- [x] Respects the `apps/web` ↛ `@openlinker/core` boundary (#591) via a guarded mirror
- [x] Uses existing patterns (`PageLayout`, `useWriteAccess`, TanStack Query, Zod parse)
- [x] Server state via TanStack Query; no new global store
- [x] Error handling: loading / error / empty / partial-success / 422 all rendered deliberately
- [x] Testing strategy complete
- [x] Naming conventions followed (kebab-case files, `use-*` hooks, `*.route.tsx`, `*.copy.ts`)
- [x] No migration
- [x] Execution-ready

---

## Related Documentation

- `docs/specs/product-spec-oms-wave2-operator-experience.md` §3.1 / §3.2 / §3.3 / §4.2 / §4.3
- `docs/plans/analysis/DESIGN-oms-authority-model.md` §4, `REVIEW-oms-authority-model.md`
- ADR-052, ADR-053, ADR-056, ADR-041
- `docs/frontend-architecture.md`, `docs/frontend-ui-style-guide.md`

---

## 11. Review outcomes folded in (`/pre-implement` + `/tech-review` on this plan)

Both gates ran before any code was written. `/pre-implement` returned **READY**;
`/tech-review` returned **Approve with changes** with no BLOCKING item. Every finding was
ratified and is folded into the steps above or listed here.

**From `/pre-implement`:**

1. `PENDING_MIRRORS` has no "live list" to move an entry into — step 2 is a **re-point**, and
   deleting the entry breaks two `--self-check` assertions. *(Folded into step 2.)*
2. The ungated tile is a deliberate deviation from all five existing tiles. *(Recorded in §5.)*

**From `/tech-review` — IMPORTANT:**

3. **Exhaustive `never`-checked switch on `AuthorityState`**, not a fall-through.
   *(Folded into step 10, with the reasoning.)*
4. **Register the new row surface in `docs/frontend-ui-style-guide.md` § Density & Row
   Heights**, alongside the #2023 and #2086 carve-outs, with the one-line reason: the why line
   cannot be a `hideBelow` casualty. The guide says a row height not on the list must not ship
   without updating the guide first, and a third precedent added the same way is how that rule
   stays true instead of becoming folklore. *(New step 21a.)*
5. **The `400` path gets an honest sentence.** Unreachable today (card 3 is disabled and the
   ids are a closed mirrored set), and "unreachable" is exactly the class that renders as a
   silent no-op when it happens. Reaching it means the frontend and the server disagree about
   the catalogue — stated in the copy module. *(New step 14a.)*
6. **A test asserting a non-admin session SEES the tile**, placed in `settings-page.test.tsx`
   directly beside the existing `never renders the Mailer tile for a non-admin session`, so
   the two opposite expectations sit side by side at the point of temptation. *(New step 23a.)*

**From `/tech-review` — SUGGESTION, all taken:**

7. **44 px tap-target floor at 375 px** for the preset radio affordance and `Apply` — the
   affordance's *hit area*, not the button box (`.btn--sm` floors at 36 px, below the
   requirement). *(Folded into step 21.)*
8. **Selection state is component-local `useState`**, explicitly not a `?preset=` search param
   — a half-made decision must not look linkable and restorable. *(Folded into step 14.)*
9. **Two lines in `docs/architecture-overview.md` § 20 Fulfillment Authority** naming the route
   and its read/write split, so § 20's coverage stays honest. *(New step 24.)*
10. **`who-decides.copy.ts`'s header states that its strings are plain literals, not
    `t(key, fallback)` calls**, and why: `check-ui-vocabulary` scans literals textually, so
    routing copy through the (today no-op) i18n seam would silently move this feature's copy
    out of the gate's reach. *(Folded into step 3.)*

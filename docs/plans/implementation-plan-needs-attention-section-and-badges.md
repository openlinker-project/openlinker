# Implementation Plan: "Needs attention" section and cross-surface badges (#2356)

**Date**: 2026-08-27
**Status**: Ready for Review
**Estimated Effort**: ~1 day

---

## 1. Task Summary

**Objective**: Render Wave-2 product spec §4's inert states in two places at once — a counted,
badged **`Needs attention`** section on the "Who decides what" settings page, and a **row/card badge**
on the surfaces the operator is already looking at — with **byte-identical titles**, plus the
`?attention=` filter chip on `/orders`.

**Context**: #2352 declared the vocabulary, #2353 shipped the status API + the `?attention=` backend
axis, #2357 shipped the copy module + its mirror gate, #2354/#2355 shipped the page and the preset
confirm. Nothing yet **renders** an inert state. Spec §4: a state that appears in only one of the two
places leaves the operator unable to tell that the two descriptions are one condition.

**Classification**: Frontend (Interfaces), plus one additive API response field.

---

## 2. Scope & Non-Goals

### In Scope
1. `AttentionSection` — the counted, badged table below the who-decides questions; zero-state;
   unknown-reason rendering.
2. `OmsAttentionBadges` — one shared row-badge renderer used by desktop cells and mobile cards.
3. `omsAttention` on `OrderRecordResponseDto` (the row entries the badge reads). **No migration** —
   `order_records.omsAttention` and `OrderRecord.omsAttention` already exist (#2352).
4. `/orders`: `?attention=` chip (present-only, offset-resetting) + the `summary.omsAttention` count
   + the row/card badge.
5. `/connections`: a card badge for a connection named by a counted derived state.
6. `/products`: a page-level notice for `availability-unknown`.
7. Component tests for zero-state, a counted state, an unknown value, and the `?attention=` filter.

### Out of Scope
- Anything that WRITES `omsAttention` — #2352 shipped the columns undriven; the producers are
  later slices. Every badge surface must therefore render correctly against an empty array.
- `features/returns`: `return-unmatched` already renders as `RETURN_ORPHAN_BANNER_COPY.title`,
  byte-identical by MIRROR 6 assertion. Untouched.
- A per-product persisted attention column. None exists and #2352 states why (A1-U is derived from
  `Connection.config`, and no pure function can attribute it to individual products).
- AF-X (#2387, body D).

### Constraints
- No migration.
- `apps/web` cannot import `@openlinker/core` (#591) — every shared value is a mirrored copy under
  a `check:invariants` gate (already in place for this vocabulary: `check-attention-reason-mirror.mjs`).
- Dependency direction `app → pages → features → shared`; cross-feature imports go through barrels.

---

## 3. Architecture Mapping

**Target layer**: Interface (`apps/web`), plus one Interface-layer DTO field in `apps/api`.

**Existing pieces reused (nothing new invented)**:

| Piece | Source | Role here |
|---|---|---|
| `AuthorityAttentionReasonValues` | `lib/attention-reason.ts` | render order — never `Object.keys` |
| `ATTENTION_REASON_MIRROR` / `attentionBadgeTone` | same | reason → badge → `StatusBadgeTone` |
| `isAuthorityAttentionReason` | same | narrow an untrusted persisted/wire value |
| `attentionTitle` / `listAttentionReasonCopy` | `lib/attention-reason.copy.ts` | the ONE title producer |
| `ATTENTION_SECTION_COPY` / `ATTENTION_UNKNOWN_COPY` | same | section + unknown copy |
| `AuthorityStatus.attention` | `api/who-decides.types.ts` | `counted` + `affectedOrderCount` |
| `useWhoDecidesStatusQuery` / `whoDecidesQueryKeys` | feature hooks/api | the one status read |
| `OrderPhaseBadge` (#2310) | `features/orders/components` | the shape the row badge copies |
| `salesDocumentBlocked` chip (#2100) | `pages/orders/orders-list-page.tsx` | the chip treatment to follow exactly |

**New components**: `attention-section.tsx`, `oms-attention-badges.tsx`, `lib/attention-entry.ts`
(the wire→view coercion), `hooks/use-oms-attention-query.ts` (a thin wrapper naming the who-decides
status read for its cross-surface consumers), plus a zod schema for the order-row entries.

**No new API endpoint.** The section reads the status response the page already fetches.

---

## 4. Domain research

### The count is TWO numbers added by the caller, deliberately
`AuthorityAttentionView.affectedOrderCount`'s own docblock: *"Adding the two is the caller's job because
they count different things: `counted` counts STATES (one per ambiguous authority, install-wide), this
counts ORDERS."* So the heading number is `counted.length + affectedOrderCount`. The section must say
which is which rather than presenting one opaque total, or an operator cannot act on it.

### `attention.routine` is always empty and that is correct
Every descriptor is `counted: true`. `AuthorityAttention.routine`'s own docblock forbids inventing a
client-side split. The section renders `counted` only and never iterates `routine`.

### A2-`none` cannot be counted — structurally, not by a filter
`AuthorityAttentionCountedReasonValues` is derived from the mirror, and §4.3's routine half lives on
the who-decides **row** as an `AuthorityState` / `AuthoritySource` / `AuthorityAnswer` (#2351). A row
whose A2 answer is `nobody-to-route` produces `state: 'default'`, never `'ambiguous'`, so
`deriveAmbiguities` skips it and it never enters `attention.counted`. The regression AC is therefore
satisfied by **construction plus a test that pins the construction**, not by a suppression rule.

### The order row DTO does not carry `omsAttention`
Verified: `OrderRecordResponseDto` has no such field and `OrdersController.toDto` does not map it,
while `OrderRecord.omsAttention` (a coerced `readonly AuthorityAttentionEntry[]`) does exist. The
badge needs it, so the field is added — additive, no migration, no new query.

### Product rows have no per-product datum, and inventing one would lie
A1-U originates on a connection's config; `AUTHORITY_ATTENTION_REASON_DESCRIPTORS.surfaces` includes
`'product'` because the *effect* lands there ("publishing for these products is paused"), but OL does
not know WHICH products. Stamping every row with a red badge would assert per-product knowledge OL
lacks. A page-level notice carrying the byte-identical title states exactly what is known.

---

## 5. Questions & Assumptions

### Assumptions
- **A1** The heading count is `counted.length + affectedOrderCount`, rendered with both parts named.
- **A2** `?attention=` is present-only (`?attention=true`), mirroring `?invoicing=blocked`. The
  backend accepts `true|false`; the UI never emits `false`, which would mean "hide attention orders".
- **A3** Product surface = page-level notice, not a row badge (§4 deviation, declared here).
- **A4** Connection card badge derives from `attention.counted[].connectionIds`.

### Open questions (non-blocking)
- **Q1** Should the section link each counted state to a filtered list? Deferred: only the order half
  has a filter today, and a link that lands on an empty list for a derived state would be worse than
  none. The section links to the named connections instead, which is the actionable target.

---

## 6. Implementation Plan

### Phase 1 — the shared view seam (feature-internal)

1. **`lib/attention-entry.ts`** — `AttentionEntryView` + `toAttentionEntryView(unknownEntry)`.
   - Coerces one untrusted wire/persisted entry (`producer`, `reason`, `detail?`, `subjectRef?`,
     `since`) into either `{ known: true; reason; badge; tone; title }` or `{ known: false }`.
   - Uses `isAuthorityAttentionReason` → `ATTENTION_REASON_MIRROR` → `attentionBadgeTone` →
     `attentionTitle`. **Never assembles a title.**
   - Acceptance: an unrecognised reason yields `known: false`; a known one yields the byte-identical
     `attentionTitle` output.

2. **`components/attention-section.tsx`** — the counted table.
   - Heading `ATTENTION_SECTION_COPY.heading` + the count; zero-state = the one reassuring line.
   - Rows in `AuthorityAttentionReasonValues` order (group `counted` by reason, then order by the
     array — never `Object.keys`, never the response order).
   - Each row: `StatusBadge` (tone from `attentionBadgeTone`), the title, the §4.2 body, the action,
     and the named connections as `<ul className="who-decides__id-list">` links (the #2355 rule —
     never a `span`).
   - An item whose reason this build does not recognise renders `ATTENTION_UNKNOWN_COPY` neutrally
     and is excluded from the count.
   - Acceptance: zero-state, one counted state, one unknown value, all covered by tests.

3. **`components/oms-attention-badges.tsx`** — the shared row renderer.
   - Props `{ entries: readonly unknown[]; compact?: boolean }`; maps through `toAttentionEntryView`;
     renders one `StatusBadge` per entry with the badge label from `ATTENTION_BADGE_COPY`, the full
     title in `title=` plus an `sr-only` copy (the `OrderPhaseBadge` attribution shape).
   - Renders `null` for an empty array — a row with nothing wrong shows nothing.

4. **Barrel** — export the three plus the view type. Consumers import `../../fulfillment-authority`.

### Phase 2 — mount the section

5. **`WhoDecidesPanel`** — render `<AttentionSection attention={status.attention} … />` **below** the
   questions section, in its own `who-decides__section`, resolving connection names through the same
   `connectionNames` map (falling back to the id, never a placeholder).

6. **`index.css`** — rules for every new class. Every new class in this feature uses the
   **`who-decides-attention*`** prefix: `who-decides-styles.test.ts` only collects names starting
   `who-decides`, so an `attention-*` prefix would be silently uncovered by the guard.

7. **`aria-labelledby`** on the new section, pointing at its own `<h2 id>` — both existing
   `who-decides__section` blocks already do this and the page should stay consistent.

### Phase 3 — the order surface

8. **`OrderRecordResponseDto.omsAttention`** + `OrdersController.toDto` mapping. `@ApiPropertyOptional`,
   array of a small nested DTO, description stating it is NOT the `needs_attention` health bucket.

9. **`features/orders`** — `orders.types.ts` gains `omsAttention?: OrderOmsAttentionEntry[] | null`
   and `OrderFilters.attention?: boolean`; the zod schema (if the row is parsed) uses `.nullish()`;
   `orders.api.ts` serialises `attention` into the query string.

10. **`orders-list-page.tsx`**
   - `NARROWING_FILTER_URL_PARAM` gains `attention: 'attention'` (so `FILTER_PARAMS` /
     `clearAllFilters` / `hasActiveFilters` pick it up for free).
   - Read `searchParams.get('attention') === 'true'`; pass `attention: on ? true : undefined`.
   - `toggleOmsAttention()` mirroring `toggleInvoicingBlocked` — deletes `offset`, emits a demo event.
   - Chip rendered on `omsAttention || summary?.omsAttention` (the #2100 nine-line reason: gating on
     the count alone unmounts the only way to clear an applied filter).
   - `<OmsAttentionBadges entries={order.omsAttention ?? []} compact />` inside `.orders-cell-stack`
     in the desktop `status` cell and in the mobile `data-table__badge-row`. It goes in the **Status**
     group, where rule 2 of § Order-row signal placement already puts exceptions and failure reasons.
     See Phase 6 for the two guide debts this incurs.
   - Chip tone is **`error`**, following `Invoicing blocked` and NOT the untoned `Rate conflict`.
     The untoned neighbour is untoned for a specific reason — `.chip.chip--active` overrides every
     `.chip--{tone}`, so an inactive `conflict` chip (96% lightness, hue 45) reads as pressed beside
     an active accent chip. `error` does not have that problem, and this axis is genuinely error-toned.

11. **`OrderHealthSummary` type** — `omsAttention?: number`.

### Phase 4 — connection + product surfaces

12. **`hooks/use-oms-attention-query.ts`** — a named wrapper over `useWhoDecidesStatusQuery` returning
    `{ countedByConnectionId, entriesForReason(reason) }`, so `/connections` and `/products` do not
    each re-derive the mapping. Key stays under `whoDecidesQueryKeys.all`.

13. **`/connections` list** — for a connection id named by a counted item, render one `StatusBadge`
    with that item's byte-identical `attentionTitle`. Read-only; no new endpoint.

14. **`/products` list** — when a counted `availability-unknown` item exists, render one `Alert`
    above the table with the byte-identical title, its §4.2 body, and a link to
    `/settings/who-decides`. Never a per-row badge.
    **This is a stated deviation from the issue's "renders on its owning row" AC**, and it must be
    stated where it will be read again: in the component's own file header AND in the PR body — not
    only here. Otherwise the next reader treats the absent product-row badge as an oversight rather
    than as the refusal to assert per-product knowledge OL does not have.

### Phase 6 — the two style-guide debts (same commit, not a follow-up)

`docs/frontend-ui-style-guide.md` charges for both of these by name, so neither may be taken silently.

20. **§ Order-row signal placement, rule 2 — the sixth badge vocabulary.** The guide reads *"the
    exception is closed to further growth: a sixth needs its own decision, not this paragraph."* The
    placement itself is what rule 2 already prescribes (*"an exception is a badge"*, and exceptions
    belong in the Status group beside failure reasons), so what is owed is the **decision**, recorded
    in that paragraph: amend the count to six, name #2356, and state the axis — an inert state says
    *OpenLinker stopped deciding*, which is orthogonal to health (*did something fail*), phase
    (*what stage*) and fulfillment (*where is the parcel*). State the tonal consequence honestly
    rather than borrowing the phase's mitigation: an attention badge is **never** neutral, so a row
    carrying one deliberately shows two coloured pills. That is the signal, not a crowding defect.

21. **§ Density & Row Heights — the orders Status cell carve-out.** Registered at *auto, ~72 px* for
    **up to three** stacked lines (health + phase + failure reason). The badge makes four the worst
    case, so the entry is amended with the new worst case and its reason. No alignment change is
    needed — `.orders-table td` already top-aligns every cell — and the entry should say so, because
    that is exactly the question the next reader will ask.

### Phase 5 — tests

14. `attention-section.test.tsx` — zero-state; one counted state (title asserted byte-identically
    against `attentionTitle(reason)`); an unknown reason rendering `ATTENTION_UNKNOWN_COPY.title`
    and not incrementing the count.
15. `attention-entry.test.ts` — coercion, unknown narrowing, tone mapping.
16. `oms-attention-badges.test.tsx` — empty array renders nothing; one entry renders the badge label
    and carries the title.
17. **The A2-`none` regression test** — build a single-location zero-config status fixture (A2 row
    `state: 'default'`, `answer.kind: 'nobody-to-route'`, `attention.counted: []`,
    `affectedOrderCount: 0`) from the REAL response envelope and assert the section renders the
    zero-state and the count reads 0.
18. `orders-list-page.test.tsx` — clicking the chip sets `?attention=true`, clears `offset`, and the
    query receives `attention: true`.
19. Cross-surface title identity — one test asserting the section's rendered title and
    `OmsAttentionBadges`' title for the same reason are the same string.

---

## 7. Alternatives Considered

**A. Per-product `omsAttention` column for A1-U.** Rejected: #2352 states the reason — it is a pure
function of `Connection.config` with no natural write trigger, and a stored copy is a second answer
with a staleness window. It would also require a migration this issue forbids.

**B. Client-side `counted`/`routine` split so A2-`none` appears as a routine row.** Rejected: the API
type's own docblock forbids it, and A2-`none` is not a member of the attention union at all — it is a
row state. Inventing a split would create the second vocabulary §4 exists to prevent.

**C. Section reads a new `GET /attention` endpoint.** Rejected: the status response already carries
`attention`, and a second endpoint would let the section and the who-decides rows disagree about the
same install.

---

## 8. Validation & Risks

- ✅ Dependency direction: pages → features → shared only; the badge is exported from the feature
  barrel and consumed by three pages.
- ✅ Exhaustiveness: `attentionBadgeTone` is an exhaustive switch already; `toAttentionEntryView`
  branches on a guard, not a default arm.
- ✅ `.nullish()` on every new optional wire field.
- ⚠️ **Risk — a badge surface with no data.** Nothing writes `omsAttention` yet, so the order badge is
  invisible in practice today. Mitigated by testing the renderer directly rather than end-to-end, and
  by stating it in the PR body.
- ⚠️ **Risk — the count double-reads.** `counted.length` and `affectedOrderCount` measure different
  things; presenting one number without saying so would mislead. Mitigated by rendering both parts.
- ✅ Backward compatible: every new field is optional; an older API response renders as no badges.
- ⚠️ **Adjacent pre-existing gap, deliberately NOT fixed here.** `OrderFilters.taxRateConflict` is
  set by the list page but never serialised by `buildQuery`, so `?taxRate=conflict` narrows nothing
  server-side. Out of scope — but the new `attention` param is written three lines away and must use
  the `!== undefined` guard (`salesDocumentBlocked`'s shape), never a truthy check, or it repeats
  exactly that class of gap.

---

## 9. Acceptance Criteria

- [ ] A single-location zero-config install shows a **zero** attention count (regression test)
- [ ] Every attention-worthy state renders in the table and on its owning row with byte-identical titles
- [ ] `?attention=` filters `/orders` and resets the offset
- [ ] An unknown reason value renders neutrally and is not counted
- [ ] Component tests for the zero-state, a counted state and an unknown value
- [ ] Zod schemas over new projections use `.nullish()`, never `.optional()`

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (Interface layer only + one additive DTO field)
- [x] Respects CORE vs Integration boundaries (no core change)
- [x] Uses existing patterns (`OrderPhaseBadge`, the #2100 chip, the #2357 copy module)
- [x] No new abstraction without justification
- [x] Error handling: an unreadable status renders the page's existing error state
- [x] Testing strategy complete
- [x] Naming conventions followed (kebab-case files, PascalCase exports)
- [x] No migration

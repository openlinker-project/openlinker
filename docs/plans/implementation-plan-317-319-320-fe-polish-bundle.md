# Implementation Plan — FE Polish Bundle (#317 + #319 + #320)

## 1. Goal

Bundle three small, independent frontend bugs into a single PR:

- **#317** — Diagnostics pages show `eyebrow="Operations"` while the sidebar group and breadcrumb read `Diagnostics`. Fix the eyebrow to match.
- **#319** — `EmptyState` / `ErrorState` CTAs stretch to full card width on desktop because `.state-card__actions` is a grid without `justify-items`. Fix the CSS.
- **#320** — DataTable `mono-text` cells truncate at 20ch with no tooltip or accessible full value on identifier columns. Add `title={value}` to the affected spans.

**Layer:** Interface (pages) + Shared UI (CSS tokens). Frontend only.

**Non-goals:**
- Not introducing a new `IdentifierCell` with clipboard-copy (explicitly deferred in #320).
- Not migrating the connection-identifier columns to `EntityLabel`. `EntityLabel` is the canonical primitive for "internal UUID rendered next to a human name" per `frontend-ui-style-guide.md` §MVP Primitives, and is the right long-term home for these cells — but issue #320 explicitly scopes that follow-up out. The `title={value}` patch here is the MVP fix, not the final shape. The next polish pass should migrate the connection-id columns to `EntityLabel` rather than propagating more `title=` onto new columns.
- Not migrating `.state-card__actions` to flex (explicitly rejected in #319).
- Not touching the Operations pages for #317 (the Operations labeling there is correct).
- Not touching the lastError / rejectionReason columns for #320 (they already use `title=`).

## 2. Research notes

- `apps/web/src/shared/ui/app-shell.tsx:48-88` defines the sidebar groups: **Operations** and **Diagnostics**. Breadcrumb mapping at lines 98-100 correctly lists `/jobs-logs`, `/webhook-deliveries`, `/cursors` under `Diagnostics`.
- `apps/web/src/shared/ui/feedback-state.tsx:49,62` are the only two call sites that render `.state-card__actions` — one inside `EmptyState`, one inside `ErrorState`. A single CSS fix covers both.
- `apps/web/src/index.css:848-855` groups `.state-card__actions` in a shared declaration with other grid containers; `.page-header__actions` already has an explicit `justify-items: end` override at line 857-859. The fix mirrors that pattern.
- `apps/web/src/pages/sync-jobs/sync-jobs-page.tsx:57` and `webhook-deliveries-page.tsx:71` already show the intended pattern for `.mono-text` + `title={value}`. The bug columns are missing it.
- No existing tests assert on the eyebrow string or on `title` attributes for these cells — so no test rewrites required.

## 3. Changes

### #317 — Diagnostics eyebrow

Three one-line edits:

| File | Line | Change |
|---|---|---|
| `apps/web/src/pages/sync-jobs/sync-jobs-page.tsx` | 131 | `eyebrow="Operations"` → `eyebrow="Diagnostics"` |
| `apps/web/src/pages/webhook-deliveries/webhook-deliveries-page.tsx` | 124 | `eyebrow="Operations"` → `eyebrow="Diagnostics"` |
| `apps/web/src/pages/cursors/cursors-list-page.tsx` | 103 | `eyebrow="Operations"` → `eyebrow="Diagnostics"` |

### #319 — state-card actions width

In `apps/web/src/index.css`, add a new rule block right after `.page-header__actions { justify-items: end; }` (line 857-859):

```css
.state-card__actions {
  justify-items: start;
}
```

Rationale: mirrors the `.page-header__actions` pattern in the same file; no change to the shared declaration at 848-855; opts state-card CTAs into natural-width behavior while leaving all other grid containers untouched. Start-aligned (not end) because CTAs in empty/error states are conceptually part of the content, not an action bar.

### #320 — DataTable mono-text tooltips

Add `title={value}` on the following `<span className="mono-text">` elements:

| File | Line | Span value |
|---|---|---|
| `apps/web/src/pages/connections/connections-list-page.tsx` | 53 | `connection.id` |
| `apps/web/src/pages/sync-jobs/sync-jobs-page.tsx` | 33 | `job.jobType` |
| `apps/web/src/pages/sync-jobs/sync-jobs-page.tsx` | 40 | `job.connectionId` |
| `apps/web/src/pages/webhook-deliveries/webhook-deliveries-page.tsx` | 48 | `d.provider` |
| `apps/web/src/pages/webhook-deliveries/webhook-deliveries-page.tsx` | 55 | `d.eventType ?? '—'` → keep span, set `title={d.eventType ?? undefined}` (avoid tooltip of `—`) |
| `apps/web/src/pages/webhook-deliveries/webhook-deliveries-page.tsx` | 61 | `d.connectionId` |

For the nullable `eventType` row, use `title={d.eventType ?? undefined}` so the em-dash fallback doesn't become a tooltip (screen readers and hover both degrade cleanly to no-title).

Skipped:
- `sync-jobs-page.tsx:57` and `webhook-deliveries-page.tsx:71` — already have `title=`.

**Scope decision — include short-value columns:** `jobType` and `provider` carry short values today, and #320 itself flags them as "less painful". They are still included in this patch because uniform behavior ("every mono-text identifier in a DataTable carries its full value") is easier to reason about than a column-by-column threshold, and future long-tailed values (e.g., a new job type introduced by an integration) get the tooltip for free.

## 4. Tests

- **Eyebrow regression guards (#317):** add one `expect(await screen.findByText('Diagnostics')).toBeInTheDocument()` assertion in `sync-jobs-page.test.tsx` and `webhook-deliveries-page.test.tsx`. Near-zero cost, prevents the exact bug from creeping back if a future copy-pass sweeps "Operations" labels back across diagnostics pages. No matching test file exists for the Cursors page, so skip it there.
- **No tests for `title=` or CSS (#319, #320):** attribute-only changes and a single CSS rule aren't behaviors the existing test suite asserts on; adding DOM-attribute assertions for every cell would be noise. The test harness renders components without CSS anyway, so `.state-card__actions` width can't be asserted meaningfully in Vitest.
- Existing `sync-jobs-page.test.tsx`, `webhook-deliveries-page.test.tsx`, `connections-list-page.test.tsx` must still pass.
- Manual verification (done in review, not wired into CI):
  - All three diagnostics pages show `DIAGNOSTICS` eyebrow matching the sidebar group and breadcrumb.
  - Orders / Connections empty states render a natural-width CTA on ≥1440px viewports.
  - **Also check EmptyState/ErrorState CTAs at 360 × 812 (mobile) and 768 × 1024 (tablet)** — `justify-items: start` is applied at all breakpoints, so confirm tap targets remain comfortable on mobile. `.button--sm` is 28px on desktop and 36px on touch per the style guide, so this should already be handled at the button layer; the check is just to confirm no adverse interaction with the new grid rule.
  - Hovering any truncated identifier in Connections / Sync Jobs / Webhook Deliveries tables reveals the full value.

## 5. Validation

- **Hexagonal boundaries:** all changes are in `apps/web/src/pages/` and `apps/web/src/index.css` — Interface + shared CSS only. No CORE or domain touches.
- **Dependency rules:** no new imports, no cross-layer violations.
- **A11y:** `title` is acceptable per issue #320 ("`title` already satisfies hover + screen-reader disclosure"). Eyebrow string change restores taxonomy consistency for assistive tech.
- **Security:** none (no data flow changes).
- **Quality gate:** `pnpm lint && pnpm type-check && pnpm test` must pass.

## 6. Risks / open questions

- Eyebrow assumption (#317): docs explicitly call out that `Diagnostics` is the correct taxonomy per sidebar + breadcrumb, so no product decision needed.
- `justify-items: start` vs `end` (#319): issue lists start as the preferred default; easy to flip later if product disagrees.
- Nothing requires a migration, backend change, or follow-up issue.

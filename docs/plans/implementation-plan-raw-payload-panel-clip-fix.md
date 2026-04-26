# Implementation Plan — RawPayloadPanel still clips tall payloads (#404)

## 1. Understand

**Goal.** Make tall payloads in `RawPayloadPanel` actually scroll on every consuming surface (Job detail, Webhook delivery, Order detail, Listing detail, Connection config). Right now the inner `<pre>` has `max-height: 520px; overflow-y: auto;` from #390/PR #395, but the outer `<section class="raw-payload">` is still capped at `24rem` (≈384px) and `overflow: hidden` — the cap clips content and the inner scrollbar lives below the cut-off, so users see truncated JSON with no usable scroll affordance.

**Layer.** Frontend / DX — CSS-only; no component, controller, port, or migration changes.

**Non-goals.**
- No redesign of the panel's collapsed/expanded UX, header, copy/expand buttons, or syntax tinting.
- No change to the `max-height: 520px` policy on the inner `<pre>` (PR #395's choice stands).
- No new "view raw" full-screen view, no scrollbar-styling polish, no `scrollbar-gutter` work — those are separate enhancements.
- No expansion of unit-test coverage at the layout level (jsdom can't observe it; no value in adding a test that doesn't fail without the fix).

## 2. Research

**The legacy rule (`apps/web/src/index.css:2604-2618`):**

```css
/* Raw payload / config display */
.raw-payload,
.config-block {
  white-space: pre-wrap;
  word-break: break-word;
  padding: 1rem;
  background: var(--bg-surface-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: 0.625rem;
  font-size: 0.8125rem;
  max-height: 24rem;
  overflow-y: auto;
  margin: 0;
}
```

This block pre-dates the BEM refactor of `RawPayloadPanel`. Before that refactor, `.raw-payload` was rendered as a single `<pre>` and these properties (padding, scroll, max-height) belonged on it. After the refactor, `.raw-payload` is the **outer `<section>`** wrapper; padding / scroll / max-height now live on `.raw-payload__body` (the inner `<pre>`) at lines 3460–3473.

**The modern rules (`index.css:3390-3473`)** correctly style the wrapper and body separately:
- `.raw-payload` (line 3392): border, radius, background, `overflow: hidden`. **No** `max-height`, no padding — both intentional.
- `.raw-payload__body` (line 3460): padding, font, `max-height: 520px`, `overflow-x/y: auto`, `overscroll-behavior: contain`.

**The cascade collision.** Both blocks set properties on `.raw-payload`. CSS specificity is identical (single class), so source order decides per-property:
- `max-height: 24rem` — only the legacy rule sets it → it wins by default. The wrapper is capped at 384px.
- `overflow: hidden` — modern rule (line 3392) overrides legacy `overflow-y: auto`. The wrapper hides anything past its 384px cap.
- `padding: 1rem`, `white-space: pre-wrap`, `word-break: break-word` — only the legacy rule sets them; they leak into the wrapper. The padding is the more visible side-effect (extra inset around the whole panel including its header).

Net effect on tall payloads: the inner `<pre>` is willing to scroll up to 520px, but its scrollbar lives at the right edge of its 520px-tall scroll area — which is below the wrapper's 384px clip. macOS hides scrollbars by default, so users see content cut off mid-line with no visible affordance and no working scroll.

**`.config-block` usage.** `grep -rn 'config-block' apps/web/src` returns **only the CSS definition itself** — no `.tsx`, no `.ts`, no test references it. It is dead code, safe to remove with the rest of the legacy block.

**Why PR #395 missed this.** That PR added a unit test for `tabIndex={0}` on the inner `<pre>` and visually verified scroll on the panel in isolation. jsdom doesn't compute layout, so the wrapper-clip problem is invisible to the test suite. Manual smoke must have happened on payloads short enough to fit the 384px legacy cap (where there's no visible bug).

## 3. Design

**Single change.** Delete the entire legacy block at `index.css:2604-2618` (15 lines including the section comment).

**Why deleting (not overriding) is correct.**
- Both selectors in the legacy block are dead — `.raw-payload` is fully covered by the modern BEM rules at lines 3390–3473; `.config-block` is unused.
- Override would leave the dead `.config-block` rule in the codebase (unused selector).
- Override would require an explicit `max-height: none` on `.raw-payload` in the modern block — pure subtraction, no semantic clarity gain over removing the source of the problem.
- Per engineering standards, prefer reusing/cleaning existing abstractions over layering new ones.

**Properties that stop applying to `.raw-payload` after the deletion** (and the impact on the rendered panel):
- `padding: 1rem` — gone. The wrapper currently has extra inset around its header + body. Removing it is desired: the modern rules already handle padding on `__header` (`10px 14px`) and `__body` (`14px`). The wrapper is meant to be a flush-bordered container. **Visual change:** every consuming surface loses ~16px of inset around the panel — slight tightening, consistent with the modern Linear/Shopify-admin look (no glow / no padded shells around panels).
- `white-space: pre-wrap`, `word-break: break-word` — gone. The wrapper doesn't render text directly (only the inner `<pre>` does). The inner `<pre>` keeps its own `white-space: pre` (line 3471), unaffected.
- `background`, `border`, `border-radius`, `margin` — overridden by the modern rule at L3392 (`var(--bg-surface)`, `var(--border-default)`, `border-radius: 10px`, default `<section>` `margin: 0`); `0.625rem` and `10px` are pixel-equivalent so the visible swap is `--bg-surface-elevated` → `--bg-surface` (lighter wrapper fill) and `--border-subtle` → `--border-default` (slightly darker stroke). Both shifts match the modern panel specification.
- `font-size: 0.8125rem` — intentionally *absent* from the modern wrapper rule (not overridden). The wrapper renders no direct text: header text comes from `.raw-payload__title` (13 px) / `.raw-payload__description` (12 px) / `.raw-payload__action` (12 px), and body text from `.raw-payload__body` (12.5 px). Removing the wrapper-level size has no visible effect on any descendant.
- `max-height: 24rem`, `overflow-y: auto` — gone. **This is the fix.** The wrapper grows to fit its body (header + up-to-520px scrollable pre); the inner `<pre>`'s scroll engages whenever payload > 520px, and its scrollbar is now inside the visible wrapper.

**Cross-surface impact.** Five consuming surfaces (`grep -l 'RawPayloadPanel' apps/web/src/**/*.tsx`):
1. `pages/sync-jobs/sync-job-detail-page.tsx` — Job detail (the screenshot in the issue)
2. `pages/webhook-deliveries/webhook-delivery-detail-page.tsx`
3. `pages/orders/order-detail-page.tsx`
4. `pages/listings/listing-detail-page.tsx`
5. `features/connections/components/ConnectionConfigPanel.tsx`

All five render `<RawPayloadPanel>` the same way (no surface customizes the wrapper); all five inherit the same fix.

## 4. Implementation Steps

### Step 1 — Delete the legacy block

**File:** `apps/web/src/index.css`
**Lines:** 2604–2618 (inclusive: section comment + the whole `.raw-payload, .config-block { … }` rule)

Acceptance:
- The block, including its leading comment `/* Raw payload / config display */`, is removed.
- The rule at line 3392 (`.raw-payload { … }`) and the rule at line 3460 (`.raw-payload__body { … }`) are unchanged.
- `grep -n '\.raw-payload,' apps/web/src/index.css` returns no matches.
- `grep -n '\.config-block' apps/web/src/index.css` returns no matches.
- `grep -rn 'config-block' apps/web/src` returns no matches anywhere.

### Step 2 — Quality gate

```
pnpm lint        # zero new errors
pnpm type-check  # zero new errors
pnpm --filter @openlinker/web test
```

Acceptance:
- All previously-passing tests still pass (674 in `@openlinker/web`).
- No new lint or type-check errors introduced (pre-existing warnings in unrelated files are out of scope).

### Step 3 — Manual smoke (all five consumers)

The change touches a primitive used on five surfaces; smoke each one to confirm both the bug fix (tall payload now scrolls inside the panel) and the absence of layout regressions (no surface visibly broken by losing the legacy `padding: 1rem`):

1. `pages/sync-jobs/sync-job-detail-page.tsx` — the screenshot's failing job
2. `pages/webhook-deliveries/webhook-delivery-detail-page.tsx`
3. `pages/orders/order-detail-page.tsx`
4. `pages/listings/listing-detail-page.tsx`
5. `features/connections/components/ConnectionConfigPanel.tsx`

Acceptance:
- For each surface: expand the Payload panel; tall payloads scroll internally up to the 520px cap; short payloads render in full without an internal scrollbar; the panel's outer border sits flush against its neighbours with no obviously-broken spacing.
- Capture before/after screenshots of the Job detail page at all three widths in `frontend-ui-style-guide.md` § Responsive — `360 × 812`, `768 × 1024`, `1440 × 900` — so any tablet- or mobile-specific fallout from removing the legacy `padding: 1rem` on the wrapper surfaces during review, not after merge. Attach to the PR body.

### Step 4 — Commit

Conventional commit:
```
fix(web): remove legacy .raw-payload max-height that re-clipped tall payloads

The pre-BEM .raw-payload + .config-block rule at index.css:2604 was still
applying max-height: 24rem to the *outer* <section> wrapper and leaving
overflow: hidden in place via the later rule at line 3392. PR #395 fixed
the inner <pre>'s scroll, but its scrollbar lived below the wrapper's
384px clip — content stayed truncated with no usable scroll affordance.

Delete the legacy block. .raw-payload now has no height cap; the inner
__body keeps max-height: 520px + overflow-y: auto from #390. Affects
all five surfaces that reuse the primitive (Job detail, Webhook delivery,
Order detail, Listing detail, Connection config).

.config-block was defined in this same legacy block but never referenced
anywhere in apps/web/src — removed alongside.

Closes #404
```

(Add the standard `Co-Authored-By: Claude Opus 4.7 (1M context)` trailer.)

### Step 5 — Push and PR

Push `404-raw-payload-panel-clip-fix` to origin, open PR with `Closes #404` in body, summary mirrors the commit message. Attach the before/after screenshot from Step 3 inline. Note in the PR body: "Follow-up — when Playwright / visual-regression infra lands, add a regression case for tall-payload scroll on `RawPayloadPanel`. This is the second `RawPayloadPanel` layout regression to slip past unit tests (after #390 / PR #395), and jsdom can't observe layout-level cascade collisions."

## 5. Validate

**Architecture.** Frontend-only CSS change; no layer, port, adapter, or module touched. No risk to hexagonal boundaries.

**Naming / standards.** No new files, no new identifiers, no new types. Existing CSS naming (`.raw-payload`, `.raw-payload__body`) preserved.

**Testing strategy.** No new tests warranted — the existing `raw-payload-panel.test.tsx` covers props, ARIA wiring, expand/collapse, copy, syntax tinting, and `tabIndex`. The bug being fixed is a layout-level cascade collision invisible to jsdom; a Playwright/visual test would catch it but #390 deliberately did not introduce one and adding browser-level testing is out of scope for a single dead-CSS-block deletion. Manual smoke on the screenshot's failing job (and one other surface) is the verification.

**Security.** None.

**Risks.**
- *Visual regression on consumers that depended on the legacy 1rem padding around the panel.* Reviewed: the wrapper is meant to be a flush-bordered container, the modern rule has no padding by design, and all five consumers render the panel inside `.detail-section` (which provides its own gap). The slight tightening is consistent with the established design system, not a regression.
- *`.config-block` was actually used somewhere I missed.* Mitigated: explicit grep across `apps/web/src` for any `.config-block` reference returns only the CSS definition itself. Safe to drop.

**Open questions.** None.

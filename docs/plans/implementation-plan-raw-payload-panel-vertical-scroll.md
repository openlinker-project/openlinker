# Implementation Plan — `RawPayloadPanel` vertical scroll fix (#390)

## 1. Goal

`RawPayloadPanel` clips content taller than its `max-height: 520px` cap because the
body element only sets `overflow-x`, not `overflow-y`. Five FE pages reuse the
component (Job detail, Webhook delivery detail, Order detail, Listing detail,
Connection config), and on each of them long payloads silently lose their bottom
half with no scrollbar to recover them. Add vertical overflow handling so the
body becomes scrollable when content exceeds the cap.

**Layer:** Frontend / `shared/ui` styling only.

**Non-goals:**
- No change to the panel's React component, its API, or its tests.
- No change to `max-height` (the 520px cap is intentional — we want a scroll, not unbounded growth).
- No change to consumers of the panel.

## 2. Research

- Component: `apps/web/src/shared/ui/raw-payload-panel.tsx` — renders a `<pre className="raw-payload__body mono-text">`. No styling lives in the TSX; the cap and overflow rules are entirely in `index.css`.
- Styles: `apps/web/src/index.css:3460-3471` — currently sets `overflow-x: auto` and `max-height: 520px`, but no `overflow-y`. Default `overflow-y: visible` lets content escape the layout box but `max-height` truncates the visible region — hence "clipped, not scrollable".
- Existing tests: `apps/web/src/shared/ui/raw-payload-panel.test.tsx` exercise behavior (open/close, aria, copy, syntax tinting). They do not import `index.css` or assert computed style — so a CSS-rule smoke test would require non-trivial test-setup changes for negligible value. Issue #390 explicitly flags such a test as optional; skip.

## 3. Design

Three small, coupled changes — the CSS fix, plus a folded-in keyboard-a11y polish that the tech-review surfaced (the `<pre>` becomes a scrollable region under this fix and should be reachable by keyboard, with a visible focus outline matching the rest of the panel's controls).

### CSS

```css
.raw-payload__body {
  /* existing rules unchanged */
  overflow-x: auto;
  overflow-y: auto;             /* NEW — vertical scroll when content > max-height */
  overscroll-behavior: contain; /* NEW — prevents wheel/touch chaining to the page */
  max-height: 520px;
}

.raw-payload__body:focus-visible {  /* NEW — visible focus when keyboard-scrolling */
  outline: 2px solid var(--accent-focus);
  outline-offset: -2px;
}
```

`auto` (not `scroll`) — no always-present gutter on short payloads. Two-axis lines kept separate for diff intent and to read alongside `max-height`. `outline-offset: -2px` keeps the outline inside the panel border so it doesn't collide with the surrounding panel chrome.

### TSX

```tsx
<pre
  id={bodyId}
  className="raw-payload__body mono-text"
  aria-label="Payload content"
  tabIndex={0}                 // NEW — make the scrollable region keyboard-reachable
  hidden={!open}
>
```

`tabIndex={0}` is the standard pattern for a custom scrollable region: once focused, browsers handle Arrow / Page Up / Page Down / Home / End natively, so no extra key handlers are needed.

## 4. Steps

1. **Edit `apps/web/src/index.css`** — add `overflow-y: auto;` and `overscroll-behavior: contain;` to the `.raw-payload__body` rule (around line 3468); add a sibling `.raw-payload__body:focus-visible` rule under it.
2. **Edit `apps/web/src/shared/ui/raw-payload-panel.tsx`** — add `tabIndex={0}` to the `<pre>`.
3. **Run quality gate:** `pnpm lint && pnpm type-check && pnpm test`.
4. **Manual verification:** open any `RawPayloadPanel` instance with content >520px (Job detail with a `marketplace.offer.create` payload is the original repro). Confirm: (a) vertical scroll works; (b) horizontal scroll still works for long lines; (c) Tab moves focus into the body and Arrow/Page keys scroll it; (d) the focus outline is visible against `var(--bg-canvas)`.

## 5. Validation

- **Architecture compliance:** styling-only change in `shared/ui` CSS, no boundary changes.
- **Naming / standards:** no new identifiers introduced.
- **Testing strategy:** existing behavior tests still apply; no new test added (JSDOM doesn't reliably exercise stylesheet rules and the issue marks it optional).
- **Security:** no surface change.
- **Risk:** zero — purely additive CSS property on an existing rule.

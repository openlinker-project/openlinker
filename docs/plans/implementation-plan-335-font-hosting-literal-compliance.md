# Implementation Plan — #335 Font-Hosting Literal Compliance

## Goal

Bring IBM Plex hosting into literal compliance with **locked decision #5** and the corresponding acceptance criterion on #335:

> IBM Plex → self-hosted woff2 subsets under `apps/web/public/fonts/`. No Google Fonts CDN. Subset: `latin` + `latin-ext`.
> AC: IBM Plex Sans + Mono render from self-hosted woff2 files under `apps/web/public/fonts/` with `LICENSE.txt` alongside.

PR #347 shipped fonts via `@fontsource/ibm-plex-{sans,mono}` npm packages, which Vite bundles from `node_modules` — self-hosted at build time, no CDN, but not under the specified path and without an accompanying `LICENSE.txt`. This plan closes that gap.

## Layer classification

**Frontend — `apps/web` static asset pipeline + `index.css` + `main.tsx` + `index.html`.** No backend, no core/shared/libs changes. No DB migrations.

## Non-goals

- Do **not** migrate the connection-detail KPI strip to `KpiCard` — explicitly deferred in PR #347 pending a `/metrics/timeseries` backend endpoint.
- Do **not** add `Chip` filter pills on the orders list — there is no pill-bar there to convert; it already uses the shared `Select` primitive. Called "optional polish, not a structural gap" in PR #347.
- Do **not** change any TSX beyond `main.tsx` and `index.html`. No page or component rewrites.

## Research findings

- Current wiring: `apps/web/src/main.tsx` imports seven `@fontsource/*/XXX.css` stylesheets. These declarations reference woff2/woff files in `node_modules/@fontsource/.../files/` which Vite inlines into the production bundle.
- `@fontsource/ibm-plex-sans` carries a BSD-style `LICENSE` file wrapping the SIL Open Font License 1.1 used by IBM Plex upstream — suitable for `LICENSE.txt`.
- Subsets used today (all weights through the `XXX.css` shortcut imports): `latin`, `latin-ext`, `cyrillic`, `cyrillic-ext`, `greek`, `vietnamese`. Decision #5 narrows this to **latin + latin-ext only** — shrinks the bundle.
- Weights required (matching `--font-sans` / `--font-mono` usage throughout the app): **sans 400 / 500 / 600 / 700** and **mono 400 / 500 / 600**. Same set as `main.tsx` imports today.
- unicode-range values come from `node_modules/@fontsource/ibm-plex-sans/unicode.json` — same for sans and mono.

## File-level implementation steps

### 1. Create `apps/web/public/fonts/` with woff2 assets + license

Copy 14 woff2 files from `node_modules/@fontsource/` into `apps/web/public/fonts/`, **mirroring the upstream filenames** (keep the `-normal` suffix) so a future re-sync from `@fontsource/*` is a straight copy with no rename:

| Source (under `node_modules/@fontsource/*/files/`) | Target (under `apps/web/public/fonts/`) |
| -------------------------------------------------- | ---------------------------------------- |
| `ibm-plex-sans/files/ibm-plex-sans-latin-{400,500,600,700}-normal.woff2`     | same filename |
| `ibm-plex-sans/files/ibm-plex-sans-latin-ext-{400,500,600,700}-normal.woff2` | same filename |
| `ibm-plex-mono/files/ibm-plex-mono-latin-{400,500,600}-normal.woff2`         | same filename |
| `ibm-plex-mono/files/ibm-plex-mono-latin-ext-{400,500,600}-normal.woff2`     | same filename |

**Weight coverage** matches the current `@fontsource/*` import set (sans 400/500/600/700, mono 400/500/600). Audit of `font-weight` declarations in `apps/web/src/` (2026-04-23) confirms all four sans weights are in use; 600 is by far the most-used (38 occurrences), followed by 500 (18), 400 (5), 700 (2).

Copy the SIL OFL text:

| Source                                                      | Target                                   |
| ------------------------------------------------------------ | ---------------------------------------- |
| `node_modules/@fontsource/ibm-plex-sans/LICENSE`             | `apps/web/public/fonts/LICENSE.txt`      |

**Acceptance:** `ls apps/web/public/fonts` shows 14 `.woff2` files + `LICENSE.txt`.

### 2. Rewrite the font wiring in `apps/web/src/index.css`

Replace the "Fonts" header-comment block with declarations that point at `/fonts/*.woff2`. Before the `:root` declaration, add:

```css
/*
 * IBM Plex — self-hosted (locked decision #5).
 * Files live under `apps/web/public/fonts/` with SIL OFL LICENSE.txt alongside.
 * Subsets: latin + latin-ext (ranges from @fontsource unicode.json).
 */

/* IBM Plex Sans — latin */
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-display: swap;
  font-weight: 400;
  src: url('/fonts/ibm-plex-sans-latin-400.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
/* ... 500 / 600 / 700 ... */

/* IBM Plex Sans — latin-ext */
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-display: swap;
  font-weight: 400;
  src: url('/fonts/ibm-plex-sans-latin-ext-400.woff2') format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
}
/* ... 500 / 600 / 700 ... */

/* IBM Plex Mono — latin (400 / 500 / 600) and latin-ext (400 / 500 / 600) */
```

Total: 14 `@font-face` blocks. The existing comment at lines ~35-38 referencing `@fontsource/*` is removed.

**Acceptance:** `grep '@font-face' apps/web/src/index.css` returns 14 matches.

### 3. Preload the critical weights in `apps/web/index.html`

Insert three preload links inside `<head>`, after the inline FOUC-guard `<script>` block (lines 8-25) and before `</head>`. Preload set chosen from the weight audit:

- **sans 400** — body text, covers most viewport area
- **sans 600** — nav group labels, page titles, section headings, status badges (heaviest-used weight at 38 occurrences; preloading it eliminates FOUT on first-paint headings)
- **mono 400** — identifiers, timestamps, numeric columns

```html
<link rel="preload" href="/fonts/ibm-plex-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin />
<link rel="preload" href="/fonts/ibm-plex-sans-latin-600-normal.woff2" as="font" type="font/woff2" crossorigin />
<link rel="preload" href="/fonts/ibm-plex-mono-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin />
```

**Why `crossorigin` is mandatory:** without it, browsers treat the preload as a different request than the eventual `@font-face` fetch and refuse to reuse the cached bytes — the preload silently becomes a second download.

**Acceptance:** browser Network panel shows all three woff2 requests start before JS, not after (manual verification during dev).

### 4. Drop `@fontsource/*` imports from `apps/web/src/main.tsx`

Delete the seven `import '@fontsource/...'` lines and the adjacent comment. `main.tsx` no longer touches fonts.

**Acceptance:** `grep '@fontsource' apps/web/src/main.tsx` returns nothing.

### 5. Drop `@fontsource/*` deps from `apps/web/package.json`

Remove `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-mono` from `dependencies`. Re-run `pnpm install` so the lockfile catches up.

**Acceptance:** `pnpm why @fontsource/ibm-plex-sans` from repo root returns no results.

### 6. Document the change in `docs/frontend-ui-style-guide.md`

**Two locations need updating** — both currently describe the old wiring:

1. **`## Direction (FE-002)` — Type pairing (~line 40):**
   > **Type pairing:** … Loaded via `@import` in `index.css`; fall back to system sans.

   Replace the trailing sentence with:
   > Self-hosted under `apps/web/public/fonts/` with SIL OFL `LICENSE.txt` alongside; `@font-face` declarations in `index.css` scope the subset to `latin` + `latin-ext`. Falls back to system sans.

2. **`## Typography` — Font-loading note (~line 311):**
   > Loaded via `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-mono` imported from `apps/web/src/main.tsx` — self-hosted woff2 bundled by Vite, no Google Fonts CDN at runtime. `font-display: swap` is configured by the packages.

   Replace with:
   > IBM Plex Sans + Mono ship as self-hosted woff2 files under `apps/web/public/fonts/` with the SIL OFL `LICENSE.txt` alongside. `@font-face` declarations in `src/index.css` scope the subset to `latin` + `latin-ext` and set `font-display: swap`. The hot-path weights (sans 400, sans 600, mono 400) are `<link rel="preload">`'d from `index.html` to eliminate FOUT on first paint. No external font CDN is consulted at runtime.

**Acceptance:** `grep -n "fontsource\|@import" docs/frontend-ui-style-guide.md` returns no matches in the prose (only in historical / archived context, if any).

### 7. Quality gate

Run in the worktree:

```bash
pnpm lint
pnpm type-check
pnpm --filter @openlinker/web test
pnpm --filter @openlinker/web build   # smoke — confirm Vite still resolves everything and copies public/fonts/ to dist/fonts/
```

All must be green.

**No automated test covers this change.** Font hosting is CSS + static assets — Jest/Vitest can't meaningfully assert on `@font-face` declarations or woff2 bytes. Coverage is the Vite build smoke above plus the manual verification below. This is deliberate, not a gap.

**Manual verification (Phase 5 — review):**
- Start dev server, hard-refresh, confirm text renders in IBM Plex Sans / Mono (not the fallback `ui-sans-serif` / `ui-monospace`).
- Toggle Light / Dark / System from the user-chip dropdown — no FOUC or font-flash.
- Check Network panel: woff2 served from `/fonts/` on same origin, `Content-Type: font/woff2`, `200 OK`. All three preloaded files show `priority: High` and fire before the main JS bundle.
- **Three-breakpoint visual check** (satisfies #335 AC #10): hard-refresh at 360 × 812, 768 × 1024, 1440 × 900. Confirm headings, nav labels, and numeric columns still render in Plex — no regression vs. pre-change.

## Risks and mitigations

| Risk | Likelihood | Mitigation |
| ---- | ---------- | ---------- |
| `crossorigin` attribute missing on preload → browser refuses to reuse the preloaded font for the eventual `@font-face` request. | Medium — easy to miss. | Always include `crossorigin` on `rel="preload"` for fonts. Verified in Step 3. |
| Vite doesn't copy `public/fonts/*.woff2` to `dist/fonts/`. | Low — Vite copies `public/` by default. | `build` smoke-check in Step 7. |
| Tests relying on `@fontsource/*` module resolution. | Very low — `@fontsource` only emits CSS imports, never JS identifiers. | Full test suite in Step 7. |
| Missing `LICENSE.txt` → upstream license violation. | High impact if missed. | Explicit file in Step 1. |
| `font-display: swap` causes a visible fallback flash on slow networks. | Low | Preload mitigates for 400 weights. Other weights degrade gracefully (swap) — acceptable given the 22–24 KB per file. |

## Bundle-size expectation

Net-net **smaller** than the current `@fontsource/*` approach because we drop the cyrillic / greek / vietnamese subsets. woff2 is already compressed so gzip barely helps it further — actual sizes vary per weight/subset but every combination fits comfortably under the 700 KB gzipped budget in the #335 AC. Vite build output will show the exact bytes in the `dist/` smoke check.

## Out-of-scope items documented in #335 (kept open)

- Connection-detail KPI strip (needs `/metrics/timeseries` backend)
- Orders-list filter chips (no pill-bar to convert — issue can be closed on this point alone)
- #316, #320 full, #321, #326, #327, #333 — tracked separately per PR #347

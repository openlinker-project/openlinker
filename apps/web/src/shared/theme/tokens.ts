/**
 * Design Tokens
 *
 * Typed catalog of every public design token defined in
 * `apps/web/src/index.css` (#611). The catalog is the contract plugin
 * authors and future host code bind against for TS-side discovery and
 * typed inline styles.
 *
 * **Consumption model**: component CSS continues to write
 * `var(--name)` directly against `index.css` — this catalog does NOT
 * replace that path and isn't loaded by the runtime CSS engine. It's
 * for:
 *
 *   - Plugin authors who need a typed list of supported token names.
 *   - Inline styles in TS (`style={{ background: tokens['bg-canvas'] }}`).
 *   - Discoverability (autocomplete + go-to-definition).
 *
 * **Drift guarantee**: `scripts/check-design-tokens.mjs` runs under
 * `pnpm lint` and fails if any token in this file is missing from
 * `index.css`. Adding a new token: declare it in `index.css` first, then
 * add an entry here. Removing one: drop both sides in the same PR.
 *
 * Groups mirror the structure in `index.css` (`:root` block) so the file
 * stays scannable as the catalog grows.
 *
 * @module shared/theme
 */

export const tokens = {
  // ── Typography ──────────────────────────────────────────────────
  'font-sans': 'var(--font-sans)',
  'font-mono': 'var(--font-mono)',

  // ── Spacing (4px grid) ──────────────────────────────────────────
  'space-1': 'var(--space-1)',
  'space-2': 'var(--space-2)',
  'space-3': 'var(--space-3)',
  'space-4': 'var(--space-4)',
  'space-5': 'var(--space-5)',
  'space-6': 'var(--space-6)',
  'space-7': 'var(--space-7)',
  'space-8': 'var(--space-8)',

  // ── Radii ───────────────────────────────────────────────────────
  'radius-xs': 'var(--radius-xs)',
  'radius-sm': 'var(--radius-sm)',
  'radius-md': 'var(--radius-md)',
  'radius-lg': 'var(--radius-lg)',
  'radius-xl': 'var(--radius-xl)',
  'radius-pill': 'var(--radius-pill)',

  // ── Shadows ─────────────────────────────────────────────────────
  'shadow-xs': 'var(--shadow-xs)',
  'shadow-sm': 'var(--shadow-sm)',
  'shadow-md': 'var(--shadow-md)',
  'shadow-lg': 'var(--shadow-lg)',
  'shadow-soft': 'var(--shadow-soft)',
  'shadow-soft-hover': 'var(--shadow-soft-hover)',
  'shadow-overlay': 'var(--shadow-overlay)',
  'shadow-focus': 'var(--shadow-focus)',
  'shadow-inset-top': 'var(--shadow-inset-top)',

  // ── Motion ──────────────────────────────────────────────────────
  'duration-fast': 'var(--duration-fast)',
  'duration-normal': 'var(--duration-normal)',
  'duration-slow': 'var(--duration-slow)',
  'ease-out': 'var(--ease-out)',
  'ease-standard': 'var(--ease-standard)',
  'ease-in-out': 'var(--ease-in-out)',

  // ── Tracking (letter-spacing) ───────────────────────────────────
  'tracking-tight': 'var(--tracking-tight)',
  'tracking-normal': 'var(--tracking-normal)',
  'tracking-wide': 'var(--tracking-wide)',
  'tracking-caps': 'var(--tracking-caps)',

  // ── Backgrounds ─────────────────────────────────────────────────
  'bg-canvas': 'var(--bg-canvas)',
  'bg-shell': 'var(--bg-shell)',
  'bg-surface': 'var(--bg-surface)',
  'bg-surface-elevated': 'var(--bg-surface-elevated)',
  'bg-surface-muted': 'var(--bg-surface-muted)',
  'bg-surface-hover': 'var(--bg-surface-hover)',
  'bg-muted': 'var(--bg-muted)',
  'bg-strong': 'var(--bg-strong)',
  'overlay-scrim': 'var(--overlay-scrim)',

  // ── Borders ─────────────────────────────────────────────────────
  'border-subtle': 'var(--border-subtle)',
  'border-default': 'var(--border-default)',
  'border-strong': 'var(--border-strong)',
  'border-focus': 'var(--border-focus)',

  // ── Text ────────────────────────────────────────────────────────
  'text-primary': 'var(--text-primary)',
  'text-secondary': 'var(--text-secondary)',
  'text-muted': 'var(--text-muted)',
  'text-disabled': 'var(--text-disabled)',
  'text-inverse': 'var(--text-inverse)',
  'text-on-primary': 'var(--text-on-primary)',
  'text-link': 'var(--text-link)',

  // ── Accent (signal orange — see #775) ───────────────────────────
  'accent-primary': 'var(--accent-primary)',
  'accent-primary-hover': 'var(--accent-primary-hover)',
  'accent-primary-active': 'var(--accent-primary-active)',
  'accent-primary-soft': 'var(--accent-primary-soft)',
  'accent-primary-soft-strong': 'var(--accent-primary-soft-strong)',
  'accent-primary-border': 'var(--accent-primary-border)',
  'accent-focus': 'var(--accent-focus)',
  'accent-ring': 'var(--accent-ring)',

  // ── Button-specific ─────────────────────────────────────────────
  'button-primary-bg-hover': 'var(--button-primary-bg-hover)',

  // ── Status — success ────────────────────────────────────────────
  'status-success': 'var(--status-success)',
  'status-success-strong': 'var(--status-success-strong)',
  'status-success-soft': 'var(--status-success-soft)',
  'status-success-border': 'var(--status-success-border)',
  'status-success-fg': 'var(--status-success-fg)',

  // ── Status — warning ────────────────────────────────────────────
  'status-warning': 'var(--status-warning)',
  'status-warning-strong': 'var(--status-warning-strong)',
  'status-warning-soft': 'var(--status-warning-soft)',
  'status-warning-border': 'var(--status-warning-border)',
  'status-warning-fg': 'var(--status-warning-fg)',

  // ── Status — error ──────────────────────────────────────────────
  'status-error': 'var(--status-error)',
  'status-error-strong': 'var(--status-error-strong)',
  'status-error-soft': 'var(--status-error-soft)',
  'status-error-border': 'var(--status-error-border)',
  'status-error-fg': 'var(--status-error-fg)',

  // ── Status — info ───────────────────────────────────────────────
  'status-info': 'var(--status-info)',
  'status-info-strong': 'var(--status-info-strong)',
  'status-info-soft': 'var(--status-info-soft)',
  'status-info-border': 'var(--status-info-border)',
  'status-info-fg': 'var(--status-info-fg)',

  // ── Viz — categorical series (#1739) ─────────────────────────────
  'viz-cat-1': 'var(--viz-cat-1)',
  'viz-cat-2': 'var(--viz-cat-2)',
  'viz-cat-3': 'var(--viz-cat-3)',
  'viz-cat-4': 'var(--viz-cat-4)',
  'viz-cat-muted': 'var(--viz-cat-muted)',

  // ── Channel brand hues (#1752) ───────────────────────────────────
  'channel-allegro': 'var(--channel-allegro)',
  'channel-prestashop': 'var(--channel-prestashop)',
  'channel-erli': 'var(--channel-erli)',
  'channel-woocommerce': 'var(--channel-woocommerce)',
  'channel-amazon': 'var(--channel-amazon)',
  'channel-shopify': 'var(--channel-shopify)',

  // ── Status — review (manual review / pending operator action) ───
  'status-review': 'var(--status-review)',
  'status-review-strong': 'var(--status-review-strong)',
  'status-review-soft': 'var(--status-review-soft)',
  'status-review-border': 'var(--status-review-border)',
  'status-review-fg': 'var(--status-review-fg)',

  // ── Status — conflict ───────────────────────────────────────────
  'status-conflict': 'var(--status-conflict)',
  'status-conflict-strong': 'var(--status-conflict-strong)',
  'status-conflict-soft': 'var(--status-conflict-soft)',
  'status-conflict-border': 'var(--status-conflict-border)',

  // ── Status — disabled ───────────────────────────────────────────
  'status-disabled': 'var(--status-disabled)',
  'status-disabled-strong': 'var(--status-disabled-strong)',
  'status-disabled-soft': 'var(--status-disabled-soft)',
  'status-disabled-border': 'var(--status-disabled-border)',
  'status-disabled-fg': 'var(--status-disabled-fg)',
} as const satisfies Record<string, `var(--${string})`>;

/**
 * Union of every token name in the catalog. Plugin authors and host code
 * use this as the input type for any utility that takes a token name —
 * `style({ tokens['bg-canvas'] })` is the canonical inline-style form,
 * but `function applyToken(name: TokenName)` is the contract.
 */
export type TokenName = keyof typeof tokens;

/**
 * Help Links (#81)
 *
 * One small config map from a surface key to a `docs.openlinker.io` page, so
 * a moved docs page is fixed in one place rather than hunted down across
 * every screen that links to it. `HelpLink` (`shared/ui/help-link.tsx`) reads
 * this map; nothing renders a docs URL that isn't listed here.
 *
 * Every entry resolves to a SPECIFIC page, never the docs homepage — the
 * point of a contextual link is that it answers the question this screen
 * raises, not that it dumps the operator at a table of contents.
 *
 * **Anchor honesty (2026-09).** `docs.openlinker.io` is a curated static
 * build, not a 1:1 mirror of this repo's `docs/` tree — a live check found
 * exactly four published top-level pages (`getting-started`, `demo-setup`,
 * `plugin-author-guide`, `architecture-overview`); a same-named root file
 * elsewhere in `docs/` (e.g. `docs/sales-documents-how-routing-decides.md`)
 * 404s. `architecture-overview` is this repo's single largest and most
 * current reference doc, so every surface below links into it. Two of the
 * five link to a SECTION anchor that already exists in `docs/architecture-
 * overview.md` on this branch (`§ 17 Sales Documents`, `§ 20 Fulfillment
 * Authority`) — the live site's published copy lagged behind at check time
 * and had neither section yet, so the anchor is a well-founded bet on the
 * site catching up post-merge (the slug format itself IS confirmed live:
 * `## 11. Logging & Monitoring` on the published page resolves at
 * `#11-logging--monitoring`, and the same numbering + slugify rule is
 * applied here). The remaining three surfaces (mailer, rate limit, stock &
 * pricing) have no dedicated heading anywhere in `docs/` yet, so they link
 * to the `architecture-overview` page itself rather than a guessed anchor —
 * still a specific, relevant page, honest about not yet having its own
 * section. Giving each of those three a real anchor is docs-authoring work,
 * explicitly out of scope for this (frontend-only) issue.
 *
 * @module apps/web/src/shared/lib
 */

export const HELP_SURFACE_KEYS = [
  'sales-documents-routing',
  'who-decides',
  'mailer-settings',
  'connection-rate-limit',
  'connection-stock-and-pricing',
] as const;

export type HelpSurfaceKey = (typeof HELP_SURFACE_KEYS)[number];

const ARCHITECTURE_OVERVIEW = 'https://docs.openlinker.io/architecture-overview/';

export const HELP_LINKS: Readonly<Record<HelpSurfaceKey, string>> = {
  'sales-documents-routing': `${ARCHITECTURE_OVERVIEW}#17-sales-documents`,
  'who-decides': `${ARCHITECTURE_OVERVIEW}#20-fulfillment-authority`,
  'mailer-settings': ARCHITECTURE_OVERVIEW,
  'connection-rate-limit': ARCHITECTURE_OVERVIEW,
  'connection-stock-and-pricing': ARCHITECTURE_OVERVIEW,
};

/** The accessible label rendered for each surface's link. */
export const HELP_LINK_LABELS: Readonly<Record<HelpSurfaceKey, string>> = {
  'sales-documents-routing': 'Help: how sales document routing works',
  'who-decides': 'Help: how fulfilment authority is decided',
  'mailer-settings': 'Help: mailer settings',
  'connection-rate-limit': 'Help: connection rate limiting',
  'connection-stock-and-pricing': 'Help: stock and pricing controls',
};

/**
 * Help Links (#81)
 *
 * One small config map from a surface key to a section of a `docs.openlinker.io`
 * page, so a moved docs section is fixed in one place rather than hunted down
 * across every screen that links to it. `HelpLink` (`shared/ui/help-link.tsx`)
 * reads this map; nothing renders a docs URL that isn't listed here.
 *
 * Every entry names a PAGE and an ANCHOR, never a bare page: the point of a
 * contextual link is that it answers the question this screen raises, and a
 * link that lands on the top of a long page answers nothing. A surface with no
 * section to point at gets no icon (the mailer dialog, today) rather than a
 * link to a page's top.
 *
 * The site (`openlinker-project/openlinker-docs`, Astro + Starlight) builds
 * each page from a file in THIS repo, fetched from `main` at deploy time, and
 * slugs every heading the github-slugger way (`### 17. Sales Documents` →
 * `#17-sales-documents`). `scripts/check-help-links.mjs` therefore checks
 * every anchor below against the source markdown on the same commit, under
 * `pnpm check:invariants`; a renamed or renumbered heading fails the build
 * instead of silently landing the operator on the top of the page.
 *
 * @module apps/web/src/shared/lib
 */

export const HELP_SURFACE_KEYS = [
  'sales-documents-routing',
  'who-decides',
  'connection-rate-limit',
  'connection-stock-and-pricing',
] as const;

export type HelpSurfaceKey = (typeof HELP_SURFACE_KEYS)[number];

/** A docs-site page (its route, as the docs repo's SOURCES map names it) and a heading anchor on it. */
export interface HelpLinkTarget {
  page: string;
  anchor: string;
}

const DOCS_ORIGIN = 'https://docs.openlinker.io';

/** Read by `scripts/check-help-links.mjs`: keep each entry on one line, `page` before `anchor`. */
export const HELP_LINK_TARGETS: Readonly<Record<HelpSurfaceKey, HelpLinkTarget>> = {
  'sales-documents-routing': { page: 'architecture-overview', anchor: '17-sales-documents' },
  'who-decides': { page: 'architecture-overview', anchor: '20-fulfillment-authority' },
  // The only outbound-rate-limit section in the docs is PrestaShop's; its
  // defaults are PrestaShop's, but the two fields it explains are the same on
  // every connection.
  'connection-rate-limit': { page: 'integrations/prestashop', anchor: 'outbound-rate-limit' },
  'connection-stock-and-pricing': { page: 'architecture-overview', anchor: '3-inventory' },
};

export const HELP_LINKS: Readonly<Record<HelpSurfaceKey, string>> = Object.fromEntries(
  HELP_SURFACE_KEYS.map((key) => {
    const { page, anchor } = HELP_LINK_TARGETS[key];
    return [key, `${DOCS_ORIGIN}/${page}/#${anchor}`];
  })
) as Record<HelpSurfaceKey, string>;

/** The accessible label rendered for each surface's link. */
export const HELP_LINK_LABELS: Readonly<Record<HelpSurfaceKey, string>> = {
  'sales-documents-routing': 'Help: how sales document routing works',
  'who-decides': 'Help: how fulfilment authority is decided',
  'connection-rate-limit': 'Help: connection rate limiting',
  'connection-stock-and-pricing': 'Help: stock and pricing controls',
};

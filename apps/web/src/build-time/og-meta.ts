/**
 * Open Graph / Twitter Card + search-indexing meta resolution (#2174, #3709)
 *
 * Build-time only: resolves the `%TOKEN%` placeholders in `index.html` from the
 * three `VITE_OG_*` inputs plus `VITE_OL_SEO_INDEXABLE`. The admin SPA is a
 * private operator tool, so every build is `noindex` unless it opts in — which
 * only the public demo does. Robots must be decided here, in the served HTML:
 * search engines skip rendering a page whose initial markup says `noindex`, so
 * the runtime demo-mode flag (`/v1/system/config`) can never lift it.
 *
 * Deliberately kept out of `vite.config.ts` so the
 * behaviour is unit-testable — the config module reads `import.meta.url`, which
 * is not a `file:` URL under the test environment, so importing it from a spec
 * is not viable. Nothing in the application imports this module, so it never
 * reaches the bundle.
 *
 * It also stays free of Node built-ins on purpose: that is what lets both the
 * config (node project) and the spec (app project) import it.
 *
 * @module build
 */

/** The build-time inputs, as `loadEnv` hands them over. */
export interface OgMetaEnv {
  VITE_OG_TITLE_PREFIX?: string;
  VITE_OG_BADGE_TEXT?: string;
  VITE_OG_SITE_URL?: string;
  /** `'true'` makes the build indexable — honoured only with `VITE_OG_SITE_URL` set. */
  VITE_OL_SEO_INDEXABLE?: string;
}

const ADMIN_PAGE_TITLE = 'OpenLinker Admin';
const ADMIN_PAGE_DESCRIPTION = 'E-commerce orchestration platform';
const DEMO_PAGE_TITLE = 'OpenLinker Demo – open-source e-commerce orchestration platform';
const DEMO_PAGE_DESCRIPTION =
  'Live read-only demo of OpenLinker, the open-source, self-hosted platform that syncs orders, inventory and listings between your shop and marketplaces.';

/** Un-badged production share card. */
const OG_IMAGE_PATH = '/og-image.png';

/**
 * Pre-rendered card carrying the corner badge. The badge is baked into the PNG
 * because scrapers fetch `og:image` as raw bytes and never run JS/CSS, so it
 * cannot be drawn live.
 */
const OG_IMAGE_DEMO_PATH = '/og-image-demo.png';

/**
 * The OG values land inside `content="…"` attributes, and the prefix is
 * operator-supplied at build time — a value carrying a quote would otherwise
 * terminate the attribute and break the markup.
 */
export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Resolved, already-escaped substitution values for one build. */
export interface ResolvedOgMeta {
  titlePrefix: string;
  imageUrl: string;
  urlTag: string;
  pageTitle: string;
  pageDescription: string;
  robotsTag: string;
  canonicalTag: string;
}

export function resolveOgMeta(env: OgMetaEnv): ResolvedOgMeta {
  const titlePrefix = env.VITE_OG_TITLE_PREFIX ?? '';

  // The operator-facing knob is the badge's own TEXT and the image path is
  // derived from it — an env surface that stays semantic instead of leaking
  // asset filenames.
  const badgeText = env.VITE_OG_BADGE_TEXT ?? '';
  const imagePath = badgeText ? OG_IMAGE_DEMO_PATH : OG_IMAGE_PATH;

  // The Open Graph protocol specifies ABSOLUTE urls for `og:image`; several
  // scrapers (LinkedIn among them) do not reliably resolve a root-relative one,
  // which is the "no preview renders" symptom this whole change exists to fix.
  // The origin is not knowable at build time, so it is a third build arg —
  // unset keeps the pre-existing relative path rather than guessing.
  const siteUrl = (env.VITE_OG_SITE_URL ?? '').replace(/\/+$/, '');
  const imageUrl = siteUrl ? `${siteUrl}${imagePath}` : imagePath;

  // Emitted only with a known origin: an `og:url` pointing at a relative path
  // is worse than none, since a scraper resolves it against whatever page it
  // happens to be crawling.
  const urlTag = siteUrl
    ? `<meta property="og:url" content="${escapeHtmlAttribute(`${siteUrl}/`)}" />`
    : '';

  // Requiring the origin too keeps the canonical absolute: an indexable page
  // with a relative (or no) canonical would invite exactly the duplicate-URL
  // ambiguity the opt-in is meant to avoid.
  const indexable = env.VITE_OL_SEO_INDEXABLE === 'true' && siteUrl !== '';
  const robotsTag = indexable
    ? '<meta name="robots" content="index, follow" />'
    : '<meta name="robots" content="noindex, nofollow" />';
  const canonicalTag = indexable
    ? `<link rel="canonical" href="${escapeHtmlAttribute(`${siteUrl}/`)}" />`
    : '';

  return {
    titlePrefix: escapeHtmlAttribute(titlePrefix),
    imageUrl: escapeHtmlAttribute(imageUrl),
    urlTag,
    pageTitle: indexable ? DEMO_PAGE_TITLE : ADMIN_PAGE_TITLE,
    pageDescription: indexable ? DEMO_PAGE_DESCRIPTION : ADMIN_PAGE_DESCRIPTION,
    robotsTag,
    canonicalTag,
  };
}

/**
 * Replaces a whole-line token (passed WITH its `%` delimiters, so the literal
 * stays greppable for head-manifest.test.ts) with `tag`, or drops the line
 * when `tag` is empty.
 */
function replaceTagLine(html: string, token: `%${string}%`, tag: string): string {
  // Consumes the whole line so an absent tag leaves no blank gap; the captured
  // indent keeps the emitted tag aligned.
  const pattern = new RegExp(`([ \\t]*)${token}[ \\t]*\\r?\\n`, 'g');
  return html.replace(pattern, (_match, indent: string) => (tag ? `${indent}${tag}\n` : ''));
}

/** Substitutes every OG / indexing token in the source `index.html`. */
export function renderOgMeta(html: string, env: OgMetaEnv): string {
  const { titlePrefix, imageUrl, urlTag, pageTitle, pageDescription, robotsTag, canonicalTag } =
    resolveOgMeta(env);

  let out = html
    .replace(/%OG_TITLE_PREFIX%/g, () => titlePrefix)
    .replace(/%OG_IMAGE_URL%/g, () => imageUrl)
    .replace(/%PAGE_TITLE%/g, () => pageTitle)
    .replace(/%PAGE_DESCRIPTION%/g, () => pageDescription);
  out = replaceTagLine(out, '%OG_URL_TAG%', urlTag);
  out = replaceTagLine(out, '%ROBOTS_TAG%', robotsTag);
  out = replaceTagLine(out, '%CANONICAL_TAG%', canonicalTag);
  return out;
}

/**
 * The Vite plugin, typed structurally so this module needs no `vite` import
 * (and therefore no dependency the app project would have to resolve).
 */
export function createOgMetaPlugin(env: OgMetaEnv): {
  name: 'og-meta';
  transformIndexHtml: (html: string) => string;
} {
  return {
    name: 'og-meta',
    transformIndexHtml: (html: string): string => renderOgMeta(html, env),
  };
}

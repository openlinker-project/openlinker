/**
 * Open Graph / Twitter Card meta resolution (#2174)
 *
 * Build-time only: resolves the `%TOKEN%` placeholders in `index.html` from the
 * three `VITE_OG_*` inputs. Deliberately kept out of `vite.config.ts` so the
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
}

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

  return {
    titlePrefix: escapeHtmlAttribute(titlePrefix),
    imageUrl: escapeHtmlAttribute(imageUrl),
    urlTag,
  };
}

/** Substitutes every OG token in the source `index.html`. */
export function renderOgMeta(html: string, env: OgMetaEnv): string {
  const { titlePrefix, imageUrl, urlTag } = resolveOgMeta(env);

  return (
    html
      .replace(/%OG_TITLE_PREFIX%/g, titlePrefix)
      .replace(/%OG_IMAGE_URL%/g, imageUrl)
      // Consumes the whole line so an absent origin leaves no blank gap; the
      // captured indent keeps the emitted tag aligned.
      .replace(/([ \t]*)%OG_URL_TAG%[ \t]*\r?\n/g, (_match, indent: string) =>
        urlTag ? `${indent}${urlTag}\n` : ''
      )
  );
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

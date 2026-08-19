import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Anchored on the config file itself, not `process.cwd()`: the build is
// invoked both from the package dir (`pnpm --filter`) and from the repo root,
// and only one of those makes a cwd-relative env lookup find `.env*`.
const CONFIG_DIR = fileURLToPath(new URL('.', import.meta.url));

/**
 * The OG values land inside `content="…"` attributes, and the prefix is
 * operator-supplied at build time — a value carrying a quote would otherwise
 * terminate the attribute and break the markup.
 */
function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default defineConfig(({ mode }) => {
  // #2174: every OG token is resolved HERE rather than through Vite's native
  // `%VITE_FOO%` HTML substitution, because that path needs the variable to
  // exist — and an unset one is only a WARNING, so the build stays green and
  // ships the literal `%VITE_OG_TITLE_PREFIX%` into the share card. Defaulting
  // in code makes the production shape independent of whether any `.env` file
  // reached the builder, which the Docker build context (root `.dockerignore`
  // excludes `.env.*`) guarantees it did not.
  //
  // `loadEnv` already folds prefix-matching `process.env` entries over the
  // `.env*` files, so a `--build-arg`-supplied value wins with no extra
  // precedence handling here.
  const env = loadEnv(mode, CONFIG_DIR, 'VITE_');

  const ogTitlePrefix = env.VITE_OG_TITLE_PREFIX ?? '';

  // The corner "Demo" badge is baked into a static PNG (scrapers fetch
  // `og:image` as raw bytes and never execute JS/CSS), so the operator-facing
  // knob is the badge's own TEXT and the image path is derived from it — an
  // env surface that stays semantic instead of leaking asset filenames.
  const ogBadgeText = env.VITE_OG_BADGE_TEXT ?? '';
  const ogImagePath = ogBadgeText ? '/og-image-demo.png' : '/og-image.png';

  // The Open Graph protocol specifies ABSOLUTE urls for `og:image`; several
  // scrapers (LinkedIn among them) do not reliably resolve a root-relative
  // one, which is the "no preview renders" symptom this whole change exists
  // to fix. The origin is not knowable at build time, so it is a third build
  // arg — unset keeps the pre-existing relative path rather than guessing.
  const ogSiteUrl = (env.VITE_OG_SITE_URL ?? '').replace(/\/+$/, '');
  const ogImageUrl = ogSiteUrl ? `${ogSiteUrl}${ogImagePath}` : ogImagePath;

  // Emitted only with a known origin: an `og:url` pointing at a relative path
  // is worse than none, since a scraper resolves it against whatever page it
  // happens to be crawling.
  const ogUrlTag = ogSiteUrl
    ? `<meta property="og:url" content="${escapeHtmlAttribute(`${ogSiteUrl}/`)}" />`
    : '';

  return {
    plugins: [
      react(),
      {
        name: 'og-meta',
        transformIndexHtml(html: string): string {
          return (
            html
              .replace(/%OG_TITLE_PREFIX%/g, escapeHtmlAttribute(ogTitlePrefix))
              .replace(/%OG_IMAGE_URL%/g, escapeHtmlAttribute(ogImageUrl))
              // Consumes the whole line so an absent origin leaves no blank
              // gap; the captured indent keeps the emitted tag aligned.
              .replace(/([ \t]*)%OG_URL_TAG%[ \t]*\r?\n/g, (_match, indent: string) =>
                ogUrlTag ? `${indent}${ogUrlTag}\n` : ''
              )
          );
        },
      },
    ],
    server: {
      port: 4173,
    },
    test: {
      environment: 'happy-dom',
      // Self-hosted CI runner (added 2026-04 via 444244f) is materially slower
      // than ubuntu-latest; RTL tests with multiple async state transitions
      // (wizards, dialogs + API calls, nested queries) can exceed the 5000ms
      // vitest default. Local runs complete in 2–3s per test; CI stretches
      // each transform/import pass by ~20×. Bumping to 10s keeps hangs
      // failing visibly while accommodating the runner.
      testTimeout: 10000,
      teardownTimeout: 10000,
      setupFiles: './src/test/setup.ts',
      css: true,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html'],
      },
    },
  };
});

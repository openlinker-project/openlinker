/// <reference types="node" />
// Narrow escape hatch: the app tsconfig exposes `vite/client` types only, but
// this test reads disk directly, so it needs Node built-ins. The reference
// scopes Node types to this file instead of widening `tsconfig.app.json`.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Resolves to `apps/web/` regardless of where vitest is invoked from.
const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const INDEX_HTML = join(WEB_ROOT, 'index.html');
const OG_META_MODULE = join(WEB_ROOT, 'src', 'build-time', 'og-meta.ts');
const PUBLIC_DIR = join(WEB_ROOT, 'public');

/**
 * The `%TOKEN%` placeholders `index.html` is allowed to contain, all of them
 * resolved by the `og-meta` plugin in src/build-time/og-meta.ts.
 *
 * This list is the guard: a `%VITE_FOO%`-shaped token relies on Vite's native
 * env substitution, which only WARNS when the variable is unset and ships the
 * literal token into the built HTML. That shipped a raw
 * `%VITE_OG_TITLE_PREFIX%` into production share cards once already (#2175
 * review) — a green build, a broken card. Anything not listed here is assumed
 * to be that mistake.
 */
const ALLOWED_HTML_TOKENS = ['OG_TITLE_PREFIX', 'OG_IMAGE_URL', 'OG_URL_TAG'];

/** Every `%TOKEN%` occurrence in the source HTML, deduplicated. */
function extractHtmlTokens(html: string): string[] {
  // Deliberately narrower than Vite's own `%(\S+?)%` so a literal percent in
  // prose (e.g. "100% width") cannot masquerade as a token.
  const found = new Set<string>();
  for (const match of html.matchAll(/%([A-Z][A-Z0-9_]*)%/g)) {
    found.add(match[1]);
  }
  return [...found];
}

/**
 * Root-relative OG/Twitter image paths the build can emit. Collected from BOTH
 * files because the path moved out of the markup and into the plugin: today
 * `index.html` carries a token and src/build-time/og-meta.ts carries the two
 * literals, but a future inline path in the markup must stay covered too.
 */
function extractOgImagePaths(html: string, ogMetaModule: string): string[] {
  const found = new Set<string>();

  const metaPattern = /<meta\s+[^>]*\b(?:property|name)\s*=\s*["'](?:og|twitter):image["'][^>]*>/gi;
  for (const match of html.matchAll(metaPattern)) {
    const content = /\bcontent\s*=\s*["']([^"']+)["']/i.exec(match[0])?.[1];
    if (content?.startsWith('/')) {
      found.add(content);
    }
  }

  for (const match of ogMetaModule.matchAll(/['"](\/[^'"]*og-image[^'"]*\.png)['"]/g)) {
    found.add(match[1]);
  }

  return [...found];
}

/**
 * Root-relative icon paths declared in the document head (`rel="icon"`,
 * `rel="apple-touch-icon"`).
 *
 * These need the same existence check the og:image paths get, for a sharper
 * reason: nginx.conf's SPA fallback (`try_files $uri $uri/ /index.html`)
 * answers a missing icon with index.html at HTTP 200, so the browser quietly
 * discards non-image HTML and paints its default placeholder. That is how
 * `index.html` shipped a link to a `/favicon.svg` that was never in public/
 * (#2182) - a green build, a blank tab, and nothing in the access log.
 */
function extractIconPaths(html: string): string[] {
  const found = new Set<string>();

  const linkPattern =
    /<link\s+[^>]*\brel\s*=\s*["'](?:icon|apple-touch-icon|shortcut icon|mask-icon)["'][^>]*>/gi;
  for (const match of html.matchAll(linkPattern)) {
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(match[0])?.[1];
    if (href?.startsWith('/')) {
      found.add(href);
    }
  }

  return [...found];
}

describe('og meta manifest', () => {
  const html = readFileSync(INDEX_HTML, 'utf8');
  const ogMetaModule = readFileSync(OG_META_MODULE, 'utf8');
  const tokens = extractHtmlTokens(html);
  const imagePaths = extractOgImagePaths(html, ogMetaModule);
  const iconPaths = extractIconPaths(html);

  // Titles use a bare `%s`: vitest's printf parser mangles an escaped `%%`
  // sitting next to one, so the percent-delimiters are left out of the name.
  it.each(tokens)('token %s is one the build is known to resolve', (token) => {
    expect(
      ALLOWED_HTML_TOKENS,
      `index.html contains %${token}%, which no build step is known to replace. ` +
        `A %VITE_*% token relies on Vite's native env substitution, which only warns ` +
        `on an unset variable and ships the literal token into the built HTML — add ` +
        `the token to the og-meta plugin in src/build-time/og-meta.ts instead.`
    ).toContain(token);
  });

  it.each(ALLOWED_HTML_TOKENS)('token %s is resolved by the og-meta plugin', (token) => {
    expect(
      ogMetaModule.includes(`%${token}%`),
      `src/build-time/og-meta.ts does not mention %${token}%, so it would survive into the built HTML.`
    ).toBe(true);
  });

  it('declares at least one og:image asset (guard cannot go vacuous)', () => {
    expect(imagePaths.length).toBeGreaterThan(0);
  });

  it.each(imagePaths)('og image %s exists under public/', (path) => {
    expect(existsSync(join(PUBLIC_DIR, path.replace(/^\//, '')))).toBe(true);
  });

  it('declares at least one favicon link (guard cannot go vacuous)', () => {
    expect(iconPaths.length).toBeGreaterThan(0);
  });

  it.each(iconPaths)('icon %s exists under public/', (path) => {
    expect(
      existsSync(join(PUBLIC_DIR, path.replace(/^\//, ''))),
      `index.html links ${path}, which is not in apps/web/public/. The nginx SPA ` +
        `fallback serves index.html for it at HTTP 200, so the icon silently never renders.`
    ).toBe(true);
  });
});

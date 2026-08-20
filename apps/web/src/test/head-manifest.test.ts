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
 * `rel` tokens that mark a `<link>` as declaring an icon. `rel` is a
 * space-separated token LIST, so membership is tested per token rather than
 * against the whole attribute value: `rel="apple-touch-icon precomposed"` and
 * `rel="alternate icon"` are ordinary real-world spellings that a whole-value
 * comparison misses, leaving exactly the kind of link a future contributor is
 * most likely to add completely unguarded.
 */
const ICON_REL_TOKENS = new Set(['icon', 'apple-touch-icon', 'shortcut']);

/**
 * Tokens the head is expected to keep declaring. Path existence alone lets a
 * link be deleted outright and still pass, which would quietly drop a whole
 * client family (Apple home screens) from the brand set.
 */
const REQUIRED_ICON_REL_TOKENS = ['icon', 'apple-touch-icon'];

/**
 * Icon links declared in the document head, as their root-relative hrefs plus
 * the set of `rel` tokens actually seen.
 *
 * These need the same existence check the og:image paths get, for a sharper
 * reason: nginx.conf's SPA fallback (`try_files $uri $uri/ /index.html`)
 * answers a missing icon with index.html at HTTP 200, so the browser quietly
 * discards non-image HTML and paints its default placeholder. That is how
 * `index.html` shipped a link to a `/favicon.svg` that was never in public/
 * (#2182) - a green build, a blank tab, and nothing in the access log.
 *
 * The check is existence-only: it says nothing about whether an asset is a
 * valid icon for the `rel` it is declared under.
 *
 * Only root-relative hrefs are collected, and deliberately so: Vite treats
 * `link[href]` as an asset attribute and resolves a RELATIVE href at build
 * time, failing loudly when the file is missing. A root-relative path is passed
 * through to public/ unchecked, which is the half nothing else covers.
 */
function extractIconLinks(html: string): { paths: string[]; relTokens: Set<string> } {
  const paths = new Set<string>();
  const relTokens = new Set<string>();

  for (const match of html.matchAll(/<link\s[^>]*>/gi)) {
    const tag = match[0];
    // Quoted or bare value - `rel=icon` is valid HTML and would otherwise slip
    // through unguarded.
    const rel = /\brel\s*=\s*(?:["']([^"']*)["']|([^\s"'=<>`]+))/i.exec(tag);
    if (!rel) continue;

    const tokens = (rel[1] ?? rel[2] ?? '').trim().toLowerCase().split(/\s+/);
    const iconTokens = tokens.filter((token) => ICON_REL_TOKENS.has(token));
    if (iconTokens.length === 0) continue;

    for (const token of iconTokens) {
      relTokens.add(token);
    }

    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (href?.startsWith('/')) {
      paths.add(href);
    }
  }

  return { paths: [...paths], relTokens };
}

/**
 * Drops HTML comments so a commented-out link cannot be read as a declaration.
 * Applied to the icon extraction only - the OG comment block deliberately names
 * the `%TOKEN%` placeholders it documents, and those extractors are supposed to
 * see them.
 */
function stripHtmlComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Asserts every root-relative path a head declaration points at is really in
 * public/, and that the declaration set is non-empty so the guard cannot pass
 * by matching nothing: `it.each([])` registers zero tests, i.e. a green suite.
 */
function describePublicAssets(label: string, paths: string[]): void {
  it(`declares at least one ${label} (guard cannot go vacuous)`, () => {
    expect(paths.length).toBeGreaterThan(0);
  });

  it.each(paths)(`${label} %s exists under public/`, (path) => {
    expect(
      existsSync(join(PUBLIC_DIR, path.replace(/^\//, ''))),
      `index.html references ${path}, which is not in apps/web/public/. The nginx SPA ` +
        `fallback serves index.html for it at HTTP 200, so it silently never renders.`
    ).toBe(true);
  });
}

describe('head asset manifest', () => {
  const html = readFileSync(INDEX_HTML, 'utf8');
  const ogMetaModule = readFileSync(OG_META_MODULE, 'utf8');
  const tokens = extractHtmlTokens(html);
  const imagePaths = extractOgImagePaths(html, ogMetaModule);
  const icons = extractIconLinks(stripHtmlComments(html));

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

  describePublicAssets('og image', imagePaths);
  describePublicAssets('icon', icons.paths);

  it.each(REQUIRED_ICON_REL_TOKENS)('declares a rel="%s" link', (token) => {
    expect(
      icons.relTokens.has(token),
      `index.html declares no rel="${token}" link, so that client family falls back ` +
        `to a default placeholder icon while every other assertion stays green.`
    ).toBe(true);
  });
});

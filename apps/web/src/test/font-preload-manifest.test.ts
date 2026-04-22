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
const FONTS_DIR = join(WEB_ROOT, 'public', 'fonts');

// Extracts every `/fonts/...` href from `<link rel="preload">` tags.
// Keeps it a regex (not a real HTML parser) so the test stays zero-dependency.
function extractFontPreloadHrefs(html: string): string[] {
  const hrefs: string[] = [];
  const pattern = /<link\s+[^>]*\brel\s*=\s*["']preload["'][^>]*>/gi;
  for (const match of html.matchAll(pattern)) {
    const tag = match[0];
    const hrefMatch = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag);
    const asMatch = /\bas\s*=\s*["']font["']/i.exec(tag);
    if (hrefMatch && asMatch && hrefMatch[1].startsWith('/fonts/')) {
      hrefs.push(hrefMatch[1]);
    }
  }
  return hrefs;
}

describe('font preload manifest', () => {
  const html = readFileSync(INDEX_HTML, 'utf8');
  const hrefs = extractFontPreloadHrefs(html);

  it('declares at least one font preload (FOUT guard)', () => {
    expect(hrefs.length).toBeGreaterThan(0);
  });

  it.each(hrefs)('preloaded %s exists under public/fonts/', (href) => {
    const relative = href.replace(/^\/fonts\//, '');
    const onDisk = join(FONTS_DIR, relative);
    expect(existsSync(onDisk)).toBe(true);
  });

  it('every font preload has crossorigin set (else preload is not reused)', () => {
    const pattern = /<link\s+[^>]*\brel\s*=\s*["']preload["'][^>]*>/gi;
    for (const match of html.matchAll(pattern)) {
      const tag = match[0];
      const isFont = /\bas\s*=\s*["']font["']/i.test(tag);
      if (!isFont) continue;
      expect(tag).toMatch(/\bcrossorigin\b/);
    }
  });
});

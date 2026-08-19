import { describe, expect, it } from 'vitest';

import { createOgMetaPlugin, type OgMetaEnv } from '../build-time/og-meta';
import indexHtml from '../../index.html?raw';

/**
 * Drives the real plugin against the real `index.html`, which is what makes
 * this a behavioural guard rather than a restatement of the source: it fails if
 * the badge branch is inverted, if a configured origin stops being prefixed
 * onto the image, or if a token stops being escaped — the three ways this
 * change ships green and produces a broken (or wrongly-badged) share card.
 */
function buildHtml(env: OgMetaEnv): string {
  return createOgMetaPlugin(env).transformIndexHtml(indexHtml);
}

/** Every `content` value of the named og/twitter meta tag. */
function metaContents(html: string, property: string): string[] {
  const pattern = new RegExp(
    `<meta\\s+(?:property|name)="${property}"\\s+content="([^"]*)"\\s*/>`,
    'g'
  );
  return [...html.matchAll(pattern)].map((match) => match[1]);
}

describe('og-meta plugin', () => {
  it('leaves no unresolved %TOKEN% in the emitted HTML when nothing is set', () => {
    // The failure this reproduces is a green build shipping a literal
    // `%VITE_OG_TITLE_PREFIX%` into every share card (#2175 review).
    expect(buildHtml({})).not.toMatch(/%[A-Z][A-Z0-9_]*%/);
  });

  describe('badge switch', () => {
    it('uses the un-badged image when VITE_OG_BADGE_TEXT is unset', () => {
      const html = buildHtml({});

      expect(metaContents(html, 'og:image')).toEqual(['/og-image.png']);
      expect(metaContents(html, 'twitter:image')).toEqual(['/og-image.png']);
    });

    it('uses the un-badged image when VITE_OG_BADGE_TEXT is empty', () => {
      expect(metaContents(buildHtml({ VITE_OG_BADGE_TEXT: '' }), 'og:image')).toEqual([
        '/og-image.png',
      ]);
    });

    it('uses the badged image when VITE_OG_BADGE_TEXT is set', () => {
      const html = buildHtml({ VITE_OG_BADGE_TEXT: 'Demo' });

      expect(metaContents(html, 'og:image')).toEqual(['/og-image-demo.png']);
      expect(metaContents(html, 'twitter:image')).toEqual(['/og-image-demo.png']);
    });
  });

  describe('absolute urls', () => {
    it('omits og:url and keeps the relative image when no origin is known', () => {
      const html = buildHtml({});

      expect(metaContents(html, 'og:url')).toEqual([]);
      expect(html).not.toContain('og:url');
    });

    it('emits an absolute image plus og:url when an origin is set', () => {
      const html = buildHtml({ VITE_OG_SITE_URL: 'https://demo.openlinker.io' });

      expect(metaContents(html, 'og:image')).toEqual(['https://demo.openlinker.io/og-image.png']);
      expect(metaContents(html, 'twitter:image')).toEqual([
        'https://demo.openlinker.io/og-image.png',
      ]);
      expect(metaContents(html, 'og:url')).toEqual(['https://demo.openlinker.io/']);
    });

    it('tolerates a trailing slash on the configured origin', () => {
      const html = buildHtml({ VITE_OG_SITE_URL: 'https://demo.openlinker.io///' });

      expect(metaContents(html, 'og:image')).toEqual(['https://demo.openlinker.io/og-image.png']);
      expect(metaContents(html, 'og:url')).toEqual(['https://demo.openlinker.io/']);
    });

    it('combines the origin with the badged image', () => {
      const html = buildHtml({
        VITE_OG_BADGE_TEXT: 'Demo',
        VITE_OG_SITE_URL: 'https://demo.openlinker.io',
      });

      expect(metaContents(html, 'og:image')).toEqual([
        'https://demo.openlinker.io/og-image-demo.png',
      ]);
    });
  });

  describe('title prefix', () => {
    it('prefixes the document title and every og/twitter text tag', () => {
      const html = buildHtml({ VITE_OG_TITLE_PREFIX: '[DEMO] ' });

      expect(html).toContain('<title>[DEMO] OpenLinker Admin</title>');
      expect(metaContents(html, 'og:title')).toEqual(['[DEMO] OpenLinker Admin']);
      expect(metaContents(html, 'twitter:title')).toEqual(['[DEMO] OpenLinker Admin']);
      expect(metaContents(html, 'og:image:alt')).toEqual(['[DEMO] OpenLinker']);
      expect(metaContents(html, 'twitter:image:alt')).toEqual(['[DEMO] OpenLinker']);
    });

    it('escapes a prefix that would otherwise break out of the attribute', () => {
      const html = buildHtml({ VITE_OG_TITLE_PREFIX: '[A&B] "x" <y> ' });

      // Unescaped, the `"` terminates content="…" and the `<` opens a tag
      // inside <head> — a malformed card that renders no preview at all.
      expect(metaContents(html, 'og:title')).toEqual([
        '[A&amp;B] &quot;x&quot; &lt;y&gt; OpenLinker Admin',
      ]);
      expect(html).not.toContain('<y>');
    });
  });
});

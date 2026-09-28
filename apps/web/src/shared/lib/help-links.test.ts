/**
 * Help Links — config-map completeness (#81)
 *
 * "A test fails if a surface key has no URL" — the issue's own acceptance
 * criterion. TypeScript's `Record<HelpSurfaceKey, string>` already refuses to
 * compile a missing key, but this test additionally asserts every URL is a
 * genuinely specific `docs.openlinker.io` page (never empty, never bare
 * homepage/protocol-relative/relative), so a future entry that satisfies the
 * TYPE with an empty string still fails loudly.
 *
 * @module apps/web/src/shared/lib
 */
import { describe, expect, it } from 'vitest';
import { HELP_LINKS, HELP_LINK_LABELS, HELP_SURFACE_KEYS } from './help-links';

describe('HELP_LINKS', () => {
  it('should carry exactly the declared surface keys, no more and no fewer', () => {
    expect(Object.keys(HELP_LINKS).sort()).toEqual([...HELP_SURFACE_KEYS].sort());
    expect(Object.keys(HELP_LINK_LABELS).sort()).toEqual([...HELP_SURFACE_KEYS].sort());
  });

  it('should resolve every surface to a specific docs.openlinker.io page, never the bare homepage', () => {
    for (const key of HELP_SURFACE_KEYS) {
      const url = HELP_LINKS[key];
      expect(url.startsWith('https://docs.openlinker.io/')).toBe(true);
      expect(url).not.toBe('https://docs.openlinker.io/');
      expect(url.length).toBeGreaterThan('https://docs.openlinker.io/'.length);
    }
  });

  it('should give every surface a non-empty, screen-reader-usable label naming the surface', () => {
    for (const key of HELP_SURFACE_KEYS) {
      expect(HELP_LINK_LABELS[key].trim().length).toBeGreaterThan(0);
      expect(HELP_LINK_LABELS[key].toLowerCase()).toContain('help');
    }
  });
});

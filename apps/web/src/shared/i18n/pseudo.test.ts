/**
 * Pseudo-localization - unit tests
 *
 * @module shared/i18n
 */
import { describe, expect, it } from 'vitest';
import { pseudoLocalize } from './pseudo';

describe('pseudoLocalize', () => {
  it('should accent letters, lengthen the text and bracket it', () => {
    const out = pseudoLocalize('Save changes');
    expect(out.startsWith('[Šávé çháñgéš')).toBe(true);
    expect(out.endsWith(']')).toBe(true);
    expect(out.length).toBeGreaterThan('Save changes'.length * 1.3);
  });

  it('should leave placeholders and tags intact', () => {
    const out = pseudoLocalize('Read <link>the guide</link> for {name}');
    expect(out).toContain('<link>');
    expect(out).toContain('</link>');
    expect(out).toContain('{name}');
  });
});

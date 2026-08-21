/**
 * Rich text profile derivation tests
 *
 * Pure logic, so this runs on the default environment. The assertions are all of
 * the form "the destination declared X, therefore the editor offers Y" - which is
 * the property ADR-046 buys: adding a control means a destination declared a tag,
 * not that someone picked one.
 *
 * @module apps/web/src/shared/ui
 */
import { describe, expect, it } from 'vitest';

import { byteLength, deriveRichTextProfile, exceedsDescriptionCap } from './rich-text-profiles';
import type { DescriptionFormat } from './rich-text.types';

function format(overrides: Partial<DescriptionFormat> = {}): DescriptionFormat {
  return {
    shape: 'html',
    allowedTags: ['h1', 'h2', 'p', 'ul', 'ol', 'li', 'b'],
    allowedAttributes: {},
    contentModel: { root: ['h1', 'h2', 'p', 'ul', 'ol'], p: ['b'], li: ['b', 'p'], h1: [], h2: [] },
    rewrites: [],
    requiresBlockOpener: true,
    selfClosingVoids: false,
    maxBytes: 40000,
    declared: true,
    resolvedVia: 'OfferManager',
    ...overrides,
  };
}

describe('deriveRichTextProfile', () => {
  it('should enable only the marks the destination has a tag for', () => {
    // Allegro-shaped: `b` only. No italic, underline or strike control exists,
    // so an operator cannot author something the destination discards.
    const profile = deriveRichTextProfile(format());
    expect(profile.marks).toEqual(['bold']);
  });

  it('should offer italic when the destination rewrites it to bold, and flag the loss', () => {
    // ADR-046 subordinate decision 2: rename, not unwrap. Hiding the control on
    // a destination that rewrites `i` to `b` loses the operator's emphasis and
    // leaves them no way to express it - Allegro is exactly this case.
    const profile = deriveRichTextProfile(
      format({ allowedTags: ['p', 'b'], rewrites: [{ from: 'em', action: 'rename', to: 'b' }] }),
    );
    expect(profile.marks).toContain('italic');
    expect(profile.italicPublishesAsBold).toBe(true);
  });

  it('should not flag a loss when the destination has its own italic tag', () => {
    const profile = deriveRichTextProfile(format({ allowedTags: ['p', 'b', 'em'] }));
    expect(profile.italicPublishesAsBold).toBe(false);
  });

  it('should enable every mark on a permissive destination', () => {
    const profile = deriveRichTextProfile(
      format({ allowedTags: ['p', 'strong', 'em', 'u', 's', 'a'] }),
    );
    expect(profile.marks).toEqual(['bold', 'italic', 'underline', 'strike']);
  });

  it('should recognise em as italic and del as strike', () => {
    const profile = deriveRichTextProfile(format({ allowedTags: ['p', 'em', 'del'] }));
    expect(profile.marks).toContain('italic');
    expect(profile.marks).toContain('strike');
  });

  it('should serialise bold as b when the destination has no strong', () => {
    // The single most consequential derivation: Tiptap emits `<strong>` by
    // default and Allegro rejects it outright.
    expect(deriveRichTextProfile(format()).boldTag).toBe('b');
  });

  it('should serialise bold as strong when the destination allows it', () => {
    expect(deriveRichTextProfile(format({ allowedTags: ['p', 'strong'] })).boldTag).toBe('strong');
  });

  it('should expose only the heading levels the destination allows', () => {
    expect(deriveRichTextProfile(format()).headingLevels).toEqual([1, 2]);
    expect(
      deriveRichTextProfile(format({ allowedTags: ['h1', 'h2', 'h3', 'p'] })).headingLevels,
    ).toEqual([1, 2, 3]);
  });

  it('should report headings as mark-free when the content model says they take no children', () => {
    expect(deriveRichTextProfile(format()).headingMarks).toBe(false);
  });

  it('should allow marks in headings when no content model constrains them', () => {
    expect(deriveRichTextProfile(format({ contentModel: null })).headingMarks).toBe(true);
  });

  it('should require both the list tag and li before enabling a list control', () => {
    // A `ul` with no `li` is not a list the destination can render.
    const profile = deriveRichTextProfile(format({ allowedTags: ['p', 'ul'] }));
    expect(profile.bulletList).toBe(false);
  });

  it('should enable each list independently', () => {
    const bulletOnly = deriveRichTextProfile(format({ allowedTags: ['p', 'ul', 'li'] }));
    expect(bulletOnly.bulletList).toBe(true);
    expect(bulletOnly.orderedList).toBe(false);
  });

  it('should enable hard breaks only where br is allowed', () => {
    expect(deriveRichTextProfile(format()).hardBreak).toBe(false);
    expect(deriveRichTextProfile(format({ allowedTags: ['p', 'br'] })).hardBreak).toBe(true);
  });

  it('should enable the link control only where an anchor is allowed', () => {
    expect(deriveRichTextProfile(format()).links).toBe(false);
    expect(deriveRichTextProfile(format({ allowedTags: ['p', 'a'] })).links).toBe(true);
  });

  it('should carry the byte cap through, including a null one', () => {
    expect(deriveRichTextProfile(format()).maxBytes).toBe(40000);
    expect(deriveRichTextProfile(format({ maxBytes: null })).maxBytes).toBeNull();
  });

  it('should derive a plausible Erli profile that differs from Allegro in exactly h3 and br', () => {
    const allegro = deriveRichTextProfile(format());
    const erli = deriveRichTextProfile(
      format({
        allowedTags: ['h1', 'h2', 'h3', 'p', 'b', 'br', 'ol', 'ul', 'li'],
        contentModel: { root: ['h1', 'h2', 'h3', 'p', 'ul', 'ol'], h1: [], h2: [], h3: [] },
        selfClosingVoids: true,
        maxBytes: 80000,
      }),
    );

    expect(erli.headingLevels).toEqual([1, 2, 3]);
    expect(allegro.headingLevels).toEqual([1, 2]);
    expect(erli.hardBreak).toBe(true);
    expect(allegro.hardBreak).toBe(false);
    expect(erli.marks).toEqual(allegro.marks);
    expect(erli.boldTag).toBe(allegro.boldTag);
  });
});

describe('byteLength', () => {
  it('should count bytes and not characters', () => {
    // Matters because the destination caps bytes, and Polish copy is largely
    // two bytes per character.
    expect(byteLength('ab')).toBe(2);
    expect(byteLength('żó')).toBe(4);
  });

  it('should count an empty string as zero', () => {
    expect(byteLength('')).toBe(0);
  });
});

describe('exceedsDescriptionCap', () => {
  it('should report a value over the destination cap when a cap is declared', () => {
    expect(exceedsDescriptionCap('abcdef', { maxBytes: 5 })).toBe(true);
    expect(exceedsDescriptionCap('abcde', { maxBytes: 5 })).toBe(false);
  });

  it('should measure bytes, not characters', () => {
    // Three Polish characters are six bytes: a character-length gate would let
    // this through and the destination would reject the whole write.
    expect(exceedsDescriptionCap('żóć', { maxBytes: 5 })).toBe(true);
  });

  it('should never report a breach while the contract is still in flight', () => {
    // `null` format means the declaration has not arrived. A cap nobody declared
    // cannot be exceeded, and blocking Save on a pending read would look like a
    // broken form.
    expect(exceedsDescriptionCap('x'.repeat(10_000), null)).toBe(false);
    expect(exceedsDescriptionCap('x'.repeat(10_000), undefined)).toBe(false);
  });

  it('should never report a breach for an uncapped destination or an empty value', () => {
    expect(exceedsDescriptionCap('x'.repeat(10_000), { maxBytes: null })).toBe(false);
    expect(exceedsDescriptionCap('', { maxBytes: 0 })).toBe(false);
  });
});

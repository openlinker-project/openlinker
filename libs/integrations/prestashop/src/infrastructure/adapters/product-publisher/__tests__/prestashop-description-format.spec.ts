/**
 * PrestaShop Description Format — declaration spec
 *
 * Pins the declared set exactly, so widening it is a deliberate test change
 * (ADR-046 § Consequences). Load-bearing here specifically because this
 * declaration's provenance is INFERRED — from what PrestaShop's own TinyMCE
 * emits — rather than reconstructed from validator rejections the way Allegro's
 * is. Nothing else in the repo records what this set is supposed to be.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/product-publisher/__tests__
 */
import { PRESTASHOP_DESCRIPTION_FORMAT as FORMAT } from '../prestashop-description-format';

describe('PRESTASHOP_DESCRIPTION_FORMAT', () => {
  it('should declare exactly the tags PrestaShop’s own editor emits', () => {
    expect([...FORMAT.allowedTags].sort()).toEqual(
      [
        'a', 'b', 'blockquote', 'br', 'em', 'h1', 'h2', 'h3', 'h4',
        'i', 'li', 'ol', 'p', 's', 'strong', 'u', 'ul',
      ].sort(),
    );
  });

  it('should allow href on a link and nothing else anywhere', () => {
    expect(FORMAT.allowedAttributes).toEqual({ a: ['href'] });
  });

  it('should declare no content model, because a shop imposes no nesting grammar', () => {
    expect(FORMAT.contentModel).toBeNull();
  });

  it('should rewrite nothing, because every mark has its own tag here', () => {
    expect(FORMAT.rewrites).toEqual([]);
  });

  it('should not require a block opener and should not self-close voids', () => {
    expect(FORMAT.requiresBlockOpener ?? false).toBe(false);
    expect(FORMAT.selfClosingVoids ?? false).toBe(false);
  });

  it('should cap where the column practically does', () => {
    expect(FORMAT.maxBytes).toBe(65_536);
  });

  it('should be html-shaped', () => {
    expect(FORMAT.shape).toBe('html');
  });
});

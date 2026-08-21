/**
 * WooCommerce Description Format — declaration spec
 *
 * Pins the declared set exactly, so widening it is a deliberate test change
 * (ADR-046 § Consequences). This matters MORE here than for the evidenced
 * marketplace declarations, not less: this one is inferred from what WordPress
 * accepts rather than reconstructed from validator rejections, so nothing else
 * in the repo records what it is supposed to be.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/product-publisher/__tests__
 */
import { WOOCOMMERCE_DESCRIPTION_FORMAT as FORMAT } from '../woocommerce-description-format';

describe('WOOCOMMERCE_DESCRIPTION_FORMAT', () => {
  it('should declare exactly the tags a default WordPress install keeps', () => {
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
    // Unlike a marketplace validator, `wp_kses` filters tags without asserting
    // which may nest inside which - a null model says exactly that.
    expect(FORMAT.contentModel).toBeNull();
  });

  it('should rewrite nothing, because every mark has its own tag here', () => {
    expect(FORMAT.rewrites).toEqual([]);
  });

  it('should not require a block opener and should not self-close voids', () => {
    // `<br>` is accepted as-is; WordPress does not reject loose inline content.
    expect(FORMAT.requiresBlockOpener ?? false).toBe(false);
    expect(FORMAT.selfClosingVoids ?? false).toBe(false);
  });

  it('should cap at the WordPress post_content practical ceiling', () => {
    expect(FORMAT.maxBytes).toBe(65_536);
  });

  it('should be html-shaped', () => {
    expect(FORMAT.shape).toBe('html');
  });
});

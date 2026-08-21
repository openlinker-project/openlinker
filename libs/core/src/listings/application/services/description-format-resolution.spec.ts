/**
 * Description Format Resolution - unit tests
 *
 * The defensive-resolution case is the one that matters here: an out-of-tree
 * plugin compiled against an older `libs/core` satisfies `isOfferFieldUpdater`
 * and has no `getDescriptionFormat`, and must not take a publish down.
 *
 * @module libs/core/src/listings/application/services
 */
import {
  formatDescriptionForDestination,
  formatOfferFieldsForDestination,
  resolveOfferDescriptionFormat,
  resolveShopDescriptionFormat,
} from './description-format-resolution';
import {
  CONSERVATIVE_DESCRIPTION_FORMAT,
  type DescriptionFormat,
} from '../../domain/types/description-format.types';
import type { OfferManagerPort } from '../../domain/ports/offer-manager.port';
import type { ShopProductManagerPort } from '../../domain/ports/shop-product-manager.port';

const DECLARED: DescriptionFormat = {
  shape: 'html',
  allowedTags: ['p', 'b', 'h3'],
  allowedAttributes: {},
  contentModel: null,
  rewrites: [{ from: 'strong', action: 'rename', to: 'b' }],
  requiresBlockOpener: false,
  maxBytes: null,
};

function offerAdapter(withFormat: boolean): OfferManagerPort {
  const base = { updateOfferQuantity: jest.fn() };
  return (
    withFormat ? { ...base, getDescriptionFormat: () => DECLARED } : base
  ) as unknown as OfferManagerPort;
}

describe('resolveOfferDescriptionFormat', () => {
  it('should return the format the adapter declares', () => {
    expect(resolveOfferDescriptionFormat(offerAdapter(true))).toBe(DECLARED);
  });

  it('should fall back to the conservative format when the adapter declares none', () => {
    // The out-of-tree-plugin case: satisfies `isOfferFieldUpdater`, predates
    // `getDescriptionFormat`. Must degrade, not throw.
    expect(resolveOfferDescriptionFormat(offerAdapter(false))).toBe(
      CONSERVATIVE_DESCRIPTION_FORMAT,
    );
  });

  it('should not throw when the adapter carries a non-function property of that name', () => {
    const hostile = { updateOfferQuantity: jest.fn(), getDescriptionFormat: 'nope' };
    expect(() => resolveOfferDescriptionFormat(hostile as unknown as OfferManagerPort)).not.toThrow();
    expect(resolveOfferDescriptionFormat(hostile as unknown as OfferManagerPort)).toBe(
      CONSERVATIVE_DESCRIPTION_FORMAT,
    );
  });
});

describe('resolveShopDescriptionFormat', () => {
  it('should return the format the shop declares', () => {
    const shop = {
      publishProduct: jest.fn(),
      getDescriptionFormat: () => DECLARED,
    } as unknown as ShopProductManagerPort;
    expect(resolveShopDescriptionFormat(shop)).toBe(DECLARED);
  });

  it('should fall back when a shop somehow declares none', () => {
    const shop = { publishProduct: jest.fn() } as unknown as ShopProductManagerPort;
    expect(resolveShopDescriptionFormat(shop)).toBe(CONSERVATIVE_DESCRIPTION_FORMAT);
  });
});

describe('formatDescriptionForDestination', () => {
  it('should shape a description with the given format', () => {
    expect(formatDescriptionForDestination('<p><strong>x</strong></p>', DECLARED)).toBe(
      '<p><b>x</b></p>',
    );
  });

  it('should return undefined for null, so the caller omits the field', () => {
    expect(formatDescriptionForDestination(null, DECLARED)).toBeUndefined();
  });

  it('should return undefined for an empty string', () => {
    expect(formatDescriptionForDestination('', DECLARED)).toBeUndefined();
  });

  it('should return undefined when nothing survives the format', () => {
    // `''` would ship an empty description; `undefined` omits the field, which
    // is the semantics the Allegro adapter used to implement locally.
    expect(formatDescriptionForDestination('<div>  </div>', DECLARED)).toBeUndefined();
  });
});

describe('formatOfferFieldsForDestination', () => {
  it('should leave fields without a description untouched', () => {
    const fields = { title: 'x' };
    expect(formatOfferFieldsForDestination(fields, DECLARED)).toBe(fields);
  });

  it('should shape every TEXT item and leave other fields alone', () => {
    const out = formatOfferFieldsForDestination(
      {
        title: 'unchanged',
        description: {
          sections: [{ items: [{ type: 'TEXT' as const, content: '<p><strong>a</strong></p>' }] }],
        },
      },
      DECLARED,
    );
    expect(out.title).toBe('unchanged');
    expect(out.description).toEqual({
      sections: [{ items: [{ type: 'TEXT', content: '<p><b>a</b></p>' }] }],
    });
  });

  it('should drop an item the format empties, keeping its siblings', () => {
    const out = formatOfferFieldsForDestination(
      {
        description: {
          sections: [
            {
              items: [
                { type: 'TEXT' as const, content: '<div> </div>' },
                { type: 'TEXT' as const, content: '<p>kept</p>' },
              ],
            },
          ],
        },
      },
      DECLARED,
    );
    expect(out.description).toEqual({
      sections: [{ items: [{ type: 'TEXT', content: '<p>kept</p>' }] }],
    });
  });

  it('should omit the description entirely when no section survives', () => {
    // Sending an empty tree instead risks a destination reading it as "clear
    // the description", which is a data-loss bug rather than a no-op.
    const out = formatOfferFieldsForDestination(
      {
        title: 'x',
        description: { sections: [{ items: [{ type: 'TEXT' as const, content: '<div> </div>' }] }] },
      },
      DECLARED,
    );
    expect(out).not.toHaveProperty('description');
    expect(out.title).toBe('x');
  });

  it('should not mutate the input', () => {
    const fields = {
      description: {
        sections: [{ items: [{ type: 'TEXT' as const, content: '<p><strong>a</strong></p>' }] }],
      },
    };
    formatOfferFieldsForDestination(fields, DECLARED);
    expect(fields.description.sections[0].items[0].content).toBe('<p><strong>a</strong></p>');
  });
});

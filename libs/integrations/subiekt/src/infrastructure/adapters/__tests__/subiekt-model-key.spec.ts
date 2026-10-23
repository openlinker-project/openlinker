/**
 * Subiekt model key + variant label — unit tests
 *
 * Pure functions, so these assert the rules directly rather than through the
 * adapter. Both matter more than they look: the key decides a product's
 * identity for the life of an install, and the label is the only thing that
 * tells one sibling from another on a marketplace.
 *
 * @module libs/integrations/subiekt/src/infrastructure/adapters/__tests__
 */
import {
  MODEL_PRODUCT_KEY_PREFIX,
  deriveVariantLabel,
  modelIdFromProductKey,
  modelProductKey,
} from '../subiekt-model-key';

describe('modelProductKey / modelIdFromProductKey', () => {
  it('round-trips a model id', () => {
    expect(modelProductKey(1)).toBe('model:1');
    expect(modelIdFromProductKey(modelProductKey(1))).toBe(1);
    expect(modelIdFromProductKey(modelProductKey(4231))).toBe(4231);
  });

  it('reads an ordinary towar symbol as NOT a model key', () => {
    for (const symbol of ['WOBLACK100', 'DZSO20', 'A-1', '']) {
      expect(modelIdFromProductKey(symbol)).toBeNull();
    }
  });

  it.each(['model:', 'model:0', 'model:-3', 'model:1.5', 'model:1x', 'model:abc', 'model: 1'])(
    'refuses the malformed key %p rather than reading it as model NaN',
    (key) => {
      // A malformed value must degrade to "this is a towar symbol", so the
      // caller gets an honest 404 from the bridge instead of requesting
      // /api/models/NaN and getting something unpredictable back.
      expect(modelIdFromProductKey(key)).toBeNull();
    },
  );

  it('exposes the prefix it parses, so no caller has to restate the literal', () => {
    expect(modelProductKey(7).startsWith(MODEL_PRODUCT_KEY_PREFIX)).toBe(true);
  });
});

describe('deriveVariantLabel', () => {
  it('strips the model name from the front of the member name', () => {
    expect(deriveVariantLabel('Black Tiger woda toaletowa', 'Black Tiger woda toaletowa 100ml')).toBe(
      '100ml',
    );
    expect(deriveVariantLabel('So dezodorant perfumowany', 'So dezodorant perfumowany 20ml')).toBe(
      '20ml',
    );
  });

  it('matches the prefix case-insensitively, because operator-typed names drift', () => {
    expect(deriveVariantLabel('black tiger woda toaletowa', 'Black Tiger woda toaletowa 70ml')).toBe(
      '70ml',
    );
  });

  it('falls back to the FULL member name when it does not start with the model name', () => {
    // Never an empty label and never a guess assembled from something else: an
    // empty attribute would make two siblings indistinguishable to an
    // explicit-grouping destination, which is worse than a verbose one.
    expect(deriveVariantLabel('Perfumy', 'Black Tiger 100ml')).toBe('Black Tiger 100ml');
  });

  it('falls back to the full name when stripping would leave nothing', () => {
    // A member named exactly like its model carries no distinguishing tail.
    expect(deriveVariantLabel('Black Tiger', 'Black Tiger')).toBe('Black Tiger');
  });

  it('falls back to the full name when the model has no name at all', () => {
    expect(deriveVariantLabel('', 'Black Tiger 100ml')).toBe('Black Tiger 100ml');
    expect(deriveVariantLabel('   ', 'Black Tiger 100ml')).toBe('Black Tiger 100ml');
  });

  it('trims the surrounding whitespace on both sides', () => {
    expect(deriveVariantLabel('  Black Tiger  ', '  Black Tiger   100ml  ')).toBe('100ml');
  });
});

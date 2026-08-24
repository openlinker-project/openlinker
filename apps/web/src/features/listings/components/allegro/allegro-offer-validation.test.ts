/**
 * Allegro offer-validation contract tests (#1096, #2243)
 *
 * Locks the migrated `needs-product-parameters` blocker (#810), the pre-submit
 * title-length blockers (#1962 ceiling, #2243 floor), the #2243 value / photo /
 * sibling-card / barcode rules, and the opt-in `needsCategoryParameterSchema`
 * flag that gates the host's per-category param fetch. Keeps the plugin-owned
 * validator honest independent of the wizards.
 *
 * @module features/listings/components/allegro
 */
import { describe, expect, it } from 'vitest';

import type { CategoryParameterLike } from '../../../../shared/plugins';
import {
  ALLEGRO_EAN_UNVERIFIED_BLOCKER,
  ALLEGRO_IN_STORE_BARCODE_BLOCKER,
  ALLEGRO_NEEDS_PRODUCT_PARAMETERS_BLOCKER,
  ALLEGRO_NO_PHOTO_BLOCKER,
  ALLEGRO_PARAM_VALUE_INVALID_BLOCKER,
  ALLEGRO_SIBLINGS_WITHOUT_CARD_BLOCKER,
  ALLEGRO_TITLE_TOO_LONG_BLOCKER,
  ALLEGRO_TITLE_TOO_SHORT_BLOCKER,
  allegroOfferValidation,
} from './allegro-offer-validation';

describe('allegroOfferValidation', () => {
  const base = {
    imageCount: 1,
    needsProductParameters: false,
    willLinkProductCard: false,
    title: 'A perfectly ordinary offer title',
  };

  /** A 75-character title that also satisfies the 3-word floor. */
  const atLimit = `${'x'.repeat(71)} b c`;

  it('raises the namespaced blocker when product params are needed and no card links', () => {
    expect(allegroOfferValidation.validateRow({ ...base, needsProductParameters: true })).toEqual([
      ALLEGRO_NEEDS_PRODUCT_PARAMETERS_BLOCKER,
    ]);
  });

  it('exempts a card-linked row (params inherited from the catalogue card)', () => {
    expect(
      allegroOfferValidation.validateRow({
        ...base,
        needsProductParameters: true,
        willLinkProductCard: true,
      }),
    ).toEqual([]);
  });

  it('stays silent when no product params are required', () => {
    expect(allegroOfferValidation.validateRow(base)).toEqual([]);
  });

  describe('title', () => {
    it('blocks a title over the 75-character limit before submit (#1962)', () => {
      expect(allegroOfferValidation.validateRow({ ...base, title: 'a b '.repeat(30) })).toEqual([
        ALLEGRO_TITLE_TOO_LONG_BLOCKER,
      ]);
    });

    it('allows a title exactly at the limit', () => {
      expect(atLimit.length).toBe(75);
      expect(allegroOfferValidation.validateRow({ ...base, title: atLimit })).toEqual([]);
    });

    it('blocks a title under 12 characters (#2243)', () => {
      expect(allegroOfferValidation.validateRow({ ...base, title: 'Fotel Ergo X' })).toEqual([]);
      expect(allegroOfferValidation.validateRow({ ...base, title: 'Fotel E X' })).toEqual([
        ALLEGRO_TITLE_TOO_SHORT_BLOCKER,
      ]);
    });

    it('blocks a long-but-single-word title on the 3-word floor (#2243)', () => {
      expect(allegroOfferValidation.validateRow({ ...base, title: 'x'.repeat(40) })).toEqual([
        ALLEGRO_TITLE_TOO_SHORT_BLOCKER,
      ]);
    });

    it('never raises both title blockers for one title', () => {
      const blockers = allegroOfferValidation.validateRow({ ...base, title: 'x'.repeat(400) });
      expect(blockers).toContain(ALLEGRO_TITLE_TOO_LONG_BLOCKER);
      expect(blockers).not.toContain(ALLEGRO_TITLE_TOO_SHORT_BLOCKER);
    });

    it('says nothing about an empty title (a different, already-reported state)', () => {
      expect(allegroOfferValidation.validateRow({ ...base, title: '' })).toEqual([]);
    });

    it('measures the sanitized title, so collapsed whitespace can bring it back under', () => {
      // 77 raw characters, but the double spaces collapse to 74 on the wire.
      const raw = `${'x'.repeat(68)}  a  b  c`;
      expect(raw.length).toBeGreaterThan(75);
      expect(allegroOfferValidation.validateRow({ ...base, title: raw })).toEqual([]);
    });

    it('measures the sanitized title, so an expanding substitution can push it over', () => {
      // 74 raw characters; the ellipsis becomes "..." (+2) => 76 on the wire.
      const raw = `${'x'.repeat(71)} b…`;
      expect(raw.length).toBeLessThanOrEqual(75);
      expect(allegroOfferValidation.validateRow({ ...base, title: raw })).toEqual([
        ALLEGRO_TITLE_TOO_LONG_BLOCKER,
      ]);
    });
  });

  describe('photos', () => {
    it('blocks a row with no image (#2243)', () => {
      expect(allegroOfferValidation.validateRow({ ...base, imageCount: 0 })).toEqual([
        ALLEGRO_NO_PHOTO_BLOCKER,
      ]);
    });

    it('exempts a card-linked row, which inherits the card photos', () => {
      expect(
        allegroOfferValidation.validateRow({
          ...base,
          imageCount: 0,
          willLinkProductCard: true,
        }),
      ).toEqual([]);
    });
  });

  describe('parameter values', () => {
    const cn: CategoryParameterLike = {
      id: '250792',
      name: 'Kod taryfy celnej',
      type: 'string',
      required: false,
      restrictions: { minLength: 8, maxLength: 10 },
    };

    it('blocks a value that breaks a bound the category declared (#2243)', () => {
      expect(
        allegroOfferValidation.validateRow({
          ...base,
          categoryParameters: [cn],
          suppliedParameters: [{ id: '250792', values: ['250792'] }],
        }),
      ).toEqual([ALLEGRO_PARAM_VALUE_INVALID_BLOCKER]);
    });

    it('stays silent when the value is inside the declared bound', () => {
      expect(
        allegroOfferValidation.validateRow({
          ...base,
          categoryParameters: [cn],
          suppliedParameters: [{ id: '250792', values: ['25079200'] }],
        }),
      ).toEqual([]);
    });

    it('stays silent with no schema - a bound we do not have cannot be checked', () => {
      expect(
        allegroOfferValidation.validateRow({
          ...base,
          suppliedParameters: [{ id: '250792', values: ['250792'] }],
        }),
      ).toEqual([]);
    });

    it('exempts a card-linked row, whose product values come from the card', () => {
      expect(
        allegroOfferValidation.validateRow({
          ...base,
          willLinkProductCard: true,
          categoryParameters: [cn],
          suppliedParameters: [{ id: '250792', values: ['250792'] }],
        }),
      ).toEqual([]);
    });
  });

  describe('sibling catalogue cards', () => {
    it('blocks when only some siblings have their own card (#2243)', () => {
      expect(
        allegroOfferValidation.validateRow({
          ...base,
          willLinkProductCard: true,
          includedSiblingCount: 3,
          siblingsWithoutCatalogueCard: 1,
        }),
      ).toEqual([ALLEGRO_SIBLINGS_WITHOUT_CARD_BLOCKER]);
    });

    it('stays silent when every sibling has a card', () => {
      expect(
        allegroOfferValidation.validateRow({
          ...base,
          willLinkProductCard: true,
          includedSiblingCount: 3,
          siblingsWithoutCatalogueCard: 0,
        }),
      ).toEqual([]);
    });

    it('stays silent when NO sibling has one - each lists standalone, which is legitimate', () => {
      expect(
        allegroOfferValidation.validateRow({
          ...base,
          includedSiblingCount: 3,
          siblingsWithoutCatalogueCard: 3,
        }),
      ).toEqual([]);
    });

    it('stays silent for a single-variant product', () => {
      expect(
        allegroOfferValidation.validateRow({
          ...base,
          includedSiblingCount: 1,
          siblingsWithoutCatalogueCard: 1,
        }),
      ).toEqual([]);
    });
  });

  describe('barcode', () => {
    it('warns about a restricted-circulation prefix (#2243)', () => {
      expect(
        allegroOfferValidation.validateRow({ ...base, barcode: '2001234567893' }),
      ).toEqual([ALLEGRO_IN_STORE_BARCODE_BLOCKER]);
    });

    it('warns about a barcode with no catalogue card once a lookup actually ran', () => {
      expect(
        allegroOfferValidation.validateRow({
          ...base,
          barcode: '5901234123457',
          catalogueConsulted: true,
        }),
      ).toEqual([ALLEGRO_EAN_UNVERIFIED_BLOCKER]);
    });

    it('says nothing when no catalogue was consulted - a miss would mean nothing', () => {
      expect(
        allegroOfferValidation.validateRow({
          ...base,
          barcode: '5901234123457',
          catalogueConsulted: false,
        }),
      ).toEqual([]);
    });

    it('says nothing for a card-linked row', () => {
      expect(
        allegroOfferValidation.validateRow({
          ...base,
          barcode: '5901234123457',
          catalogueConsulted: true,
          willLinkProductCard: true,
        }),
      ).toEqual([]);
    });

    it('defers to the product-level card problem instead of double-reporting', () => {
      expect(
        allegroOfferValidation.validateRow({
          ...base,
          barcode: '5901234123457',
          catalogueConsulted: true,
          includedSiblingCount: 3,
          siblingsWithoutCatalogueCard: 1,
        }),
      ).toEqual([ALLEGRO_SIBLINGS_WITHOUT_CARD_BLOCKER]);
    });
  });

  it('co-emits blockers when a row trips several rules', () => {
    expect(
      allegroOfferValidation.validateRow({
        ...base,
        needsProductParameters: true,
        imageCount: 0,
        title: 'x '.repeat(60),
      }),
    ).toEqual([
      ALLEGRO_NEEDS_PRODUCT_PARAMETERS_BLOCKER,
      ALLEGRO_TITLE_TOO_LONG_BLOCKER,
      ALLEGRO_NO_PHOTO_BLOCKER,
    ]);
  });

  it('declares each blocker chip once, with its field and advisory flag', () => {
    expect(allegroOfferValidation.blockers).toEqual([
      {
        id: ALLEGRO_NEEDS_PRODUCT_PARAMETERS_BLOCKER,
        field: 'parameters',
        tone: 'warning',
        label: 'add product params',
      },
      {
        id: ALLEGRO_TITLE_TOO_LONG_BLOCKER,
        field: 'title',
        tone: 'error',
        label: 'title too long',
      },
      {
        id: ALLEGRO_TITLE_TOO_SHORT_BLOCKER,
        field: 'title',
        tone: 'error',
        label: 'title too short',
      },
      {
        id: ALLEGRO_PARAM_VALUE_INVALID_BLOCKER,
        field: 'parameters',
        tone: 'error',
        label: 'parameter value rejected',
      },
      { id: ALLEGRO_NO_PHOTO_BLOCKER, field: 'images', tone: 'error', label: 'no photo' },
      {
        id: ALLEGRO_SIBLINGS_WITHOUT_CARD_BLOCKER,
        field: 'ean',
        tone: 'error',
        label: 'siblings share one card',
      },
      {
        id: ALLEGRO_EAN_UNVERIFIED_BLOCKER,
        field: 'ean',
        tone: 'warning',
        label: 'EAN not in catalogue',
        advisory: true,
      },
      {
        id: ALLEGRO_IN_STORE_BARCODE_BLOCKER,
        field: 'ean',
        tone: 'warning',
        label: 'in-store barcode',
        advisory: true,
      },
    ]);
  });

  it('marks only the barcode warnings advisory - a declared bound is a fact, not a hint', () => {
    const advisory = allegroOfferValidation.blockers
      .filter((b) => b.advisory === true)
      .map((b) => b.id);
    expect(advisory).toEqual([
      ALLEGRO_EAN_UNVERIFIED_BLOCKER,
      ALLEGRO_IN_STORE_BARCODE_BLOCKER,
    ]);
  });

  it('opts into the host category-parameter schema fetch (its validator reads it)', () => {
    expect(allegroOfferValidation.needsCategoryParameterSchema).toBe(true);
  });
});

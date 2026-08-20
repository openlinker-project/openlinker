/**
 * Allegro offer-validation contract tests (#1096)
 *
 * Locks the migrated `needs-product-parameters` blocker (#810), the pre-submit
 * title-length blocker (#1962), and the opt-in `needsCategoryParameterSchema`
 * flag that gates the host's per-category param fetch. Keeps the plugin-owned
 * validator honest independent of the wizards.
 *
 * @module features/listings/components/allegro
 */
import { describe, expect, it } from 'vitest';

import {
  ALLEGRO_NEEDS_PRODUCT_PARAMETERS_BLOCKER,
  ALLEGRO_TITLE_TOO_LONG_BLOCKER,
  allegroOfferValidation,
} from './allegro-offer-validation';

describe('allegroOfferValidation', () => {
  const base = {
    imageCount: 1,
    needsProductParameters: false,
    willLinkProductCard: false,
    title: 'A perfectly ordinary offer title',
  };

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
      })
    ).toEqual([]);
  });

  it('stays silent when no product params are required', () => {
    expect(allegroOfferValidation.validateRow(base)).toEqual([]);
  });

  it('blocks a title over the 75-character limit before submit (#1962)', () => {
    expect(allegroOfferValidation.validateRow({ ...base, title: 'x'.repeat(76) })).toEqual([
      ALLEGRO_TITLE_TOO_LONG_BLOCKER,
    ]);
  });

  it('allows a title exactly at the limit', () => {
    expect(allegroOfferValidation.validateRow({ ...base, title: 'x'.repeat(75) })).toEqual([]);
  });

  it('measures the sanitized title, so collapsed whitespace can bring it back under', () => {
    // 77 raw characters, but the double spaces collapse to 74 on the wire.
    const raw = `${'x'.repeat(68)}  a  b  c`;
    expect(raw.length).toBeGreaterThan(75);
    expect(allegroOfferValidation.validateRow({ ...base, title: raw })).toEqual([]);
  });

  it('measures the sanitized title, so an expanding substitution can push it over', () => {
    // 74 raw characters; the ellipsis becomes "..." (+2) => 76 on the wire.
    const raw = `${'x'.repeat(73)}…`;
    expect(raw.length).toBeLessThanOrEqual(75);
    expect(allegroOfferValidation.validateRow({ ...base, title: raw })).toEqual([
      ALLEGRO_TITLE_TOO_LONG_BLOCKER,
    ]);
  });

  it('co-emits both blockers when a row trips each rule', () => {
    expect(
      allegroOfferValidation.validateRow({
        ...base,
        needsProductParameters: true,
        title: 'x'.repeat(120),
      })
    ).toEqual([ALLEGRO_NEEDS_PRODUCT_PARAMETERS_BLOCKER, ALLEGRO_TITLE_TOO_LONG_BLOCKER]);
  });

  it('declares each blocker chip once with its namespaced id', () => {
    expect(allegroOfferValidation.blockers).toEqual([
      {
        id: ALLEGRO_NEEDS_PRODUCT_PARAMETERS_BLOCKER,
        tone: 'warning',
        label: 'add product params',
      },
      { id: ALLEGRO_TITLE_TOO_LONG_BLOCKER, tone: 'error', label: 'title too long' },
    ]);
  });

  it('opts into the host category-parameter schema fetch (its validator reads it)', () => {
    expect(allegroOfferValidation.needsCategoryParameterSchema).toBe(true);
  });

  // ── #2240 - seller details are a connection-level precondition ──
  describe('validateBatch', () => {
    const complete = {
      sellerDefaults: {
        location: {
          countryCode: 'PL',
          province: 'MAZOWIECKIE',
          city: 'Warszawa',
          postCode: '00-001',
        },
        responsibleProducerId: 'rp_1',
        safetyInformation: { description: 'Safe' },
      },
    };

    it('reports nothing when every group is filled in', () => {
      expect(allegroOfferValidation.validateBatch?.({ connectionConfig: complete })).toEqual([]);
    });

    it('names every missing group on an empty connection config', () => {
      const issues = allegroOfferValidation.validateBatch?.({ connectionConfig: {} }) ?? [];

      expect(issues).toHaveLength(1);
      expect(issues[0]?.id).toBe('allegro:missing-seller-details');
      expect(issues[0]?.title).toContain('a ship-from location');
      expect(issues[0]?.title).toContain('a responsible producer');
      expect(issues[0]?.title).toContain('safety information');
    });

    it('treats a partially filled ship-from location as missing', () => {
      // The adapter's gate requires all four fields, so three of four is a
      // rejection at create time - not a warning we can soften here.
      const issues =
        allegroOfferValidation.validateBatch?.({
          connectionConfig: {
            sellerDefaults: {
              ...complete.sellerDefaults,
              location: { countryCode: 'PL', province: 'MAZOWIECKIE', city: 'Warszawa' },
            },
          },
        }) ?? [];

      expect(issues).toHaveLength(1);
      expect(issues[0]?.title).toContain('a ship-from location');
      expect(issues[0]?.title).not.toContain('responsible producer');
    });

    it('treats a blank string as missing, not as a value', () => {
      const issues =
        allegroOfferValidation.validateBatch?.({
          connectionConfig: {
            sellerDefaults: { ...complete.sellerDefaults, responsibleProducerId: '   ' },
          },
        }) ?? [];

      expect(issues[0]?.title).toContain('a responsible producer');
    });
  });
});

/**
 * Offer Linking Service Tests
 *
 * @module libs/core/src/listings/application/services/__tests__
 */
import { OfferLinkingService } from '../offer-linking.service';
import { OfferLinkingLookups } from '../../types/offer-linking.types';

describe('OfferLinkingService', () => {
  let service: OfferLinkingService;

  beforeEach(() => {
    service = new OfferLinkingService();
  });

  const buildLookups = (overrides?: Partial<OfferLinkingLookups>): OfferLinkingLookups => ({
    externalRefToVariantId: new Map(),
    skuToVariantId: new Map(),
    eanToVariantId: new Map(),
    gtinToVariantId: new Map(),
    ...overrides,
  });

  it('links by externalRef when uniquely matched', () => {
    const lookups = buildLookups({
      externalRefToVariantId: new Map([['ext-1', 'variant-1']]),
    });

    const result = service.linkOffer({ offerId: 'offer-1', externalRef: 'ext-1' }, lookups);

    expect(result).toEqual({
      status: 'linked',
      internalVariantId: 'variant-1',
      linkMethod: 'externalRef',
    });
  });

  it('skips when externalRef is ambiguous', () => {
    const lookups = buildLookups({
      externalRefToVariantId: new Map([['ext-1', null]]),
    });

    const result = service.linkOffer({ offerId: 'offer-1', externalRef: 'ext-1' }, lookups);

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('ambiguous_external_ref');
  });

  it('falls back to sku when externalRef is missing', () => {
    const lookups = buildLookups({
      skuToVariantId: new Map([['SKU-1', 'variant-1']]),
    });

    const result = service.linkOffer({ offerId: 'offer-1', sku: 'SKU-1' }, lookups);

    expect(result).toEqual({
      status: 'linked',
      internalVariantId: 'variant-1',
      linkMethod: 'sku',
    });
  });

  it('falls back to ean when sku is missing', () => {
    const lookups = buildLookups({
      eanToVariantId: new Map([['5901234123457', 'variant-1']]),
    });

    const result = service.linkOffer({ offerId: 'offer-1', ean: '5901234123457' }, lookups);

    expect(result).toEqual({
      status: 'linked',
      internalVariantId: 'variant-1',
      linkMethod: 'ean',
    });
  });

  it('skips when no deterministic match exists', () => {
    const lookups = buildLookups();

    const result = service.linkOffer({ offerId: 'offer-1' }, lookups);

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('no_deterministic_match');
  });
});

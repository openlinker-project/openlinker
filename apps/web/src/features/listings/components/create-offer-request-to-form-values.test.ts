/**
 * createOfferRequestToFormValues Tests
 *
 * @module apps/web/src/features/listings/components
 */
import { describe, expect, it } from 'vitest';
import {
  canReadCreateOfferRequestSnapshot,
  createOfferRequestToFormValues,
} from './create-offer-request-to-form-values';
import { CREATE_OFFER_DEFAULT_VALUES } from './create-offer-fields.schema';
import {
  SUPPORTED_OFFER_CREATION_REQUEST_SCHEMA_VERSION,
  type CreateOfferRequest,
} from '../api/listings.types';

describe('createOfferRequestToFormValues', () => {
  it('maps a fully-populated request onto form values', () => {
    const request: CreateOfferRequest = {
      internalVariantId: 'ol_variant_abcdef',
      stock: 7,
      publishImmediately: true,
      price: { amount: 99.9, currency: 'PLN' },
      overrides: {
        title: 'Nice shirt',
        categoryId: '12345',
        description: 'Cotton, black, crew neck.',
        platformParams: {
          deliveryPolicyId: 'del-1',
          returnPolicyId: 'ret-1',
          warrantyId: 'war-1',
          impliedWarrantyId: 'iw-1',
        },
      },
    };

    const values = createOfferRequestToFormValues(request, 'conn_1');

    expect(values).toEqual({
      ...CREATE_OFFER_DEFAULT_VALUES,
      connectionId: 'conn_1',
      internalVariantId: 'ol_variant_abcdef',
      variantLabel: '',
      title: 'Nice shirt',
      categoryId: '12345',
      priceAmount: '99.90',
      priceCurrency: 'PLN',
      stock: 7,
      description: 'Cotton, black, crew neck.',
      publishImmediately: true,
      parameters: {},
      deliveryPolicyId: 'del-1',
      returnPolicyId: 'ret-1',
      warrantyId: 'war-1',
      impliedWarrantyId: 'iw-1',
    });
  });

  it('reverse-maps platformParams.parameters into the form-shape parameters slice', () => {
    const request: CreateOfferRequest = {
      internalVariantId: 'ol_variant_xyz',
      stock: 1,
      publishImmediately: false,
      overrides: {
        title: 't',
        categoryId: 'c',
        platformParams: {
          deliveryPolicyId: 'del-1',
          parameters: [
            { id: 'single', valuesIds: ['v1'] },
            { id: 'multi', valuesIds: ['m1', 'm2'] },
            { id: 'scalar', values: ['hello'] },
            { id: 'range', rangeValue: { from: '1', to: '10' } },
          ],
        },
      },
    };

    const values = createOfferRequestToFormValues(request, 'conn_1');
    expect(values.parameters).toEqual({
      single: 'v1',
      multi: ['m1', 'm2'],
      scalar: 'hello',
      range: { from: '1', to: '10' },
    });
  });

  it('returns an empty parameters slice when the snapshot omits the array', () => {
    const request: CreateOfferRequest = {
      internalVariantId: 'ol_variant_xyz',
      stock: 1,
      publishImmediately: false,
    };
    const values = createOfferRequestToFormValues(request, 'conn_1');
    expect(values.parameters).toEqual({});
  });

  it('falls back to defaults when optional fields are missing', () => {
    const request: CreateOfferRequest = {
      internalVariantId: 'ol_variant_xyz',
      stock: 0,
      publishImmediately: false,
    };

    const values = createOfferRequestToFormValues(request, 'conn_1');

    expect(values.connectionId).toBe('conn_1');
    expect(values.internalVariantId).toBe('ol_variant_xyz');
    expect(values.title).toBe('');
    expect(values.categoryId).toBe('');
    expect(values.priceAmount).toBe('');
    expect(values.priceCurrency).toBe(CREATE_OFFER_DEFAULT_VALUES.priceCurrency);
    expect(values.stock).toBe(0);
    expect(values.description).toBe('');
    expect(values.publishImmediately).toBe(false);
    expect(values.deliveryPolicyId).toBe('');
    expect(values.returnPolicyId).toBe('');
    expect(values.warrantyId).toBe('');
    expect(values.impliedWarrantyId).toBe('');
  });

  it('coerces a null description to an empty string', () => {
    const request: CreateOfferRequest = {
      internalVariantId: 'ol_variant_xyz',
      stock: 1,
      publishImmediately: false,
      overrides: { title: 't', categoryId: 'c', description: null },
    };

    const values = createOfferRequestToFormValues(request, 'conn_1');
    expect(values.description).toBe('');
  });

  it('formats the price amount with exactly two decimals', () => {
    const request: CreateOfferRequest = {
      internalVariantId: 'ol_variant_xyz',
      stock: 1,
      publishImmediately: false,
      price: { amount: 42, currency: 'EUR' },
    };

    const values = createOfferRequestToFormValues(request, 'conn_1');
    expect(values.priceAmount).toBe('42.00');
    expect(values.priceCurrency).toBe('EUR');
  });

  describe('canReadCreateOfferRequestSnapshot', () => {
    it('accepts the supported version', () => {
      const request: CreateOfferRequest = {
        internalVariantId: 'ol_variant_xyz',
        stock: 1,
        publishImmediately: false,
        schemaVersion: SUPPORTED_OFFER_CREATION_REQUEST_SCHEMA_VERSION,
      };
      expect(canReadCreateOfferRequestSnapshot(request)).toBe(true);
    });

    it('accepts an undefined version (pre-versioning records)', () => {
      const request: CreateOfferRequest = {
        internalVariantId: 'ol_variant_xyz',
        stock: 1,
        publishImmediately: false,
      };
      expect(canReadCreateOfferRequestSnapshot(request)).toBe(true);
    });

    it('rejects an unknown future version', () => {
      const request: CreateOfferRequest = {
        internalVariantId: 'ol_variant_xyz',
        stock: 1,
        publishImmediately: false,
        schemaVersion: 99,
      };
      expect(canReadCreateOfferRequestSnapshot(request)).toBe(false);
    });
  });

  it('ignores non-string platformParams entries', () => {
    const request: CreateOfferRequest = {
      internalVariantId: 'ol_variant_xyz',
      stock: 1,
      publishImmediately: false,
      overrides: {
        title: 't',
        categoryId: 'c',
        platformParams: {
          deliveryPolicyId: 'del-1',
          returnPolicyId: 123,
          warrantyId: null,
          impliedWarrantyId: { nested: 'value' },
        },
      },
    };

    const values = createOfferRequestToFormValues(request, 'conn_1');
    expect(values.deliveryPolicyId).toBe('del-1');
    expect(values.returnPolicyId).toBe('');
    expect(values.warrantyId).toBe('');
    expect(values.impliedWarrantyId).toBe('');
  });
});

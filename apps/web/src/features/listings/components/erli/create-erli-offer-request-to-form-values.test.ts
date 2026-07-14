/**
 * createErliOfferRequestToFormValues / readErliOfferRequestPrefill tests (#1099)
 */
import { describe, expect, it } from 'vitest';

import { SUPPORTED_OFFER_CREATION_REQUEST_SCHEMA_VERSION } from '../../api/listings.types';
import type { CreateOfferRequest } from '../../api/listings.types';
import type { ErliDispatchTimeParam } from './erli-offer-fields.schema';
import {
  createErliOfferRequestToFormValues,
  readErliOfferRequestPrefill,
} from './create-erli-offer-request-to-form-values';

const FALLBACK: ErliDispatchTimeParam = { period: 2, unit: 'day' };

function snapshot(overrides: Partial<CreateOfferRequest> = {}): CreateOfferRequest {
  return {
    internalVariantId: 'ol_variant_abc',
    stock: 7,
    publishImmediately: false,
    price: { amount: 123.45, currency: 'PLN' },
    overrides: {
      title: 'Retried Title',
      description: 'desc',
      categoryId: '12345',
      platformParams: { dispatchTime: { period: 5, unit: 'hour' } },
    },
    ...overrides,
  };
}

describe('createErliOfferRequestToFormValues', () => {
  it('maps every field from the snapshot', () => {
    const values = createErliOfferRequestToFormValues(snapshot(), FALLBACK);

    expect(values).toMatchObject({
      internalVariantId: 'ol_variant_abc',
      title: 'Retried Title',
      categoryId: '12345',
      priceAmount: '123.45',
      stock: 7,
      description: 'desc',
      publishImmediately: false,
      dispatchPeriod: 5,
      dispatchUnit: 'hour',
    });
  });

  it('restores the responsible producer from platformParams.producer (#1531)', () => {
    const values = createErliOfferRequestToFormValues(
      snapshot({
        overrides: {
          title: 'With producer',
          platformParams: { dispatchTime: { period: 5, unit: 'hour' }, producer: '42' },
        },
      }),
      FALLBACK,
    );

    expect(values.producer).toBe('42');
  });

  it('defaults producer to an empty string when the snapshot has none (#1531)', () => {
    const values = createErliOfferRequestToFormValues(
      snapshot({ overrides: { title: 'No producer' } }),
      FALLBACK,
    );

    expect(values.producer).toBe('');
  });

  it('falls back to the connection default dispatch when the snapshot has none', () => {
    const values = createErliOfferRequestToFormValues(
      snapshot({ overrides: { title: 'No dispatch' } }),
      FALLBACK,
    );

    expect(values.dispatchPeriod).toBe(2);
    expect(values.dispatchUnit).toBe('day');
  });

  it('restores category-parameter values from the wire snapshot on retry', () => {
    const values = createErliOfferRequestToFormValues(
      snapshot({
        overrides: {
          title: 'With parameters',
          categoryId: '12345',
          parameters: [
            { id: 'p1', values: ['Red'], section: 'offer' },
            { id: 'p2', valuesIds: ['v1', 'v2'], section: 'offer' },
          ],
        },
      }),
      FALLBACK,
    );

    expect(values.parameters).toEqual({ p1: 'Red', p2: ['v1', 'v2'] });
  });
});

describe('readErliOfferRequestPrefill', () => {
  it('returns null for an absent request (fresh create)', () => {
    expect(readErliOfferRequestPrefill(undefined, FALLBACK)).toBeNull();
  });

  it('returns null for an unreadable (newer) schema version', () => {
    const future = snapshot({
      schemaVersion: SUPPORTED_OFFER_CREATION_REQUEST_SCHEMA_VERSION + 1,
    });
    expect(readErliOfferRequestPrefill(future, FALLBACK)).toBeNull();
  });

  it('maps a readable snapshot', () => {
    const values = readErliOfferRequestPrefill(snapshot(), FALLBACK);
    expect(values?.title).toBe('Retried Title');
  });
});

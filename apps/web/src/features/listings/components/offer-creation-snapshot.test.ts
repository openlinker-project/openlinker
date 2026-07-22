/**
 * canReadCreateOfferRequestSnapshot Tests
 *
 * @module apps/web/src/features/listings/components
 */
import { describe, expect, it } from 'vitest';
import { canReadCreateOfferRequestSnapshot } from './offer-creation-snapshot';
import {
  SUPPORTED_OFFER_CREATION_REQUEST_SCHEMA_VERSION,
  type CreateOfferRequest,
} from '../api/listings.types';

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

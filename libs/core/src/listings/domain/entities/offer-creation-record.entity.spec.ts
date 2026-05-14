/**
 * Offer Creation Record Domain Entity — Unit Tests
 *
 * @module libs/core/src/listings/domain/entities
 */
import { OfferCreationRecord } from './offer-creation-record.entity';
import type { OfferCreationError, OfferCreationStatus } from '../types/offer-creation-record.types';

describe('OfferCreationRecord', () => {
  it('should preserve all constructor fields', () => {
    const now = new Date('2026-04-20T10:00:00Z');
    const errors: OfferCreationError[] = [
      { field: 'parameters.EAN', code: 'MISSING', message: 'EAN is required' },
    ];

    const record = new OfferCreationRecord(
      'rec-uuid',
      'ol_variant_123',
      'conn-uuid',
      null,
      'pending' as OfferCreationStatus,
      errors,
      true,
      now,
      now
    );

    expect(record.id).toBe('rec-uuid');
    expect(record.internalVariantId).toBe('ol_variant_123');
    expect(record.connectionId).toBe('conn-uuid');
    expect(record.externalOfferId).toBeNull();
    expect(record.status).toBe('pending');
    expect(record.errors).toBe(errors);
    expect(record.publishImmediately).toBe(true);
    expect(record.createdAt).toBe(now);
    expect(record.updatedAt).toBe(now);
  });

  it('should accept externalOfferId when present', () => {
    const now = new Date();
    const record = new OfferCreationRecord(
      'rec-uuid',
      'ol_variant_123',
      'conn-uuid',
      'allegro-offer-9999',
      'active' as OfferCreationStatus,
      null,
      false,
      now,
      now
    );

    expect(record.externalOfferId).toBe('allegro-offer-9999');
    expect(record.errors).toBeNull();
  });
});

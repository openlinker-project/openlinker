/**
 * mergeDeliveryOnDocumentsConfig tests (#3908)
 *
 * @module apps/web/src/features/delivery-on-documents/lib
 */
import { describe, expect, it } from 'vitest';
import { mergeDeliveryOnDocumentsConfig } from './merge-delivery-on-documents-config';

const SETTINGS = {
  name: 'Koszt dostawy',
  rate: 'goods',
  freeDelivery: 'omit',
  rateFormat: 'plain',
} as const;

describe('mergeDeliveryOnDocumentsConfig', () => {
  it('should keep every other config key when it writes the delivery settings', () => {
    const merged = mergeDeliveryOnDocumentsConfig(
      { rateLimit: { maxConcurrent: 2 }, salesDocument: { documentKind: 'invoice' } },
      { countries: { PL: SETTINGS } },
    );

    expect(merged).toEqual({
      rateLimit: { maxConcurrent: 2 },
      salesDocument: { documentKind: 'invoice' },
      deliveryOnDocuments: { countries: { PL: SETTINGS } },
    });
  });

  it('should remove the key when nothing is configured any more', () => {
    const merged = mergeDeliveryOnDocumentsConfig(
      { rateLimit: { maxConcurrent: 2 }, deliveryOnDocuments: { countries: { PL: SETTINGS } } },
      null,
    );

    expect(merged).toEqual({ rateLimit: { maxConcurrent: 2 } });
  });
});

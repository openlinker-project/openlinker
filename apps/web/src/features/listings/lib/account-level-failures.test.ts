import { describe, expect, it } from 'vitest';

import type { BulkBatchRecordSummary } from '../api/bulk-listings.types';
import { splitAccountLevelFailures } from './account-level-failures';

const rec = (id: string, codes: string[]): BulkBatchRecordSummary => ({
  id,
  internalVariantId: `ol_variant_${id}`,
  status: 'failed',
  externalOfferId: null,
  createdAt: '2026-11-05T13:22:00.000Z',
  updatedAt: '2026-11-05T13:22:00.000Z',
  errors: codes.map((code) => ({ code, message: `msg ${code}` })),
});

describe('splitAccountLevelFailures', () => {
  const ACCOUNT = ['SellerAccountWithSellBlockadeException', 'OfferAccessDeniedException'];

  it('should put a record with an account-level code on the account side when it has one', () => {
    const split = splitAccountLevelFailures(
      [rec('a', ['OfferAccessDeniedException']), rec('b', ['ParameterValueInvalid'])],
      ACCOUNT,
    );
    expect(split.account.map((r) => r.id)).toEqual(['a']);
    expect(split.offer.map((r) => r.id)).toEqual(['b']);
    expect(split.firstAccountError).toEqual({
      code: 'OfferAccessDeniedException',
      message: 'msg OfferAccessDeniedException',
    });
  });

  it('should treat the whole record as account-level when codes are mixed', () => {
    const split = splitAccountLevelFailures(
      [rec('a', ['ParameterValueInvalid', 'SellerAccountWithSellBlockadeException'])],
      ACCOUNT,
    );
    expect(split.account.map((r) => r.id)).toEqual(['a']);
    expect(split.firstAccountError?.code).toBe('SellerAccountWithSellBlockadeException');
  });

  it('should classify nothing when the platform declares no codes', () => {
    const split = splitAccountLevelFailures([rec('a', ['OfferAccessDeniedException'])], []);
    expect(split.account).toEqual([]);
    expect(split.offer.map((r) => r.id)).toEqual(['a']);
    expect(split.firstAccountError).toBeNull();
  });

  it('should keep a record with no errors on the offer side', () => {
    const r = { ...rec('a', []), errors: null };
    expect(splitAccountLevelFailures([r], ACCOUNT).offer).toHaveLength(1);
  });
});

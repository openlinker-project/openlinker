/**
 * Custody write error mapping (#2380)
 *
 * The rule under test is that the refusal is read from the 409 body's `reason`
 * FIELD, never from its message — matching on prose would break silently the
 * first time the backend reworded a sentence.
 *
 * @module apps/web/src/features/returns/lib
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../shared/api/api-error';
import { describeCustodyError, readCustodyRefusalReason } from './custody-error';
import { RETURN_CUSTODY_ERROR_COPY, RETURN_RECEIVE_COPY } from './return-custody.copy';

function conflict(details: unknown): ApiError {
  return new ApiError('some server wording that must not be matched on', 409, details);
}

describe('readCustodyRefusalReason', () => {
  it('should read the reason field', () => {
    expect(readCustodyRefusalReason(conflict({ reason: 'over-receipt' }))).toBe('over-receipt');
  });

  it.each([[{}], [{ reason: '' }], [{ reason: 42 }], [null], ['nope']])(
    'should return null for a body shape it cannot read: %s',
    (details) => {
      expect(readCustodyRefusalReason(conflict(details))).toBeNull();
    },
  );
});

describe('describeCustodyError', () => {
  it('should render the spec sentence for an over-receipt', () => {
    expect(describeCustodyError(conflict({ reason: 'over-receipt' }))).toBe(
      RETURN_RECEIVE_COPY.overReceipt,
    );
  });

  it('should explain a partially-received refusal in the terms the control uses', () => {
    expect(describeCustodyError(conflict({ reason: 'partially-received' }))).toContain(
      'shortfall stays visible',
    );
  });

  it('should fall back to the generic conflict for a reason this build predates', () => {
    // Never the raw code: a code is not a sentence, and this build genuinely
    // does not know what a future one means.
    const message = describeCustodyError(conflict({ reason: 'some-future-reason' }));

    expect(message).toBe(RETURN_CUSTODY_ERROR_COPY.conflict);
    expect(message).not.toContain('some-future-reason');
  });

  it('should not match on the server message', () => {
    expect(describeCustodyError(conflict({ reason: 'over-receipt' }))).not.toContain(
      'some server wording',
    );
  });

  it('should map 404 and 403 to their own sentences', () => {
    expect(describeCustodyError(new ApiError('gone', 404, undefined))).toBe(
      RETURN_CUSTODY_ERROR_COPY.notFound,
    );
    expect(describeCustodyError(new ApiError('nope', 403, undefined))).toBe(
      RETURN_CUSTODY_ERROR_COPY.forbidden,
    );
  });

  it('should fall back for a non-ApiError', () => {
    expect(describeCustodyError(new Error(''))).toBe(RETURN_CUSTODY_ERROR_COPY.generic);
    expect(describeCustodyError(new Error('network down'))).toBe('network down');
  });
});

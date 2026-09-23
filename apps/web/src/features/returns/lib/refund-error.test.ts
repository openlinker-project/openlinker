/**
 * refund-error tests (PR #3379 review)
 *
 * The load-bearing case is the unrecognised-reason 409: a body that carries
 * a `reason` field this build does not know about must fall to the generic
 * "nothing was saved" sentence, never to the stale-row `conflict` copy — the
 * exact defect this file exists to remove for the reasons this build DOES
 * know. Only a 409 with NO `reason` field at all — the genuine
 * `ReturnRefundContendedError` race — gets the reload-and-retry copy.
 *
 * @module apps/web/src/features/returns/lib
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../shared/api/api-error';
import { describeRefundError, readRefundBlockReason } from './refund-error';
import { RETURN_REFUND_ERROR_COPY } from './return-money.copy';

describe('describeRefundError', () => {
  it('renders the reason-specific sentence for a recognised block reason', () => {
    const error = new ApiError('conflict', 409, { reason: 'already-attempted' });
    expect(describeRefundError(error)).toBe(RETURN_REFUND_ERROR_COPY.byReason['already-attempted']);
  });

  it('renders the stale-row conflict copy when the 409 carries no reason field', () => {
    const error = new ApiError('conflict', 409, {});
    expect(describeRefundError(error)).toBe(RETURN_REFUND_ERROR_COPY.conflict);
  });

  it('renders the generic sentence — NOT the stale-row conflict copy — for an unrecognised reason value', () => {
    const error = new ApiError('conflict', 409, { reason: 'some-future-reason' });
    expect(describeRefundError(error)).toBe(RETURN_REFUND_ERROR_COPY.generic);
    expect(describeRefundError(error)).not.toBe(RETURN_REFUND_ERROR_COPY.conflict);
  });

  it('renders notFound copy for a 404', () => {
    const error = new ApiError('not found', 404, null);
    expect(describeRefundError(error)).toBe(RETURN_REFUND_ERROR_COPY.notFound);
  });

  it('renders forbidden copy for a 403', () => {
    const error = new ApiError('forbidden', 403, null);
    expect(describeRefundError(error)).toBe(RETURN_REFUND_ERROR_COPY.forbidden);
  });
});

describe('readRefundBlockReason', () => {
  it('returns the reason when recognised', () => {
    const error = new ApiError('conflict', 409, { reason: 'no-lines' });
    expect(readRefundBlockReason(error)).toBe('no-lines');
  });

  it('returns null when the reason is not recognised', () => {
    const error = new ApiError('conflict', 409, { reason: 'some-future-reason' });
    expect(readRefundBlockReason(error)).toBeNull();
  });

  it('returns null when there is no reason field at all', () => {
    const error = new ApiError('conflict', 409, {});
    expect(readRefundBlockReason(error)).toBeNull();
  });
});

/**
 * extractShippingTraceId — unit tests (#1800)
 *
 * Covers the shape-sniffing extractor: a real ApiError carrying a DPD-style
 * `details.traceId`, the non-matching shapes it must reject, and the
 * non-ApiError / null-error fall-throughs.
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../shared/api/api-error';
import { extractShippingTraceId } from './extract-shipping-trace-id';

function makeApiError(details: unknown, message = 'DPD create was rejected.'): ApiError {
  return new ApiError(message, 502, details);
}

describe('extractShippingTraceId', () => {
  it('returns null when the error is not an ApiError', () => {
    expect(extractShippingTraceId(new Error('boom'))).toBeNull();
  });

  it('returns null for a null error (no mutation failure)', () => {
    expect(extractShippingTraceId(null)).toBeNull();
  });

  it('returns null when details has no nested traceId', () => {
    expect(extractShippingTraceId(makeApiError({ providerCode: 'NOT_PROCESSED' }))).toBeNull();
  });

  it('returns null when details.details exists but carries no traceId', () => {
    const err = makeApiError({ providerCode: 'NOT_PROCESSED', details: { validationInfo: [] } });
    expect(extractShippingTraceId(err)).toBeNull();
  });

  it('returns null when traceId is present but not a string', () => {
    const err = makeApiError({ details: { traceId: 12345 } });
    expect(extractShippingTraceId(err)).toBeNull();
  });

  it('returns null when traceId is an empty string', () => {
    const err = makeApiError({ details: { traceId: '' } });
    expect(extractShippingTraceId(err)).toBeNull();
  });

  it('extracts the traceId from the nested providerDetails shape the 502 body carries', () => {
    const err = makeApiError({
      providerCode: 'NOT_PROCESSED',
      details: { traceId: 'trace-xyz-789' },
    });
    expect(extractShippingTraceId(err)).toBe('trace-xyz-789');
  });

  it('returns null for a generic non-shipping ApiError (e.g. a network failure)', () => {
    expect(extractShippingTraceId(ApiError.fromNetworkFailure(new Error('timeout')))).toBeNull();
  });
});

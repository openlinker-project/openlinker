/**
 * extractShippingTraceId — unit tests (#1800)
 *
 * Covers the trace-id sniffer: the real nested ApiError envelope DPD produces
 * (`details.details.traceId`), the non-matching shapes it must reject, and the
 * empty/whitespace guard.
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../shared/api/api-error';
import { extractShippingTraceId } from './extract-shipping-trace-id';

function makeApiError(details: unknown, message = 'There are some validation errors.'): ApiError {
  return new ApiError(message, 502, details);
}

describe('extractShippingTraceId', () => {
  it('returns null when the error is not an ApiError', () => {
    expect(extractShippingTraceId(new Error('boom'))).toBeNull();
  });

  it('returns null when details is not an object', () => {
    expect(extractShippingTraceId(makeApiError('a string body'))).toBeNull();
  });

  it('returns null when the 502 body has no nested details object', () => {
    expect(extractShippingTraceId(makeApiError({ message: 'boom', providerCode: 'x' }))).toBeNull();
  });

  it('returns null when nested details carries no traceId', () => {
    const err = makeApiError({
      providerCode: 'NOT_PROCESSED',
      details: { errorCode: null, info: 'rejected' },
    });
    expect(extractShippingTraceId(err)).toBeNull();
  });

  it('returns null when traceId is present but not a string', () => {
    const err = makeApiError({ providerCode: 'x', details: { traceId: 123 } });
    expect(extractShippingTraceId(err)).toBeNull();
  });

  it('returns null when traceId is an empty / whitespace-only string', () => {
    expect(extractShippingTraceId(makeApiError({ details: { traceId: '' } }))).toBeNull();
    expect(extractShippingTraceId(makeApiError({ details: { traceId: '   ' } }))).toBeNull();
  });

  it('extracts the traceId from the real DPD nested rejection envelope', () => {
    const err = makeApiError({
      providerCode: 'NOT_PROCESSED',
      details: { errorCode: null, info: 'rejected', traceId: 'trace-xyz-789' },
    });
    expect(extractShippingTraceId(err)).toBe('trace-xyz-789');
  });

  it('trims surrounding whitespace on the extracted traceId', () => {
    const err = makeApiError({ details: { traceId: '  trace-abc-123  ' } });
    expect(extractShippingTraceId(err)).toBe('trace-abc-123');
  });

  it('returns null for a generic non-shipping ApiError (e.g. a network failure)', () => {
    expect(extractShippingTraceId(ApiError.fromNetworkFailure(new Error('timeout')))).toBeNull();
  });
});

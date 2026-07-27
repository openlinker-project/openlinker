/**
 * extractShippingFieldErrors — unit tests (#1806)
 *
 * Covers the shape-sniffing extractor: a real ApiError carrying a ShipX
 * `details.fieldErrors` body, the non-matching shapes it must reject, and the
 * multi-message-per-field flattening behaviour.
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../shared/api/api-error';
import { extractShippingFieldErrors } from './extract-shipping-field-errors';

function makeApiError(details: unknown, message = 'There are some validation errors.'): ApiError {
  return new ApiError(message, 502, details);
}

describe('extractShippingFieldErrors', () => {
  it('returns null when the error is not an ApiError', () => {
    expect(extractShippingFieldErrors(new Error('boom'))).toBeNull();
  });

  it('returns null when details has no nested fieldErrors map', () => {
    const err = makeApiError({ message: 'boom' });
    expect(extractShippingFieldErrors(err)).toBeNull();
  });

  it('returns null when details.fieldErrors values are not string arrays', () => {
    const err = makeApiError({
      providerCode: 'validation_failed',
      details: { fieldErrors: { 'receiver.email': 'not-an-array' } },
    });
    expect(extractShippingFieldErrors(err)).toBeNull();
  });

  it('flattens a single-field, single-message ShipX body', () => {
    const err = makeApiError({
      providerCode: 'validation_failed',
      details: {
        fieldErrors: { 'receiver.first_name': ['This field is required'] },
      },
    });

    expect(extractShippingFieldErrors(err)).toEqual([
      { field: 'receiver.first_name', code: 'validation_failed', message: 'This field is required' },
    ]);
  });

  it('emits one row per message for a field with multiple reasons', () => {
    const err = makeApiError({
      providerCode: 'validation_failed',
      details: {
        fieldErrors: {
          'receiver.email': ['This field is required', 'Invalid email format'],
        },
      },
    });

    expect(extractShippingFieldErrors(err)).toEqual([
      { field: 'receiver.email', code: 'validation_failed', message: 'This field is required' },
      { field: 'receiver.email', code: 'validation_failed', message: 'Invalid email format' },
    ]);
  });

  it('flattens multiple fields in declaration order', () => {
    const err = makeApiError({
      providerCode: 'validation_failed',
      details: {
        fieldErrors: {
          'receiver.first_name': ['This field is required'],
          'receiver.last_name': ['This field is required'],
        },
      },
    });

    expect(extractShippingFieldErrors(err)).toEqual([
      { field: 'receiver.first_name', code: 'validation_failed', message: 'This field is required' },
      { field: 'receiver.last_name', code: 'validation_failed', message: 'This field is required' },
    ]);
  });

  it('falls back to a generic code when providerCode is absent', () => {
    const err = makeApiError({
      details: { fieldErrors: { 'receiver.phone': ['This field is required'] } },
    });

    expect(extractShippingFieldErrors(err)).toEqual([
      { field: 'receiver.phone', code: 'validation_error', message: 'This field is required' },
    ]);
  });

  it('returns null when fieldErrors is present but empty', () => {
    const err = makeApiError({
      providerCode: 'validation_failed',
      details: { fieldErrors: {} },
    });

    expect(extractShippingFieldErrors(err)).toBeNull();
  });

  it('returns null for a generic non-shipping ApiError (e.g. a network failure)', () => {
    const err = ApiError.fromNetworkFailure(new Error('timeout'));
    expect(extractShippingFieldErrors(err)).toBeNull();
  });
});

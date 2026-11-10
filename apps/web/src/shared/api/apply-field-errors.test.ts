/**
 * applyFieldErrors (#3862): nested paths, path maps and the copy per constraint.
 */
import { describe, expect, it, vi } from 'vitest';
import type { UseFormSetError } from 'react-hook-form';
import { getMessages, interpolate } from '../i18n';
import { ApiError } from './api-error';
import { applyFieldErrors, describeFieldError } from './apply-field-errors';

interface Form {
  items: { quantity: number }[];
  name: string;
  address: { postcode: string };
}

function validationError(fields: unknown[]): ApiError {
  return new ApiError('validation', 400, { code: 'VALIDATION_FAILED', fields });
}

describe('applyFieldErrors', () => {
  it('should set a nested body path on the same form path', () => {
    const setError = vi.fn() as unknown as UseFormSetError<Form>;

    const result = applyFieldErrors(
      validationError([{ path: 'items.0.quantity', code: 'min', params: { min: 1 } }]),
      setError
    );

    expect(setError).toHaveBeenCalledWith('items.0.quantity', {
      type: 'server',
      message: interpolate(getMessages('errors').fields.min, { min: 1 }),
    });
    expect(result).toEqual({ applied: 1, unmapped: [] });
  });

  it('should map a body path through an object map and report what it could not place', () => {
    const setError = vi.fn() as unknown as UseFormSetError<Form>;

    const result = applyFieldErrors(
      validationError([
        { path: 'shippingAddress.postcode', code: 'isNotEmpty' },
        { path: 'unknownField', code: 'isString' },
      ]),
      setError,
      { 'shippingAddress.postcode': 'address.postcode' }
    );

    expect(setError).toHaveBeenCalledWith('address.postcode', {
      type: 'server',
      message: getMessages('errors').fields.isNotEmpty,
    });
    expect(result.unmapped).toEqual([{ path: 'unknownField', code: 'isString' }]);
  });

  it('should map through a function', () => {
    const setError = vi.fn() as unknown as UseFormSetError<Form>;

    applyFieldErrors(validationError([{ path: 'body.name', code: 'isNotEmpty' }]), setError, (path) =>
      path === 'body.name' ? 'name' : undefined
    );

    expect(setError).toHaveBeenCalledWith('name', expect.objectContaining({ type: 'server' }));
  });

  it('should set only the first failed constraint of one field', () => {
    const setError = vi.fn() as unknown as UseFormSetError<Form>;

    const result = applyFieldErrors(
      validationError([
        { path: 'name', code: 'isNotEmpty' },
        { path: 'name', code: 'isString' },
      ]),
      setError
    );

    expect(setError).toHaveBeenCalledTimes(1);
    expect(result.applied).toBe(1);
  });

  it('should do nothing for an error without fields', () => {
    const setError = vi.fn() as unknown as UseFormSetError<Form>;

    expect(applyFieldErrors(new Error('boom'), setError)).toEqual({ applied: 0, unmapped: [] });
    expect(applyFieldErrors(new ApiError('x', 409, { code: 'X' }), setError)).toEqual({
      applied: 0,
      unmapped: [],
    });
    expect(setError).not.toHaveBeenCalled();
  });
});

describe('describeFieldError', () => {
  it('should use the generic copy for an unknown constraint or a missing param', () => {
    const generic = getMessages('errors').fields.invalid;

    expect(describeFieldError({ path: 'a', code: 'isSomethingNew' })).toBe(generic);
    expect(describeFieldError({ path: 'a', code: 'min' })).toBe(generic);
  });
});

/**
 * describeApiError (#3862): every resolution step and the never-blank rule.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getMessages } from '../i18n';
import { registerNamespace } from '../i18n/messages';
import { SOURCE_LOCALE } from '../i18n/i18n.types';
import { ApiError } from './api-error';
import { describeApiError } from './describe-api-error';

const FEATURE = 'describe-api-error-test';

beforeAll(() => {
  registerNamespace(FEATURE, {
    baseLocale: SOURCE_LOCALE,
    base: {
      apiErrors: {
        ORDER_NOT_FOUND: 'This order was removed.',
        CONNECTION_IN_USE: 'Still used as {missing}.',
      },
    },
    loaders: {},
  });
});

function coded(status: number, body: Record<string, unknown>): ApiError {
  return new ApiError('raw backend message', status, body);
}

function copy(): ReturnType<typeof getMessages<'errors'>> {
  return getMessages('errors');
}

describe('describeApiError', () => {
  it("should prefer the feature namespace's copy for the code", () => {
    const error = coded(404, { code: 'ORDER_NOT_FOUND', params: { orderId: 'o-1' } });

    expect(describeApiError(error, FEATURE)).toBe('This order was removed.');
  });

  it('should fall back to the shared errors copy when the feature has none', () => {
    const error = coded(404, { code: 'INVOICE_NOT_FOUND', params: { invoiceId: 'i-1' } });

    expect(describeApiError(error, FEATURE)).toBe(copy().codes.INVOICE_NOT_FOUND);
  });

  it('should fill the params into the shared copy', () => {
    const error = coded(400, {
      code: 'CONNECTION_CONFIG_NOT_UNIQUE',
      params: { field: 'config.port', value: '8080', otherConnectionId: 'c-2', otherConnectionName: 'Bridge' },
    });

    const text = describeApiError(error);

    expect(text).not.toMatch(/\{\w+\}/);
    expect(text.length).toBeGreaterThan(0);
  });

  it('should skip a template whose placeholder the error does not fill', () => {
    const error = coded(409, { code: 'CONNECTION_IN_USE', params: { connectionId: 'c-1', reason: 'x' } });

    const text = describeApiError(error, FEATURE);

    expect(text).not.toContain('{missing}');
    expect(text).toBe(copy().codes.CONNECTION_IN_USE);
  });

  it('should use the status family for an unknown code', () => {
    const error = coded(409, { code: 'A_CODE_FROM_A_NEWER_BACKEND' });

    expect(describeApiError(error)).toBe(copy().status['409']);
  });

  it('should use the status family when the body has no code', () => {
    expect(describeApiError(new ApiError('Not Found', 404, null))).toBe(copy().status['404']);
    expect(describeApiError(new ApiError('Bad gateway', 502, null))).toBe(copy().status['5xx']);
    expect(describeApiError(new ApiError('Teapot', 418, null))).toBe(copy().status.other);
  });

  it('should tell a network failure from a timeout', () => {
    expect(describeApiError(ApiError.fromNetworkFailure(new Error('offline')))).toBe(
      copy().status.network
    );
    expect(describeApiError(ApiError.fromTimeout('/v1/orders'))).toBe(copy().status.timeout);
  });

  it("should show a provider's own words behind the translated prefix", () => {
    const error = coded(400, {
      code: 'PROVIDER_REJECTED',
      params: { provider: 'shop.v1' },
      providerMessage: 'Kod pocztowy jest niepoprawny',
    });

    const text = describeApiError(error);

    expect(text).toContain('Kod pocztowy jest niepoprawny');
    expect(text).not.toContain('{message}');
  });

  it('should never be blank, also for something that is not an ApiError', () => {
    expect(describeApiError(new Error(''))).toBe(copy().status.other);
    expect(describeApiError('a thrown string')).toBe(copy().status.other);
    expect(describeApiError(undefined)).toBe(copy().status.other);
  });

  it('should mark an untranslated error and show the raw message in development', () => {
    const error = coded(409, { code: 'A_CODE_FROM_A_NEWER_BACKEND' });

    expect(describeApiError(error, undefined, { dev: true })).toBe(
      '[untranslated:A_CODE_FROM_A_NEWER_BACKEND] raw backend message'
    );
    expect(describeApiError(new ApiError('Gone', 410, null), undefined, { dev: true })).toBe(
      '[untranslated:HTTP_410] Gone'
    );
  });

  it('should not mark a translated error in development', () => {
    const error = coded(404, { code: 'INVOICE_NOT_FOUND', params: { invoiceId: 'i-1' } });

    expect(describeApiError(error, undefined, { dev: true })).toBe(copy().codes.INVOICE_NOT_FOUND);
  });

  it('should ignore a feature namespace that is not registered', () => {
    const error = coded(404, { code: 'INVOICE_NOT_FOUND' });

    expect(describeApiError(error, 'no-such-namespace')).toBe(copy().codes.INVOICE_NOT_FOUND);
  });
});

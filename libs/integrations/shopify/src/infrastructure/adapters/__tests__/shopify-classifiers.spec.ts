import { ContendedWriteError } from '@openlinker/core/sync';

import { ShopifyApiError } from '../../../domain/exceptions/shopify-api.error';
import { ShopifyConfigException } from '../../../domain/exceptions/shopify-config.exception';
import { ShopifyGraphqlError } from '../../../domain/exceptions/shopify-graphql.error';
import { ShopifyNetworkError } from '../../../domain/exceptions/shopify-network.error';
import { ShopifyUserErrorsException } from '../../../domain/exceptions/shopify-user-errors.exception';
import { ShopifyAuthFailureClassifierAdapter } from '../shopify-auth-failure-classifier.adapter';
import { ShopifyRetryClassifierAdapter } from '../shopify-retry-classifier.adapter';

const throttled = new ShopifyGraphqlError(['THROTTLED'], ['Throttled']);
const orderCap = new ShopifyUserErrorsException('orderCreate', [{ message: 'Too many attempts. Please try again later.' }]);
const staleStock = new ShopifyUserErrorsException('inventorySetQuantities', [
  { message: 'stale', code: 'CHANGE_FROM_QUANTITY_STALE' },
]);
const grant = (code: string, status = 400): ShopifyApiError =>
  new ShopifyApiError(status, `{"error":"${code}"}`, 'token-endpoint', code);

describe('ShopifyRetryClassifierAdapter', () => {
  const classifier = new ShopifyRetryClassifierAdapter();

  it.each([
    ['THROTTLED', throttled, 30],
    ['the orderCreate cap (L-X1)', orderCap, 65],
    ['HTTP 429', new ShopifyApiError(429), 60],
    ['HTTP 503', new ShopifyApiError(503), 300],
  ])('should defer %s without spending an attempt', (_label, cause, seconds) => {
    expect(classifier.isNonRetryable(cause)).toBe(false);
    expect(classifier.getRetryDeferral(cause)).toMatchObject({ delaySeconds: seconds });
  });

  it('should leave a contended OAuth refresh to the runner\'s penalty-free deferral', () => {
    const contended = new ContendedWriteError('another process is refreshing', 'c1');
    expect(classifier.isNonRetryable(contended)).toBe(false);
    expect(new ShopifyAuthFailureClassifierAdapter().isCredentialRejected(contended)).toBe(false);
  });

  it('should find a throttle wrapped as the cause of another error', () => {
    const wrapped = Object.assign(new Error('job failed'), { cause: throttled });
    expect(classifier.getRetryDeferral(wrapped)).toMatchObject({ delaySeconds: 30 });
  });

  it.each([
    ['a stale compare-and-set on a stock write (G05)', staleStock],
    ['a network error (G07)', new ShopifyNetworkError('socket hang up')],
    ['a 500', new ShopifyApiError(500)],
  ])('should retry %s normally', (_label, cause) => {
    expect(classifier.isNonRetryable(cause)).toBe(false);
    expect(classifier.getRetryDeferral(cause)).toBeNull();
  });

  it.each([
    ['a config exception', new ShopifyConfigException('c', 'bad')],
    ['a missing scope', new ShopifyGraphqlError(['ACCESS_DENIED'], ['denied'])],
    ['another user error', new ShopifyUserErrorsException('productSet', [{ message: 'Title is invalid' }])],
    ['a refused token request', grant('invalid_client')],
    ['a 404', new ShopifyApiError(404)],
  ])('should treat %s as terminal', (_label, cause) => {
    expect(classifier.isNonRetryable(cause)).toBe(true);
  });
});

describe('ShopifyAuthFailureClassifierAdapter', () => {
  const classifier = new ShopifyAuthFailureClassifierAdapter();

  it.each([
    ['a 401 from the Admin API (revoked token)', new ShopifyApiError(401)],
    ['the invalid-token GraphQL error', new ShopifyGraphqlError([''], ['Invalid API key or access token'])],
    ['a wrong client id or secret (G03)', grant('application_cannot_be_found')],
    ['a spent OAuth refresh token', grant('invalid_grant')],
  ])('should flag %s for re-auth', (_label, cause) => {
    expect(classifier.isCredentialRejected(cause)).toBe(true);
  });

  it.each([
    ['an app not installed on the store', grant('app_not_installed')],
    ['a store in another organization', grant('shop_not_permitted')],
    ['a missing scope', new ShopifyGraphqlError(['ACCESS_DENIED'], ['denied'])],
    ['a throttle', throttled],
  ])('should not flag %s: the credentials are valid', (_label, cause) => {
    expect(classifier.isCredentialRejected(cause)).toBe(false);
  });
});

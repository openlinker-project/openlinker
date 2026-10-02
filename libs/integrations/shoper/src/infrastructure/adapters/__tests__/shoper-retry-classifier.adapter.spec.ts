import { ShoperApiError } from '../../../domain/exceptions/shoper-api.error';
import { ShoperConfigException } from '../../../domain/exceptions/shoper-config.exception';
import { ShoperCustomerUnresolvableException } from '../../../domain/exceptions/shoper-customer-unresolvable.exception';
import { ShoperOrderUnbuildableException } from '../../../domain/exceptions/shoper-order-unbuildable.exception';
import { ShoperOrderModifiedException } from '../../../domain/exceptions/shoper-order-modified.exception';
import { ShoperDuplicateOrderException } from '../../../domain/exceptions/shoper-duplicate-order.exception';
import { ShoperPartialOrderException } from '../../../domain/exceptions/shoper-partial-order.exception';
import { ShoperInvalidStockLevelException } from '../../../domain/exceptions/shoper-invalid-stock-level.exception';
import { ShoperNetworkError } from '../../../domain/exceptions/shoper-network.error';
import { ShoperNotMappedException } from '../../../domain/exceptions/shoper-not-mapped.exception';
import { ShoperNotSupportedException } from '../../../domain/exceptions/shoper-not-supported.exception';
import { ShoperStockNotFoundException } from '../../../domain/exceptions/shoper-stock-not-found.exception';
import { ShoperWarehousesNotSupportedException } from '../../../domain/exceptions/shoper-warehouses-not-supported.exception';
import { ShoperRetryClassifierAdapter } from '../shoper-retry-classifier.adapter';

describe('ShoperRetryClassifierAdapter', () => {
  const classifier = new ShoperRetryClassifierAdapter();

  it.each([
    ['a config exception', new ShoperConfigException('c', 'no token')],
    ['a not-supported exception', new ShoperNotSupportedException('createProduct')],
    ['a warehouses-not-supported exception', new ShoperWarehousesNotSupportedException('c')],
    ['an unbuildable order', new ShoperOrderUnbuildableException('c', 'no currency')],
    ['an edited order left alone', new ShoperOrderModifiedException('c', '10', 'm', '1/2 lines')],
    ['a duplicated order', new ShoperDuplicateOrderException('c', 'ol_order_1', ['10', '11'])],
    ['an unresolvable customer', new ShoperCustomerUnresolvableException('c', 'no email')],
    ['a not-mapped exception', new ShoperNotMappedException('p', 'c')],
    ['a RangeError from the adapter’s own bounds', new RangeError('window')],
  ])('should treat %s as terminal: re-running the job fails identically', (_label, cause) => {
    expect(classifier.isNonRetryable(cause)).toBe(true);
  });

  it('should keep a partial order retryable: the retry removes the stale header and recreates', () => {
    expect(
      classifier.isNonRetryable(new ShoperPartialOrderException('c', '10', 1, 2, new Error('x'))),
    ).toBe(false);
  });

  it.each([400, 401, 403, 410, 422])('should treat HTTP %i as terminal', (status) => {
    expect(classifier.isNonRetryable(new ShoperApiError(status))).toBe(true);
  });

  describe('a 404', () => {
    it('should be terminal when Shoper itself reported the resource gone (its error envelope)', () => {
      expect(
        classifier.isNonRetryable(new ShoperApiError(404, 'invalid_request', 'Resource not found')),
      ).toBe(true);
    });

    it('should stay retryable when it is bare: a proxy or maintenance page clears on its own', () => {
      expect(classifier.isNonRetryable(new ShoperApiError(404))).toBe(false);
      expect(classifier.isNonRetryable(new ShoperApiError(404, 'server_error'))).toBe(false);
    });
  });

  it.each([408, 429, 500, 502, 503, 504])('should keep HTTP %i retryable', (status) => {
    expect(classifier.isNonRetryable(new ShoperApiError(status))).toBe(false);
  });

  it.each([
    ['an inferred stock absence', new ShoperStockNotFoundException('p', 'c')],
    ['an unreadable stock level', new ShoperInvalidStockLevelException('181', '93', 'c')],
  ])('should keep %s retryable: a re-read is what can clear it', (_label, cause) => {
    expect(classifier.isNonRetryable(cause)).toBe(false);
  });

  it('should keep a network failure retryable', () => {
    expect(classifier.isNonRetryable(new ShoperNetworkError('ECONNRESET'))).toBe(false);
    expect(classifier.isNonRetryable(new ShoperNetworkError('slow', true))).toBe(false);
  });

  it('should leave an unrelated throwable to the default (retryable)', () => {
    expect(classifier.isNonRetryable(new Error('boom'))).toBe(false);
    expect(classifier.isNonRetryable('boom')).toBe(false);
    expect(classifier.isNonRetryable(undefined)).toBe(false);
  });
});

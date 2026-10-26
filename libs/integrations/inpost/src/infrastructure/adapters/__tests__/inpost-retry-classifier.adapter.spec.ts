/**
 * InPost Retry Classifier Adapter — unit tests
 *
 * @module libs/integrations/inpost/src/infrastructure/adapters/__tests__
 */
import { InpostRetryClassifierAdapter } from '../inpost-retry-classifier.adapter';
import { InpostAmbiguousWriteException } from '../../../domain/exceptions/inpost-ambiguous-write.exception';
import { InpostNetworkException } from '../../../domain/exceptions/inpost-network.exception';
import { InpostUnauthorizedException } from '../../../domain/exceptions/inpost-unauthorized.exception';

describe('InpostRetryClassifierAdapter', () => {
  const adapter = new InpostRetryClassifierAdapter();

  it('classifies InpostAmbiguousWriteException (ambiguous 5xx) as non-retryable (#3469)', () => {
    expect(
      adapter.isNonRetryable(
        new InpostAmbiguousWriteException('ambiguous', 'POST', '/v1/organizations/org-1/shipments', 500),
      ),
    ).toBe(true);
  });

  it('classifies InpostAmbiguousWriteException (network error, no statusCode) as non-retryable', () => {
    expect(
      adapter.isNonRetryable(
        new InpostAmbiguousWriteException('network error', 'POST', '/v1/organizations/org-1/shipments'),
      ),
    ).toBe(true);
  });

  it('does NOT classify a plain InpostNetworkException as non-retryable', () => {
    expect(adapter.isNonRetryable(new InpostNetworkException('transient'))).toBe(false);
  });

  it('does NOT classify InpostUnauthorizedException as non-retryable (owned by the auth-failure classifier)', () => {
    expect(adapter.isNonRetryable(new InpostUnauthorizedException('bad token'))).toBe(false);
  });

  it('does NOT classify an unrecognized error as non-retryable', () => {
    expect(adapter.isNonRetryable(new Error('boom'))).toBe(false);
    expect(adapter.isNonRetryable(undefined)).toBe(false);
  });
});

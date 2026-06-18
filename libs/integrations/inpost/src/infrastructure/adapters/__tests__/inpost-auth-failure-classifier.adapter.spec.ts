/**
 * InPost Auth Failure Classifier Adapter — Unit Tests
 *
 * Pins that only `InpostUnauthorizedException` is treated as a terminal
 * credential rejection (#819) — provider rejections (validation 4xx), transient
 * network failures, and unknown errors must NOT flag the connection for re-auth.
 *
 * @module libs/integrations/inpost/src/infrastructure/adapters/__tests__
 */
import { ShippingProviderRejectionException } from '@openlinker/core/shipping';
import { InpostAuthFailureClassifierAdapter } from '../inpost-auth-failure-classifier.adapter';
import { InpostUnauthorizedException } from '../../../domain/exceptions/inpost-unauthorized.exception';
import { InpostNetworkException } from '../../../domain/exceptions/inpost-network.exception';

describe('InpostAuthFailureClassifierAdapter', () => {
  const classifier = new InpostAuthFailureClassifierAdapter();

  it('classifies InpostUnauthorizedException as a credential rejection', () => {
    expect(classifier.isCredentialRejected(new InpostUnauthorizedException('401 unauthorized'))).toBe(
      true,
    );
  });

  it('does not classify a provider rejection (validation 4xx) as a credential rejection', () => {
    const cause = new ShippingProviderRejectionException('inpost', 'target_point', 'bad point');
    expect(classifier.isCredentialRejected(cause)).toBe(false);
  });

  it('does not classify a transient network failure as a credential rejection', () => {
    expect(classifier.isCredentialRejected(new InpostNetworkException('timeout'))).toBe(false);
  });

  it('does not classify unknown errors as credential rejections', () => {
    expect(classifier.isCredentialRejected(new Error('boom'))).toBe(false);
    expect(classifier.isCredentialRejected('string error')).toBe(false);
    expect(classifier.isCredentialRejected(undefined)).toBe(false);
  });
});

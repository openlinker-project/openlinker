/**
 * DPD Auth Failure Classifier Adapter — Unit Tests
 *
 * Pins that only `DpdUnauthorizedException` is treated as a terminal credential
 * rejection (#819) — provider rejections (validation 4xx), transient network
 * failures, and unknown errors must NOT flag the connection for re-auth.
 *
 * @module libs/integrations/dpd-polska/src/infrastructure/adapters/__tests__
 */
import { ShippingProviderRejectionException } from '@openlinker/core/shipping';
import { DpdAuthFailureClassifierAdapter } from '../dpd-auth-failure-classifier.adapter';
import { DpdUnauthorizedException } from '../../../domain/exceptions/dpd-unauthorized.exception';
import { DpdNetworkException } from '../../../domain/exceptions/dpd-network.exception';

describe('DpdAuthFailureClassifierAdapter', () => {
  const classifier = new DpdAuthFailureClassifierAdapter();

  it('classifies DpdUnauthorizedException as a credential rejection', () => {
    expect(classifier.isCredentialRejected(new DpdUnauthorizedException('401 MISSING_PERMISSION'))).toBe(
      true,
    );
  });

  it('does not classify a provider rejection (validation 4xx) as a credential rejection', () => {
    const cause = new ShippingProviderRejectionException(
      'dpd',
      'INCORRECT_RECEIVER_POSTAL_CODE',
      'Incorrect receiver postal code',
    );
    expect(classifier.isCredentialRejected(cause)).toBe(false);
  });

  it('does not classify a transient network failure as a credential rejection', () => {
    expect(classifier.isCredentialRejected(new DpdNetworkException('timeout'))).toBe(false);
  });

  it('does not classify unknown errors as credential rejections', () => {
    expect(classifier.isCredentialRejected(new Error('boom'))).toBe(false);
    expect(classifier.isCredentialRejected('string error')).toBe(false);
    expect(classifier.isCredentialRejected(undefined)).toBe(false);
  });
});

/**
 * Erli Auth Failure Classifier — unit tests (#984)
 *
 * @module libs/integrations/erli/src/infrastructure/adapters/__tests__
 */
import { ErliApiException } from '../../../domain/exceptions/erli-api.exception';
import { ErliAuthenticationException } from '../../../domain/exceptions/erli-authentication.exception';
import { ErliNetworkException } from '../../../domain/exceptions/erli-network.exception';
import { ErliAuthFailureClassifierAdapter } from '../erli-auth-failure-classifier.adapter';

describe('ErliAuthFailureClassifierAdapter', () => {
  const classifier = new ErliAuthFailureClassifierAdapter();

  it('should flag an authentication error as a credential rejection', () => {
    expect(classifier.isCredentialRejected(new ErliAuthenticationException('unauth', 403))).toBe(true);
  });

  it('should not flag a deterministic 4xx as a credential rejection', () => {
    expect(classifier.isCredentialRejected(new ErliApiException('bad', 422))).toBe(false);
  });

  it('should not flag a network error as a credential rejection', () => {
    expect(classifier.isCredentialRejected(new ErliNetworkException('boom'))).toBe(false);
  });
});

/**
 * Allegro Auth Failure Classifier Adapter — Unit Tests
 *
 * Pins that only `AllegroAuthenticationException` is treated as a terminal
 * credential rejection (#819) — transient network failures, deterministic
 * API errors, and unknown errors must not flag the connection for re-auth.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters/__tests__
 */
import { AllegroAuthFailureClassifierAdapter } from '../allegro-auth-failure-classifier.adapter';
import { AllegroAuthenticationException } from '../../../domain/exceptions/allegro-authentication.exception';
import { AllegroNetworkException } from '../../../domain/exceptions/allegro-network.exception';
import { AllegroApiException } from '../../../domain/exceptions/allegro-api.exception';

describe('AllegroAuthFailureClassifierAdapter', () => {
  const classifier = new AllegroAuthFailureClassifierAdapter();

  it('classifies AllegroAuthenticationException as a credential rejection', () => {
    const cause = new AllegroAuthenticationException('Invalid refresh token', 401);
    expect(classifier.isCredentialRejected(cause)).toBe(true);
  });

  it('does not classify a transient network failure as a credential rejection', () => {
    const cause = new AllegroNetworkException('fetch failed', 'https://allegro.pl/auth/oauth/token');
    expect(classifier.isCredentialRejected(cause)).toBe(false);
  });

  it('does not classify a deterministic API error (422) as a credential rejection', () => {
    const cause = new AllegroApiException('Validation failed', 422, 'body', 'https://api.allegro.pl/x');
    expect(classifier.isCredentialRejected(cause)).toBe(false);
  });

  it('does not classify unknown errors as credential rejections', () => {
    expect(classifier.isCredentialRejected(new Error('boom'))).toBe(false);
    expect(classifier.isCredentialRejected('string error')).toBe(false);
    expect(classifier.isCredentialRejected(undefined)).toBe(false);
  });
});

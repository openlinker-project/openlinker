/**
 * Subiekt Auth Failure Classifier — unit tests (#3358)
 *
 * @module libs/integrations/subiekt/src/infrastructure/adapters/__tests__
 */
import { SubiektBridgeAuthError } from '../../../domain/exceptions/subiekt-bridge-auth.exception';
import { SubiektBridgeUnreachableError } from '../../../bridge/subiekt-bridge.errors';
import { SubiektRejectedError } from '../../../bridge/subiekt-bridge.errors';
import { SubiektAuthFailureClassifierAdapter } from '../subiekt-auth-failure-classifier.adapter';

describe('SubiektAuthFailureClassifierAdapter', () => {
  const classifier = new SubiektAuthFailureClassifierAdapter();

  it('flags a bridge 401/403 as a credential rejection', () => {
    expect(classifier.isCredentialRejected(new SubiektBridgeAuthError(401))).toBe(true);
    expect(classifier.isCredentialRejected(new SubiektBridgeAuthError(403))).toBe(true);
  });

  it('does not flag an unreachable bridge as a credential rejection — different failure class', () => {
    expect(classifier.isCredentialRejected(new SubiektBridgeUnreachableError('down'))).toBe(false);
  });

  it('does not flag a business rejection as a credential rejection', () => {
    expect(classifier.isCredentialRejected(new SubiektRejectedError('no such towar'))).toBe(false);
  });

  it('does not flag an unrelated error as a credential rejection', () => {
    expect(classifier.isCredentialRejected(new Error('boom'))).toBe(false);
  });
});

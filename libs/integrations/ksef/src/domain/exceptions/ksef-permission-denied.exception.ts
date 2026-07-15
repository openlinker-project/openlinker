/**
 * KSeF Permission Denied Exception
 *
 * Thrown for a KSeF `403` - an authorization decision where the authenticated
 * ksef-token lacks the permission the operation requires (e.g. an operator
 * generated a token WITHOUT the "wystawianie faktur" / invoice-issuance grant, or
 * with a narrower scope). Distinct from `KsefAuthenticationException` (a `401`
 * credential rejection): the credential IS valid, it just is not authorized for
 * this action - refreshing the token can never change that, so it is non-retryable.
 *
 * Extends `KsefApiException` so existing `instanceof KsefApiException` handling
 * (the client's non-retryable fast-fail, the connection tester's failure mapping)
 * keeps working unchanged, while callers that care can narrow to this type to
 * surface a least-privilege / missing-permission hint to the operator.
 *
 * KSeF exposes no token-scope introspection endpoint, so this runtime 403 is the
 * earliest machine-detectable signal that a token is under-privileged - see the
 * setup-guide compliance caveats.
 *
 * `responseBody` is diagnostics-only (inherited) - never logged above `debug`,
 * never carries credential material.
 *
 * @module libs/integrations/ksef/src/domain/exceptions
 */
import { KsefApiException } from './ksef-api.exception';

export class KsefPermissionDeniedException extends KsefApiException {
  constructor(message: string, responseBody?: string, url?: string) {
    super(message, 403, responseBody, url);
    this.name = 'KsefPermissionDeniedException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, KsefPermissionDeniedException);
    }
  }
}

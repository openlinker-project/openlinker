/**
 * Subiekt Auth Failure Classifier Adapter (#3358)
 *
 * Implements `AuthFailureClassifierPort` for Subiekt — answers the runner's
 * "does this terminal failure mean the credentials were rejected (re-auth
 * required)?" so a bridge outage/bad-token connection at least PASSIVELY
 * flips to `needs_reauth` on its own next failing job, since before this the
 * plugin registered no classifier at all and a bridge outage produced no
 * connection-status signal whatsoever.
 *
 * Credential-rejection (`true`): `SubiektBridgeAuthError` only — thrown when
 * the bridge itself answers 401/403 (a bad/missing bridge token), which is
 * exactly a revoked/misconfigured credential. A plain unreachable bridge
 * (`SubiektBridgeUnreachableError`/`…WithPhaseError`) is NOT a credential
 * problem — it's a network/process outage, and flipping the connection to
 * `needs_reauth` for that would tell the operator to re-enter a token that
 * was never the problem.
 *
 * @module libs/integrations/subiekt/src/infrastructure/adapters
 * @implements {AuthFailureClassifierPort}
 */
import type { AuthFailureClassifierPort } from '@openlinker/core/sync';
import { SubiektBridgeAuthError } from '../../domain/exceptions/subiekt-bridge-auth.exception';

export class SubiektAuthFailureClassifierAdapter implements AuthFailureClassifierPort {
  isCredentialRejected(cause: unknown): boolean {
    return cause instanceof SubiektBridgeAuthError;
  }
}

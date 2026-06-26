/**
 * KSeF JWT Expiry Parser
 *
 * Pure helper that decodes a KSeF access/refresh JWT and extracts its `exp`
 * claim as a `Date`. The token lifetime is read from `exp` at runtime — never
 * hardcoded — so the client's proactive-refresh window tracks the real expiry.
 *
 * The JWT signature is intentionally NOT verified. This is safe because: (1) the
 * token is server-issued and received over TLS; (2) it is never used for
 * application/security logic — only `exp` is read to compute cache TTL; (3) it
 * is echoed back to KSeF in the `Authorization` header, where the server
 * re-validates it. Never trust other JWT claims for security decisions.
 *
 * SECURITY: throws only a redacted message on a malformed token — never echoes
 * the (credential-bearing) token bytes into the error.
 *
 * @module libs/integrations/ksef/src/infrastructure/http/auth
 */
import { KsefAuthenticationException } from '../../../domain/exceptions/ksef-authentication.exception';

/**
 * Decode the JWT payload and return its `exp` as a `Date`.
 *
 * @throws KsefAuthenticationException if the token is not a well-formed JWT or
 *   has no numeric `exp` claim. The message never includes the token.
 */
export function parseJwtExpiry(token: string): Date {
  const segments = token.split('.');
  if (segments.length !== 3) {
    throw new KsefAuthenticationException('KSeF token is not a well-formed JWT (expected 3 segments)');
  }
  let payload: unknown;
  try {
    const json = Buffer.from(segments[1], 'base64url').toString('utf8');
    payload = JSON.parse(json);
  } catch {
    throw new KsefAuthenticationException('KSeF token payload is not decodable JSON');
  }
  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof (payload as { exp?: unknown }).exp !== 'number'
  ) {
    throw new KsefAuthenticationException('KSeF token has no numeric exp claim');
  }
  const expSeconds = (payload as { exp: number }).exp;
  return new Date(expSeconds * 1000);
}

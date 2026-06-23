/**
 * KSeF Auth Handshake Types
 *
 * Wire shapes for the KSeF 2.0 authentication handshake: challenge issuance,
 * the ksef-token / qualified-seal submit payloads, the reference-number poll
 * for the issued session, and the redeem step that yields access/refresh JWTs.
 * Adapter-internal (ADR-026): NIP, faktura, KSeF status etc. never reach core.
 *
 * Endpoint shapes here are inferred from the documented KSeF 2.0 sequence; live
 * validation lands when the client is exercised against the test endpoint (C3
 * acceptance criterion). Where the spec is ambiguous the field is optional and
 * the handshake degrades safely.
 *
 * @module libs/integrations/ksef/src/infrastructure/http
 */

/**
 * Response from `POST /auth/challenge`. `challenge` is the base64 nonce the
 * client signs/encrypts; `timestamp` (server clock, ISO-8601) is folded into
 * the encrypted token payload to bind the request to this challenge window.
 */
export interface AuthChallenge {
  challenge: string;
  timestamp: string;
}

/**
 * Submit payload for the ksef-token flow (`POST /auth/ksef-token`): the
 * RSA-OAEP-encrypted (token | timestamp) blob, base64-encoded, plus the NIP
 * (context identifier) the token authenticates.
 *
 * SECURITY: `encryptedToken` is ciphertext, never the plaintext token — but it
 * is still credential-derived material and MUST NOT be logged.
 */
export interface KsefTokenEncryptionRequest {
  contextNip: string;
  encryptedToken: string;
  /** Echo of the challenge timestamp folded into the encrypted payload. */
  challengeTimestamp: string;
}

/**
 * Submit payload for the qualified-seal flow (`POST /auth/xades-signature`):
 * the XAdES-signed AuthTokenRequest XML envelope. DEFERRED: real X.509 / HSM
 * signing lands in C4; C3 ships only the unit-coverable builder shape.
 */
export interface QualifiedSealAuthRequest {
  signedXml: string;
}

/**
 * Response from a submit step (`/auth/ksef-token` or `/auth/xades-signature`).
 * KSeF issues the session asynchronously: the submit returns a
 * `referenceNumber` the client polls, not the final tokens.
 */
export interface AuthSubmitResult {
  referenceNumber: string;
}

/**
 * Status of an in-flight auth reference returned by the poll
 * (`GET /auth/{referenceNumber}`). `accessToken`/`refreshToken` are present
 * only once `status === 'completed'`.
 */
export const AuthRedeemStatusValues = ['processing', 'completed', 'failed'] as const;
export type AuthRedeemStatus = (typeof AuthRedeemStatusValues)[number];

/**
 * Poll/redeem response (`GET /auth/{referenceNumber}` then
 * `POST /auth/token/redeem`). Carries the issued JWTs once ready.
 *
 * SECURITY: token fields must never be logged.
 */
export interface AuthTokenRedeem {
  status: AuthRedeemStatus;
  accessToken?: string;
  refreshToken?: string;
}

/**
 * Refresh request/response (`POST /auth/token/refresh`). The refresh token is
 * sent in the body (NOT as a bearer header); the response carries a rotated
 * access token (and possibly a rotated refresh token).
 */
export interface AuthTokenRefreshResult {
  accessToken: string;
  refreshToken?: string;
}

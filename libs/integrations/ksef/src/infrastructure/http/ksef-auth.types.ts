/**
 * KSeF Auth Handshake Types
 *
 * Wire shapes for the KSeF 2.0 authentication handshake: challenge issuance,
 * the ksef-token / xades submit payloads, the reference-number poll for the
 * issued session, and the redeem step that yields access/refresh JWTs.
 * Adapter-internal (ADR-026): NIP, faktura, KSeF status etc. never reach core.
 *
 * Shapes here are reconciled to the AUTHORITATIVE KSeF 2.0 OpenAPI spec
 * (api-test, v2.6.1) — see `AuthenticationChallengeResponse`,
 * `InitTokenAuthenticationRequest`, `AuthenticationInitResponse`,
 * `AuthenticationOperationStatusResponse`, `AuthenticationTokensResponse`,
 * `AuthenticationTokenRefreshResponse`.
 *
 * @module libs/integrations/ksef/src/infrastructure/http
 */

/**
 * Response from `POST /auth/challenge` (`AuthenticationChallengeResponse`).
 * `challenge` is the 36-char nonce folded into the encrypted token payload;
 * `timestamp` (server clock, ISO-8601) binds the request to the challenge
 * window. `timestampMs` / `clientIp` are returned by the server but unused by
 * the handshake.
 */
export interface AuthChallenge {
  challenge: string;
  timestamp: string;
  timestampMs?: number;
  clientIp?: string;
}

/**
 * Context-identifier types KSeF accepts (`AuthenticationContextIdentifierType`).
 * The OL ksef-token flow always authenticates against a NIP.
 */
export const KsefContextIdentifierTypeValues = [
  'Nip',
  'InternalId',
  'NipVatUe',
  'PeppolId',
] as const;
export type KsefContextIdentifierType = (typeof KsefContextIdentifierTypeValues)[number];

/** The context the token authenticates (`AuthenticationContextIdentifier`). */
export interface KsefContextIdentifier {
  type: KsefContextIdentifierType;
  value: string;
}

/**
 * Submit body for the ksef-token flow (`POST /auth/ksef-token`,
 * `InitTokenAuthenticationRequest`): the previously-issued `challenge`, the
 * `contextIdentifier` the token authenticates, and the RSA-OAEP(SHA-256)
 * -encrypted `token|timestamp` blob, base64-encoded. `publicKeyId` optionally
 * identifies the MF cert used to encrypt the token (44 chars).
 *
 * SECURITY: `encryptedToken` is ciphertext, never the plaintext token — but it
 * is still credential-derived material and MUST NOT be logged.
 */
export interface InitTokenAuthenticationRequest {
  challenge: string;
  contextIdentifier: KsefContextIdentifier;
  encryptedToken: string;
  publicKeyId?: string;
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
 * Issued JWT/expiry pair (`TokenInfo`). KSeF nests every issued token under
 * this shape — `token` is the JWT, `validUntil` the server-asserted expiry.
 *
 * SECURITY: `token` must never be logged.
 */
export interface KsefTokenInfo {
  token: string;
  validUntil: string;
}

/**
 * Response from a submit step (`POST /auth/ksef-token` or
 * `/auth/xades-signature`, `AuthenticationInitResponse`). KSeF issues the
 * session asynchronously: the submit returns the `referenceNumber` to poll plus
 * a short-lived `authenticationToken` (the Bearer used to authenticate the poll
 * and the redeem call), NOT the final access/refresh tokens.
 *
 * SECURITY: `authenticationToken.token` must never be logged.
 */
export interface AuthInitResult {
  referenceNumber: string;
  authenticationToken: KsefTokenInfo;
}

/**
 * Status-info block (`StatusInfo`) carried by the operation-status poll.
 * `code` is an int32 processing-status code (100 = in progress, 200 = success;
 * 4xx = various failures per the spec's status-code table); `description` is
 * the human-readable text; `details` an optional string list.
 */
export interface KsefStatusInfo {
  code: number;
  description: string;
  details?: string[];
}

/** Processing-status codes used by the auth poll (`StatusInfo.code`). */
export const KSEF_AUTH_STATUS_IN_PROGRESS = 100;
export const KSEF_AUTH_STATUS_SUCCESS = 200;

/**
 * Poll response (`GET /auth/{referenceNumber}`,
 * `AuthenticationOperationStatusResponse`). `status.code === 200` signals the
 * session is issued and ready to redeem; `100` is still-in-progress; any other
 * code is a terminal failure. `isTokenRedeemed` / `refreshTokenValidUntil` are
 * returned post-redeem.
 */
export interface AuthOperationStatus {
  status: KsefStatusInfo;
  startDate?: string;
  isTokenRedeemed?: boolean | null;
  lastTokenRefreshDate?: string | null;
  refreshTokenValidUntil?: string | null;
}

/**
 * Redeem response (`POST /auth/token/redeem`, `AuthenticationTokensResponse`).
 * Authenticated with the submit step's `authenticationToken` as Bearer; carries
 * the final access + refresh JWTs (each a nested `TokenInfo`).
 *
 * SECURITY: token fields must never be logged.
 */
export interface AuthTokensResult {
  accessToken: KsefTokenInfo;
  refreshToken: KsefTokenInfo;
}

/**
 * Refresh response (`POST /auth/token/refresh`,
 * `AuthenticationTokenRefreshResponse`). Authenticated with the refresh token
 * as Bearer (NOT a body field); carries only a rotated access token. The
 * refresh token is not re-issued by this call.
 */
export interface AuthTokenRefreshResult {
  accessToken: KsefTokenInfo;
}

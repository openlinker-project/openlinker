# KSeF Session Crypto (C3)

KSeF-specific document-session crypto (ADR-026 — NOT a core abstraction). AES-256
document encryption with an ephemeral key wrapped under an MF RSA public key.

## Flow

1. `KsefSessionCryptoService.initializeSession()` generates an AES-256 key + IV
   via `crypto.randomBytes` (CSPRNG — never `Math.random`).
2. Fetches the MF `SymmetricKeyEncryption` public key via
   `MfPublicKeyCacheService` (cached).
3. Wraps the AES key with RSA-OAEP / MGF1 / **SHA-256** (`rsa-key-wrapper.ts`).
4. `encryptDocument` / `decryptDocument` apply AES-256-CBC with PKCS#7 padding
   (`aes-cipher.ts`; Node applies/strips PKCS#7 automatically).

The returned `SessionCryptoContext` carries the symmetric key, the RSA-wrapped
key (+ the wrapping cert's SHA-256 hash for server-side audit/rotation), and an
`expiresAt` = `min(session TTL, cert validity)`. The issuance flow (C4) reuses
one context for a batch and re-initializes before `expiresAt`.

## Crypto parameters (`ksef-crypto.constants.ts`)

These are a **wire contract**, not tunables — a mismatch is rejected by the MF
backend with an opaque 4xx, not a crypto error:

| primitive | value |
|-----------|-------|
| RSA padding | RSA-OAEP |
| OAEP / MGF1 hash | SHA-256 |
| min RSA modulus | 2048 bits |
| AES | AES-256-CBC / PKCS#7 |
| AES key / IV | 32 / 16 bytes |

Round-trip unit tests validate these against a self-generated key pair until
live KSeF test vectors land.

## MF public-key caching

`MfPublicKeyCacheService.fetchAndCachePublicKey(usage)`:

- `GET /security/public-key-certificates` returns a flat ARRAY of
  `PublicKeyCertificate` (`certificate` DER-base64, `publicKeyId`, `validFrom`/
  `validTo`, `usage` as an ARRAY). Filter by `usage` array membership
  (`KsefTokenEncryption` vs `SymmetricKeyEncryption` — required to avoid
  key-confusion), pick the latest valid cert. The selected `publicKeyId` is the
  spec selector stamped onto the init-token / encrypted-symmetric-key payloads.
- `validateMfPublicKeyCertificate` enforces the validity window + usage before
  the cert is trusted. (Root-of-trust pinning + OCSP/CRL is a tracked follow-up;
  KSeF serves these over TLS and C3 validates the window + usage.)
- Cache key is `ksef:mf-public-key:{connectionId}:{usage}` — per-connection,
  per-usage. TTL is derived from `validTo - now - 5m` (never hardcoded), so a
  rotated cert can't be served past its lifetime. A cert cached but rotated early
  is detected as stale on read and refetched.

## Reusability note

If a second CTC regime (IT SDI, ES SII) ships with identical AES + RSA-OAEP
needs, a follow-up ADR-027 should propose a domain-level
`RegulatoryTransmissionCryptoPort`. Until then this layer is KSeF-specific
(ADR-026) — see the marker comment in `ksef-session-crypto.service.ts`.

## Security

Never log key bytes, the wrapped key, plaintext, or ciphertext. Crypto failures
surface as `KsefSessionCryptoException` with a redacted message + an error code;
the underlying Node error is attached as `cause` (it carries an op/arg name, not
the bytes) and must not be serialized verbatim to an external sink.

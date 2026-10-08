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
- `validateMfPublicKeyCertificate` enforces, in order: usage, the validity
  window, chain-of-trust (against pinned MF trust anchors), and revocation (via an
  injected checker). The cache service supplies the trust anchors + revocation
  checker on every validate call. See **Chain-of-trust & revocation** below.
- Cache key is `ksef:mf-public-key:{connectionId}:{usage}` — per-connection,
  per-usage. TTL is derived from `validTo - now - 5m` (never hardcoded), so a
  rotated cert can't be served past its lifetime. A cert cached but rotated early
  is detected as stale on read and refetched.

## Chain-of-trust & revocation (#1589)

Beyond the validity window + usage checks, `validateMfPublicKeyCertificate`
verifies that a presented MF public-key cert chains to a **pinned MF trust
anchor** and is not revoked. Both steps run only when the inputs are supplied
(`MfPublicKeyCacheService` supplies them on the live fetch path); the pure
window/usage unit tests pass none and are unaffected.

### Root-CA pinning (`mf-trust-anchors.ts`)

Trust anchors are loaded, memoized per process, from:

1. `OL_KSEF_MF_ROOT_CA_PATH` env var - an absolute path to a PEM file that may
   concatenate the MF root CA **and any intermediates** that sign the leaf
   encryption certs. Every cert in the bundle is treated as a pinned issuer, so a
   leaf directly issued by (and signature-verifying against) any of them is
   trusted. Chain verification uses Node's built-in `crypto.X509Certificate` -
   **no `node-forge` / `pkijs` dependency was added.**
2. `BUNDLED_MF_ROOT_CA_PEMS` - an in-tree fallback bundle.

> **OPERATOR ACTION REQUIRED FOR PRODUCTION.** The real Ministerstwo Finansow KSeF
> PKI root CA is **NOT** bundled - `BUNDLED_MF_ROOT_CA_PEMS` ships **empty**, on
> purpose: we do not ship a guessed/fabricated CA. Until the authoritative MF root
> CA is supplied (set `OL_KSEF_MF_ROOT_CA_PATH`, or vendor the PEM into
> `BUNDLED_MF_ROOT_CA_PEMS`), the chain-of-trust check has **no anchors and is
> SKIPPED** with a loud one-time boot warning - trust falls back to TLS transport
> security only. Obtain the current MF root/intermediate CA(s) from the MF/KSeF PKI
> publication and configure it before enabling `prod`.

Rejections surface as `KsefSessionCryptoException` with `errorCode`
`CERT_UNTRUSTED_ROOT` (does not chain) or `CERT_PARSE_FAILED` (unparseable PEM).

### Revocation (`mf-certificate-revocation.ts`) - DOCUMENTED LIMITATION

Revocation is a pluggable synchronous seam (`CertificateRevocationChecker`). The
default production implementation (`NullRevocationChecker`) performs **no network
I/O** and returns `unknown` (non-fatal, logged). **Live OCSP-first / CRL-fallback
revocation over the network is DEFERRED** for this MVP: a correct OCSP client
(ASN.1 request signing, nonce handling, responder-cert validation) or CRL fetch +
signature-verify + delta handling is disproportionate to the current risk (MF
certs are short-lived and TLS-served). The seam is the single, tested extension
point - a future issue can drop in a real checker with **no change to the
validator or its call sites**. A checker that returns `revoked` causes the cert to
be rejected with `errorCode` `CERT_REVOKED` (proven by unit tests). Production
hardening may additionally choose to treat `unknown` as a rejection (fail-closed).

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

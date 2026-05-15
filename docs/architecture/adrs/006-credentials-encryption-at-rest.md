# ADR-006: AES-256-GCM credentials encryption with prod-gate

- **Status**: Accepted
- **Date**: 2026-05-15
- **Authors**: OpenLinker maintainers (retrospective documentation of decisions made in #709)

## Context

Integration credentials (PrestaShop webservice API keys, Allegro OAuth refresh tokens, AI-provider API keys, webhook signing secrets) live in the `integration_credentials` Postgres table. Before #709, credential values were stored in plaintext columns. This was operationally functional but security-untenable for an OSS release: any DB backup, replica, or read-replica access would expose every connected platform's credentials in clear.

The fix needed to balance (a) actual encryption strength, (b) operational burden (key management, key rotation), and (c) developer-mode friction (running the API locally against a dev DB shouldn't require key-management ceremony). It also had to encrypt the existing rows once at migration time, then encrypt all new writes at runtime — both paths needed to agree on the algorithm and key-loading semantics.

## Decision

Encrypt credential values **at rest with AES-256-GCM**, using a 32-byte master key loaded from the `OPENLINKER_CREDENTIALS_ENCRYPTION_KEY` environment variable (base64-encoded). Encryption is gated by environment:

- **Production** (`NODE_ENV=production`): the master key MUST be set; missing or malformed (wrong byte length) values throw at boot.
- **Development / test**: if the key is unset, the system falls back to a deterministic dev key (`sha256("openlinker-dev-credentials-key-do-not-use-in-production")`) with a one-time warning, so `pnpm dev` works without ceremony.

The ciphertext envelope is a single base64-encoded string: `base64(nonce[12] || ciphertext || authTag[16])` — one column on the row, not three. Adapters never see ciphertext; they receive decrypted values via `CredentialsResolverPort`.

The crypto primitives (algorithm, envelope format, key-loading rules) live in `libs/shared/src/crypto/crypto-primitives.ts` as pure functions. **Both** the runtime path (NestJS-injected `CryptoService`) **and** the one-shot encrypt-existing-credentials migration (`1789000000000-encrypt-integration-credentials`) call the same primitives. This is deliberate — without a shared module, the migration's algorithm and the runtime's algorithm could silently drift and corrupt the historical row vs. the new row.

## Alternatives considered

- **Symmetric encryption with a passphrase + KDF (PBKDF2 / scrypt)** — Rejected: KDF is the wrong primitive for "encrypt the same value many times under one key." Raw AES-256-GCM with random per-write nonces is the right shape.
- **AES-256-CBC instead of GCM** — Rejected: GCM is authenticated encryption; CBC alone has a tampering-vulnerability surface (padding-oracle attacks) we'd need to address with a separate HMAC. GCM gives auth + confidentiality in one primitive.
- **Use a KMS (AWS KMS / GCP KMS / HashiCorp Vault)** — Rejected for now: pulls in a heavyweight dependency and infra requirement that conflicts with the "anyone can self-host" OSS positioning. A future ADR can swap the master-key source for a KMS without changing the storage shape — the envelope is opaque to callers.
- **Postgres-level disk encryption only (no application encryption)** — Rejected: doesn't protect against logical reads (DB backups, replicas, support access). Application-layer encryption is the right primitive for this threat model.
- **Store envelope as separate `iv` / `ciphertext` / `tag` columns** — Rejected: the single-base64-string shape gives one round-trip per credential and keeps the schema minimal. Splitting the columns would force adapters or repository code to reassemble the envelope on every read.

## Consequences

**Pros:**
- Credential values are unreadable from DB backups, read replicas, or accidentally-exposed connection strings.
- One shared `crypto-primitives.ts` means the migration and the runtime cannot drift on algorithm or encoding.
- Dev-mode fallback keeps "clone + `pnpm dev`" working without ceremony, with an explicit warning so the dev key is never confused for a production key.
- Single-string envelope keeps the storage shape stable across future migrations; rotating the master key is a re-encryption pass that touches one column.

**Cons / trade-offs:**
- Every credential read decrypts; the credentials resolver caches in-process with explicit invalidation on update.
- Master-key lifecycle is on the operator. Losing the key invalidates every encrypted row — recovery requires the operator to re-enter each connection's credentials.
- Dev-mode fallback is a footgun if `NODE_ENV` is misconfigured in a prod-like environment. The boot-time check on `NODE_ENV=production` fails-fast to mitigate, but staging environments that run as `NODE_ENV=development` could write credentials under the dev key and lose them on a later `NODE_ENV` change.

## References

- Primary implementation: `libs/shared/src/crypto/crypto-primitives.ts` (pure primitives), `CryptoService` (runtime), `1789000000000-encrypt-integration-credentials` (migration).
- Primary doc: `docs/architecture-overview.md` § Identifier Mapping Service (the parent service that holds credential refs).
- Related PRs: #709 (the original implementation).
- Operational guide: `docs/operations/` (key-management runbook).

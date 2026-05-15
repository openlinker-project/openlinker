# ADR-006: AES-256-GCM credentials encryption with prod-gate

- **Status**: Accepted
- **Date**: 2026-05-15
- **Authors**: OpenLinker maintainers (retrospective documentation of decisions made in #709)

## Context

Integration credentials (PrestaShop webservice API keys, Allegro OAuth refresh tokens, AI-provider API keys, webhook signing secrets) live in the `integration_credentials` Postgres table. Before #709, credential values were stored in plaintext columns. This was operationally functional but security-untenable for an OSS release: any DB backup, replica, or read-replica access would expose every connected platform's credentials in clear.

The fix needed to balance (a) actual encryption strength, (b) operational burden (key management, key rotation), and (c) developer-mode friction (running the API locally against a dev DB shouldn't require key-management ceremony).

## Decision

Encrypt credential values **at rest with AES-256-GCM**, using a 32-byte master key sourced from `OL_CREDENTIALS_MASTER_KEY` (hex-encoded). Encryption is gated by environment:

- **Production** (`NODE_ENV=production`): the master key MUST be set at boot; missing or short keys fail-fast on startup.
- **Development / test** (`NODE_ENV !== 'production'`): if the key is unset, the system falls back to a plaintext path with a loud warning. Dev databases stay readable without ceremony.

Each credential row stores `{ iv, tag, ciphertext }` separately so we can rotate the master key by re-encrypting on read (deferred). The encryption boundary is in the `IntegrationCredentialsService` — adapters never see ciphertext; they receive decrypted values via `CredentialsResolverPort`.

## Alternatives considered

- **Symmetric encryption with a passphrase + KDF (PBKDF2/scrypt)** — Rejected: KDF is the wrong primitive for "encrypt the same value many times under one key." We want raw AES-256-GCM with random IVs.
- **AES-256-CBC instead of GCM** — Rejected: GCM is authenticated encryption; CBC alone has a tampering-vulnerability surface (padding-oracle attacks) we'd need to address with a separate HMAC. GCM gives auth + confidentiality in one primitive.
- **Use a KMS (AWS KMS / GCP KMS / HashiCorp Vault)** — Rejected for now: pulls in a heavyweight dependency and infra requirement that conflicts with the "anyone can self-host" OSS positioning. A future ADR can swap the master-key source for a KMS without changing the storage shape.
- **Encryption-at-rest only via Postgres-level disk encryption** — Rejected: doesn't protect against logical reads (DB backups, replicas, support access). Application-layer encryption is the right primitive for this threat model.

## Consequences

**Pros:**
- Credential values are unreadable from DB backups, read replicas, or accidentally-exposed connection strings.
- Master key is the single rotation point — rotating it is a re-encryption pass, not a per-credential migration.
- Dev-mode fallback keeps "clone + `pnpm dev`" working without ceremony.
- Storage shape (`iv` / `tag` / `ciphertext` columns) anticipates KMS migration without DDL churn.

**Cons / trade-offs:**
- Every credential read decrypts; for high-frequency reads the credentials resolver caches in-process (with explicit invalidation on update).
- Master key lifecycle is on the operator. Lose the key → lose every connection's credentials and the operator re-enters each.
- Dev-mode fallback path is a footgun if `NODE_ENV` is misconfigured in prod-like environments; the boot-time check fails-fast on `NODE_ENV=production` to mitigate.

## References

- Primary doc: [docs/architecture-overview.md](../../architecture-overview.md) § Identifier Mapping Service (the parent service that holds credential refs).
- Related PRs: #709 (the original implementation).
- Operational guide: [docs/operations/](../../operations/) (key-management runbook).

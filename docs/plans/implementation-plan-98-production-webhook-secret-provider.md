# Implementation Plan — Production Webhook Secret Provider (#98)

## Goal

Replace `StubWebhookSecretProvider` (env-var based) with a production-safe provider that stores per-connection webhook secrets in the encrypted credentials table, supports rotation, and never returns secrets via read endpoints.

## Non-goals

- Master crypto key rotation (follow-up)
- UI wiring of rotate button (covered by #168)
- Schema changes to `integration_credentials` (use existing `ref` column)
- Replacing credentials storage for OAuth/other secret types

## Layer

CORE / Infrastructure + Interface (new HTTP endpoint)

---

## Design

### Canonical ref format

Webhook secrets use `ref = "webhook-secret:<connectionId>"`. Reuses existing `integration_credentials.ref` unique index — no migration.

### Ciphertext envelope

`credentialsJson` (JSONB) for a webhook secret row:

```json
{ "ciphertext": "<base64(nonce[12] || ciphertext || authTag[16])>", "alg": "aes-256-gcm", "v": 1 }
```

Key source: `OPENLINKER_CREDENTIALS_ENCRYPTION_KEY` (base64, 32 bytes decoded).

### Components

1. **`CryptoService`** (`libs/shared/src/crypto/crypto.service.ts`)
   - `encrypt(plaintext: string): string` → base64 envelope
   - `decrypt(envelope: string): string`
   - Startup validation: decode key, verify length 32. Production: throw on missing/invalid. Dev/test: generate deterministic key from hardcoded seed + `logger.warn`.

2. **`WebhookSecretProviderPort`** — unchanged (already async).

3. **`CredentialsWebhookSecretProvider`** (`libs/core/src/integrations/infrastructure/adapters/credentials-webhook-secret-provider.ts`)
   - Implements port.
   - Resolution: DB lookup by ref → decrypt; if miss, delegate to env fallback (with `logger.warn("deprecated")`); if still miss, throw.
   - 60s in-memory LRU (max 256 entries) keyed by `${provider}:${connectionId}`.
   - Invalidation: public `invalidate(provider, connectionId)` called by rotate service.

4. **`WebhookSecretService`** (`libs/core/src/integrations/application/services/webhook-secret.service.ts`)
   - `rotate(provider, connectionId, actorUserId): Promise<{ secret: string }>` — generate 32-byte hex, encrypt, upsert credential row, invalidate cache, audit-log.
   - Audit log: `logger.log({ event: 'webhook_secret.rotated', actor, connectionId, provider, ts })`.

5. **HTTP**: `POST /connections/:id/webhooks/secret/rotate` (JWT-guarded)
   - Controller in existing connections interface layer.
   - Response 201: `{ secret, revealedOnce: true, warning: "This secret will not be shown again. Store it securely." }`.

6. **Module wiring**: `IntegrationsModule` binds `WEBHOOK_SECRET_PROVIDER_TOKEN` to `CredentialsWebhookSecretProvider`. `StubWebhookSecretProvider` kept in source for test fixtures only; removed from provider list.

### Env / config

- New: `OPENLINKER_CREDENTIALS_ENCRYPTION_KEY` (added to `apps/api/.env.example`, `apps/worker/.env.example`, `docker-compose.yml` dev value).
- Legacy: `OPENLINKER_WEBHOOK_SECRET__*` supported for one release via env-fallback branch; deprecation logged.

---

## Steps

1. **`libs/shared/src/crypto/crypto.service.ts`** — AES-256-GCM `encrypt`/`decrypt`, key loading with prod fail-fast / dev default. Export + barrel update.
   - AC: unit test round-trip; rejects tampered tag; fails in prod without key; dev warns + works.

2. **`libs/shared/src/crypto/crypto.service.spec.ts`** — unit tests.

3. **`libs/core/src/integrations/infrastructure/persistence/repositories/integration-credential.repository.ts`** — no schema change; accept encryption via explicit method `upsertEncrypted(ref, platformType, envelope)` that sets `encrypted=true`. Existing read path untouched (new adapter does its own decrypt via CryptoService).
   - AC: upsert test.

4. **`libs/core/src/integrations/infrastructure/adapters/credentials-webhook-secret-provider.ts`** — new adapter with DB-first, env-fallback, LRU cache.
   - AC: unit tests cover DB hit, DB miss + env hit (with deprecation log), full miss → throw, cache hit, `invalidate()` clears.

5. **`libs/core/src/integrations/application/services/webhook-secret.service.ts`** + `.service.interface.ts` — rotate logic, audit log, invalidate cache.
   - AC: unit test rotates, encrypts, persists, invalidates, logs audit event.

6. **Controller** — find existing connections controller (or add focused one): `POST /connections/:id/webhooks/secret/rotate`. Response DTO `RotateWebhookSecretResponseDto`.
   - AC: controller spec — JWT guard applied, returns 201 with `{ secret, revealedOnce: true, warning }`.

7. **`libs/core/src/integrations/integrations.module.ts`** — swap provider binding to `CredentialsWebhookSecretProvider`; register `WebhookSecretService`; keep `StubWebhookSecretProvider` file for tests but remove from providers list.

8. **Env examples + docker-compose** — add `OPENLINKER_CREDENTIALS_ENCRYPTION_KEY`.

9. **Integration test** (`apps/api/test/integration/webhooks/webhook-secret-per-connection.int-spec.ts`):
   - Rotate secret for connection A and B (different values).
   - Send signed webhook for A with A's secret → 200.
   - Send webhook for A signed with B's secret → 401.
   - AC: both assertions pass against real Postgres + Redis via Testcontainers.

10. **Update docs** — short note in `docs/dev-environment.md` (or equivalent) on the new env var.

---

## Validation

- **Architecture**: CryptoService in `shared`; provider + service + port in `core/integrations` respecting layers; controller in interface; DB access via repository.
- **Naming**: `*-provider.ts`, `*.service.ts`/`.service.interface.ts`, `*.port.ts`, `*-response.dto.ts`.
- **Security**: secrets never returned on read; rotate reveals once; audit logged; ciphertext auth-tagged; key validated at startup.
- **Tests**: unit (crypto, provider, service, controller) + integration (per-connection resolution + cross-reject).
- **Backcompat**: env fallback preserved for one release with deprecation warning.

# Implementation plan — #709 Encrypt integration credentials at rest

**Layer**: Backend / Infrastructure (persistence) + small Allegro/AI/webhook-secret call-site updates.
**Severity**: CRITICAL (security)
**Issue**: #709

## Problem

`integration_credentials.credentialsJson` (jsonb) stores third-party API credentials (Allegro OAuth refresh tokens, PrestaShop API keys) as **plaintext**. `CryptoService` (AES-256-GCM, prod-fail-closed, dev-fallback) already lives at `libs/shared/src/crypto/` and is wired into the `IntegrationsModule` — it's just not injected into `IntegrationCredentialRepository`.

Two services have worked around this with an **inner-envelope** pattern: `WebhookSecretService` and `AiProviderKeyService` encrypt their secret inline as `{ciphertext: encrypted(raw)}` and set `encrypted: true`. Allegro OAuth + PrestaShop credentials store everything plaintext.

## Goal

Single, consistent encryption-at-rest at the repository layer:

- `credentialsJson jsonb` (plaintext map) → `credentialsCiphertext varchar` (base64 envelope of `JSON.stringify(credentialsJson)`).
- `encrypted: boolean` column dropped (always-encrypted; no flag needed).
- Repository encrypts on write, decrypts on read. Domain entity exposes `credentialsJson` (decrypted JS object) — callers continue to work with object shapes.
- Inner-envelope writers (`WebhookSecretService`, `AiProviderKeyService`) drop the inline `crypto.encrypt` + `{ciphertext}` wrap; they store `{webhookSecret}` / `{apiKey}` and the repo layer handles encryption transparently.

## Non-goals

- Secret-manager backends (Vault / AWS SM / GCP SM) — out of scope.
- Per-tenant key derivation — defer until tenancy work lands.
- Removing the env-fallback `CredentialsResolverService.getFromEnvironment` entirely — only gate it to non-production in this PR.
- Zero-downtime multi-deploy migration sequence — OpenLinker is pre-1.0, no live tenants. **Single migration** that adds the new column, backfills (in the same TX), drops the old. Documented in this plan.

## Layer

Backend. New migration in `apps/api/src/migrations/`.

## Changes

### 0. Precursors — extract shared primitives

Two cross-cutting concerns the migration shares with runtime code. Land these in the **same PR but before the migration step** in the diff order so the migration's imports resolve to stable, typed symbols.

#### 0a. Crypto primitives — shared pure-function module

New file: `libs/shared/src/crypto/crypto-primitives.ts`. Pure functions, no NestJS, no DI:

```typescript
export function encryptWithKey(key: Buffer, plaintext: string): string { /* AES-256-GCM */ }
export function decryptWithKey(key: Buffer, envelope: string): string { /* AES-256-GCM */ }
export function loadEncryptionKey(env: NodeJS.ProcessEnv): Buffer { /* OPENLINKER_CREDENTIALS_ENCRYPTION_KEY + NODE_ENV=production fail-closed; dev/test deterministic fallback with warning */ }
```

Refactor `CryptoService` (`libs/shared/src/crypto/crypto.service.ts`):
- `onModuleInit()` calls `this.key = loadEncryptionKey(process.env)` (delegating fail-closed + dev-fallback semantics + warning emission).
- `encrypt(plaintext)` → `encryptWithKey(this.key, plaintext)`.
- `decrypt(envelope)` → `decryptWithKey(this.key, envelope)`.

Service-level behavior unchanged; algorithm now has one source of truth. Existing `crypto.service.spec.ts` continues to pass.

Eliminates the drift risk between the runtime service and the migration's encryption logic.

#### 0b. Ref-prefix constants — exported alongside the ref helpers

Today prefix strings live as inline literals inside two ref-builder functions:
- `libs/core/src/integrations/domain/ports/webhook-secret-provider.port.ts:50` → `webhookSecretRef(id) = 'webhook-secret:' + id`
- `libs/core/src/ai/domain/ports/ai-provider-credentials.port.ts:30` → `aiProviderCredentialsRef(provider) = 'ai-provider:' + provider`

Add exported constants in the same files:

```typescript
// webhook-secret-provider.port.ts
export const WEBHOOK_SECRET_REF_PREFIX = 'webhook-secret:';
export const webhookSecretRef = (connectionId: string): string =>
  `${WEBHOOK_SECRET_REF_PREFIX}${connectionId}`;

// ai-provider-credentials.port.ts
export const AI_PROVIDER_CREDENTIALS_REF_PREFIX = 'ai-provider:';
export const aiProviderCredentialsRef = (provider: AiProvider): string =>
  `${AI_PROVIDER_CREDENTIALS_REF_PREFIX}${provider}`;
```

Re-export both constants through the `@openlinker/core/integrations` and `@openlinker/core/ai` barrels (additive). The migration imports them via the barrels, not via deep paths.

**Pre-merge grep check** (acceptance criterion): run
```bash
grep -rn "credentialRepository\.create\|credentialRepository\.update" libs/core libs/integrations apps/api --include='*.ts' | grep -v ".spec.ts" | grep -v ".test.ts"
```
to enumerate every credential writer. Expected: `WebhookSecretService`, `AiProviderKeyService`, `AllegroOauthService` — exactly three production writers, plus the test helper. A fourth writer at an unknown ref prefix would break the migration's inner-envelope inference (and the migration file's JSDoc says so).

### 1. Migration

`apps/api/src/migrations/1789000000000-encrypt-integration-credentials.ts` (single transactional migration):

```typescript
import { encryptWithKey, decryptWithKey, loadEncryptionKey } from '@openlinker/shared';
import { WEBHOOK_SECRET_REF_PREFIX } from '@openlinker/core/integrations';
import { AI_PROVIDER_CREDENTIALS_REF_PREFIX } from '@openlinker/core/ai';

public async up(queryRunner: QueryRunner): Promise<void> {
  const key = loadEncryptionKey(process.env);  // throws under NODE_ENV=production when unset

  // 1. Add new column
  await queryRunner.query(
    `ALTER TABLE "integration_credentials" ADD "credentialsCiphertext" varchar`,
  );

  // 2. Backfill
  const rows: Array<{ id: string; ref: string; credentialsJson: Record<string, unknown>; encrypted: boolean }> =
    await queryRunner.query(
      `SELECT id, ref, "credentialsJson", encrypted FROM "integration_credentials"`,
    );

  for (const row of rows) {
    let plain: Record<string, unknown>;
    // Collapse inner-envelope rows into the new outer shape.
    // Before: { ciphertext: <encrypted(secret)> } + encrypted=true
    // After:  { webhookSecret: <secret> } / { apiKey: <secret> } — plaintext object,
    //         OUTER encryption handles confidentiality.
    if (row.encrypted && typeof row.credentialsJson?.ciphertext === 'string') {
      const innerPlain = decryptWithKey(key, row.credentialsJson.ciphertext);
      if (row.ref.startsWith(WEBHOOK_SECRET_REF_PREFIX)) {
        plain = { webhookSecret: innerPlain };
      } else if (row.ref.startsWith(AI_PROVIDER_CREDENTIALS_REF_PREFIX)) {
        plain = { apiKey: innerPlain };
      } else {
        throw new Error(
          `[1789000000000-encrypt-integration-credentials] inner-envelope row ${row.id} (ref=${row.ref}) ` +
            `does not match any known inner-envelope ref prefix. ` +
            `Expected one of: '${WEBHOOK_SECRET_REF_PREFIX}', '${AI_PROVIDER_CREDENTIALS_REF_PREFIX}'. ` +
            `A new inner-envelope writer was added without updating this migration.`,
        );
      }
    } else {
      plain = row.credentialsJson;
    }

    const ciphertext = encryptWithKey(key, JSON.stringify(plain));
    await queryRunner.query(
      `UPDATE "integration_credentials" SET "credentialsCiphertext" = $1 WHERE id = $2`,
      [ciphertext, row.id],
    );
  }

  // 3. Enforce NOT NULL + drop old columns
  await queryRunner.query(
    `ALTER TABLE "integration_credentials" ALTER COLUMN "credentialsCiphertext" SET NOT NULL`,
  );
  await queryRunner.query(`ALTER TABLE "integration_credentials" DROP COLUMN "credentialsJson"`);
  await queryRunner.query(`ALTER TABLE "integration_credentials" DROP COLUMN encrypted`);
}
```

The migration uses the shared primitive functions extracted in step 0a, and ref-prefix constants from step 0b. Unknown ref prefixes on inner-envelope rows throw with an actionable diagnostic.

**Down-migration** (`down()`) restores the schema structurally (re-creates `credentialsJson jsonb NOT NULL` + `encrypted boolean DEFAULT false`) but the column will be empty `{}` on previously-encrypted rows. This is **intentional and data-irreversible** by design — decrypting back to plaintext is exactly the breach this migration prevents. The migration file's JSDoc header MUST explicitly call this out:

```typescript
/**
 * Encrypt Integration Credentials Migration (#709)
 *
 * One-way data migration: existing plaintext + inner-envelope rows are
 * re-encrypted under the outer-envelope shape and the legacy columns
 * are dropped.
 *
 * ⚠️  `down()` IS DATA-IRREVERSIBLE: running it after `up()` has executed
 * restores the legacy schema (credentialsJson jsonb, encrypted boolean) but
 * leaves `credentialsJson = {}` on every previously-encrypted row.
 * Recovering plaintext is intentionally impossible — the entire point of
 * encryption-at-rest is that the DB does not contain plaintext. Operators
 * who need to roll back MUST take a fresh DB backup BEFORE running this
 * migration and restore from backup instead of `migration:revert`.
 *
 * Aligns with `docs/migrations.md` § Best Practices "implement both up()
 * and down()": this `down()` is structurally reversible (schema) but
 * data-irreversible by intent.
 */
```

### 2. ORM entity

`libs/core/src/integrations/infrastructure/persistence/entities/integration-credential.orm-entity.ts`:

```typescript
@Column({ type: 'varchar' })
credentialsCiphertext!: string;
// drop credentialsJson + encrypted
```

### 3. Domain entity + port

`libs/core/src/integrations/domain/entities/integration-credential.entity.ts` — drop `encrypted: boolean`. Keep `credentialsJson: Record<string, unknown>` (this is the decrypted JS object exposed to callers — the on-disk envelope is repository-internal).

`libs/core/src/integrations/domain/ports/integration-credential-repository.port.ts`:
- `CredentialCreate` — drop `encrypted?: boolean`.
- `CredentialUpdate` — drop `encrypted?: boolean`.

### 4. Repository

`libs/core/src/integrations/infrastructure/persistence/repositories/integration-credential.repository.ts`:

```typescript
@Injectable()
export class IntegrationCredentialRepository implements IntegrationCredentialRepositoryPort {
  constructor(
    @InjectRepository(IntegrationCredentialOrmEntity)
    private readonly repository: Repository<IntegrationCredentialOrmEntity>,
    private readonly crypto: CryptoService,
  ) {}

  // toOrm: entity.credentialsCiphertext = crypto.encrypt(JSON.stringify(payload.credentialsJson))
  // toDomain: credentialsJson = JSON.parse(crypto.decrypt(entity.credentialsCiphertext))
  // update: re-encrypt the full patched object (read-modify-write on the JS object)
}
```

### 5. Call-site updates (drop the inner-envelope workaround)

- **`libs/core/src/integrations/application/services/webhook-secret.service.ts`** — drop `crypto.encrypt(secret)` + `{ciphertext}` wrap; store `{webhookSecret: secret}` + drop `encrypted: true`. The service no longer needs `CryptoService` injected (the repo handles encryption).
- **`libs/core/src/ai/application/services/ai-provider-key.service.ts`** — same pattern; store `{apiKey: apiKey}` + drop `encrypted: true`. Drop the `CryptoService` injection.
- **`libs/core/src/integrations/infrastructure/adapters/credentials-webhook-secret.adapter.ts`** — drop the inner `decrypt(credential.credentialsJson.ciphertext)` chain; read `credential.credentialsJson.webhookSecret` directly. Drop `CryptoService` injection.
- **`libs/core/src/ai/infrastructure/adapters/credentials-ai-provider.adapter.ts`** — same pattern. Drop the env-fallback's deprecated-warning narrative since the inner-envelope pattern is gone.
- **`apps/api/src/integrations/application/services/allegro-oauth.service.ts:336`** — drop `encrypted: false` from the credential-create payload. Update the misleading "For MVP, credentials are stored unencrypted" comment — they ARE encrypted now.
- **`apps/api/test/integration/helpers/test-connection.helper.ts:179`** — drop `encrypted: false`.

### 6. Production env-fallback gate

`libs/core/src/integrations/infrastructure/credentials/credentials-resolver.service.ts:getFromEnvironment`: throw when `NODE_ENV=production`. Helpful error message pointing to `db:` refs as the production-supported backend. Dev/test untouched.

### 7. Tests

**Unit tests**:
- `integration-credential.repository.spec.ts` (new) — mock `CryptoService` + the typeorm repository, assert `toOrm` writes `crypto.encrypt(JSON.stringify(payload))` and `toDomain` round-trips through `crypto.decrypt → JSON.parse`. Pin the contract.
- Update existing `webhook-secret.service.spec.ts` and `credentials-webhook-secret.adapter.spec.ts` to reflect the new shape (`{webhookSecret}` no inner ciphertext).
- Update existing `ai-provider-key.service`-related specs.

**Integration test** (the key acceptance criterion):
- `apps/api/test/integration/connection-credentials.int-spec.ts` — extend the existing spec with: write a credential containing a unique sentinel string (e.g. `'SENTINEL_PLAINTEXT_MUST_NOT_LEAK'`), `SELECT credentialsCiphertext FROM integration_credentials WHERE ref = ?`, assert the persisted bytes do NOT contain the sentinel. Then `getByRef` and assert the decrypted round-trip returns the original.
- **Helper split**: keep the existing `findCredentialByRef` returning the **raw OrmEntity** (now reading `credentialsCiphertext` not `credentialsJson`) — that's the seam that powers the sentinel-not-in-persisted-bytes assertion (the load-bearing security AC). Add a parallel assertion that routes through `repository.getByRef(ref)` for the decrypted round-trip equality check. Two distinct things being asserted, two distinct paths through the spec.

### 8. Docs

- `docs/operations/credentials-rotation.md` (new) — how to rotate `OPENLINKER_CREDENTIALS_ENCRYPTION_KEY`. Single-key today, so rotation = re-encrypt every row + restart. Document the dual-key transition pattern as a follow-up.
- `SECURITY.md` — file already exists (covers Security Policy + Reporting + Supported Versions); has **no** "Threat model" section today. This PR adds a new top-level "## Threat Model" section describing the credentials-at-rest control (algorithm, envelope format, key source, fail-closed semantics under `NODE_ENV=production`, the env-fallback non-prod gate). Sized as a new section, not an edit to existing content.

## Acceptance criteria

- `libs/shared/src/crypto/crypto-primitives.ts` exists; `CryptoService` delegates to it; no algorithm duplication between runtime and migration paths.
- `WEBHOOK_SECRET_REF_PREFIX` / `AI_PROVIDER_CREDENTIALS_REF_PREFIX` are exported constants the ref-builder helpers compose against; both are re-exported from `@openlinker/core/integrations` and `@openlinker/core/ai` barrels.
- Pre-merge grep enumerates exactly the expected three credential writers (`WebhookSecretService`, `AiProviderKeyService`, `AllegroOauthService`); a fourth writer at an unknown ref prefix would have failed the migration in CI.
- `IntegrationCredentialOrmEntity` has `credentialsCiphertext: string` and no `credentialsJson` / `encrypted` columns.
- `IntegrationCredentialRepository.create/update` writes only ciphertext. Unit test pins this.
- `getByRef` returns the decrypted JS object (`credential.credentialsJson` is the unwrapped object).
- **Integration test**: SELECT raw `credentialsCiphertext` bytes via `findCredentialByRef` (raw OrmEntity) — assert sentinel-plaintext is NOT present. Then `repository.getByRef(ref)` — assert decrypted round-trip equality.
- Inner-envelope pattern removed from `WebhookSecretService` + `AiProviderKeyService` + their adapters. The `{ciphertext}` shape no longer appears anywhere in the code.
- `CredentialsResolverService.getFromEnvironment` throws under `NODE_ENV=production`.
- `docs/operations/credentials-rotation.md` exists.
- `SECURITY.md` has a new `## Threat Model` section describing the credentials-at-rest control.
- Migration file's JSDoc explicitly warns that `down()` is data-irreversible and operators must restore from backup, not `migration:revert`.
- Migration runs idempotently on a clean DB (covered by Testcontainers boot in int-spec) and on a seeded DB (manual smoke if practical).
- `pnpm lint` / `pnpm type-check` / `pnpm test` / `pnpm --filter @openlinker/api migration:show` green.

## Risks

- **Migration backfill fails closed if `OPENLINKER_CREDENTIALS_ENCRYPTION_KEY` is unset in production.** Operators MUST set the key before running migrations. Documented in `credentials-rotation.md` and emitted as a clear error if missing.
- **Inner-envelope rows in production**: webhook-secret + AI-key rows already have inner-encrypted ciphertext. The migration decrypts that inner value once (using the same key), then re-wraps + re-encrypts with the outer envelope. Same key for both layers; migration owns the unwrap path.
- **Allegro OAuth refresh tokens** are the highest-value target. The OAuth flow stores them plaintext today. Post-migration they're encrypted at rest; the OAuth service no longer needs (and can't request) the `encrypted: false` flag.
- **Down-migration is irreversible** in the data sense (we can't decrypt back to plaintext if the goal is to revert encryption-at-rest — that defeats the purpose). Structural revert is supported but rows are not retrievable as plaintext JSON. Document.

## Estimated size

~17 files modified + 1 new migration + 1 new shared-primitives file + 1 new doc + new section in `SECURITY.md`. Net LOC slightly positive (the shared crypto-primitives module is genuinely new code, even though it's a refactor-extraction; +~50 LOC there counterbalances the encrypt/decrypt-replaces-plaintext deltas elsewhere).

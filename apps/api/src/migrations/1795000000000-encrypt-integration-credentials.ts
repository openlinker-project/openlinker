/**
 * Encrypt Integration Credentials Migration (#709)
 *
 * One-way data migration. Replaces the `credentialsJson jsonb` + `encrypted boolean`
 * columns with a single `credentialsCiphertext varchar` column containing the
 * AES-256-GCM envelope of `JSON.stringify(credentialsJson)`. Collapses the
 * inner-envelope pattern used by `WebhookSecretService` and `AiProviderKeyService`
 * (where `credentialsJson = { ciphertext: <inner-encrypted> }`) into the unified
 * outer-encryption shape so the runtime read path no longer carries a
 * special-case "decrypt inner ciphertext" branch.
 *
 * ⚠️  `down()` IS DATA-IRREVERSIBLE. Running it after `up()` restores the legacy
 * schema (`credentialsJson jsonb`, `encrypted boolean`) but leaves
 * `credentialsJson = {}` on every previously-encrypted row. Recovering plaintext
 * is intentionally impossible — the entire point of encryption-at-rest is that
 * the DB does not contain plaintext. Operators who need to roll back MUST take
 * a fresh DB backup BEFORE running this migration and restore from backup
 * instead of `migration:revert`. This aligns with `docs/migrations.md` § Best
 * Practices "implement both up() and down()": `down()` is structurally
 * reversible (schema) but data-irreversible by intent.
 *
 * @module apps/api/src/migrations
 * @see libs/shared/src/crypto/crypto-primitives.ts — pure crypto primitives
 *      shared with the runtime `CryptoService`. One source of truth for the
 *      envelope shape and key-loading semantics.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

import {
  decryptWithKey,
  encryptWithKey,
  loadEncryptionKey,
} from '@openlinker/shared';
import { AI_PROVIDER_CREDENTIALS_REF_PREFIX } from '@openlinker/core/ai';
import { WEBHOOK_SECRET_REF_PREFIX } from '@openlinker/core/integrations';

interface LegacyRow {
  id: string;
  ref: string;
  credentialsJson: Record<string, unknown>;
  encrypted: boolean;
}

export class EncryptIntegrationCredentials1795000000000 implements MigrationInterface {
  name = 'EncryptIntegrationCredentials1795000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Fail-closed under NODE_ENV=production when the encryption key is unset.
    // Operators MUST set OPENLINKER_CREDENTIALS_ENCRYPTION_KEY before running.
    const { key } = loadEncryptionKey(process.env);

    // 1. Add new column (nullable initially so the backfill can populate it).
    await queryRunner.query(
      `ALTER TABLE "integration_credentials" ADD "credentialsCiphertext" varchar`,
    );

    // 2. Backfill every existing row.
    const rows = (await queryRunner.query(
      `SELECT id, ref, "credentialsJson", encrypted FROM "integration_credentials"`,
    )) as LegacyRow[];

    for (const row of rows) {
      const plain = unwrapPlaintext(row, key);
      const ciphertext = encryptWithKey(key, JSON.stringify(plain));
      await queryRunner.query(
        `UPDATE "integration_credentials" SET "credentialsCiphertext" = $1 WHERE id = $2`,
        [ciphertext, row.id],
      );
    }

    // 3. Enforce NOT NULL and drop the legacy columns.
    await queryRunner.query(
      `ALTER TABLE "integration_credentials" ALTER COLUMN "credentialsCiphertext" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "integration_credentials" DROP COLUMN "credentialsJson"`,
    );
    await queryRunner.query(`ALTER TABLE "integration_credentials" DROP COLUMN encrypted`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Structural revert only. Plaintext is NOT recoverable — see file header.
    await queryRunner.query(
      `ALTER TABLE "integration_credentials" ADD "credentialsJson" jsonb`,
    );
    await queryRunner.query(
      `UPDATE "integration_credentials" SET "credentialsJson" = '{}'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "integration_credentials" ALTER COLUMN "credentialsJson" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "integration_credentials" ADD "encrypted" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "integration_credentials" DROP COLUMN "credentialsCiphertext"`,
    );
  }
}

/**
 * Convert a legacy row into the outer-encryption plaintext shape.
 *
 * - Rows already in the inner-envelope shape (`{ ciphertext: <inner> }` + encrypted=true)
 *   get the inner value decrypted, then re-wrapped as a typed plaintext object
 *   keyed by the writer that produced them (`{ webhookSecret }` or `{ apiKey }`).
 * - All other rows pass through as-is — they're plaintext JSON objects that the
 *   outer encryption will protect for the first time.
 *
 * An inner-envelope row at an unknown ref prefix is a regression: a fourth
 * credential writer was added without updating this migration. Throw with an
 * actionable diagnostic instead of silently corrupting the row.
 */
function unwrapPlaintext(row: LegacyRow, key: Buffer): Record<string, unknown> {
  const innerCiphertext = row.credentialsJson?.ciphertext;
  const isInnerEnvelope = row.encrypted && typeof innerCiphertext === 'string';
  if (!isInnerEnvelope) {
    return row.credentialsJson;
  }

  const innerPlain = decryptWithKey(key, innerCiphertext);
  if (row.ref.startsWith(WEBHOOK_SECRET_REF_PREFIX)) {
    return { webhookSecret: innerPlain };
  }
  if (row.ref.startsWith(AI_PROVIDER_CREDENTIALS_REF_PREFIX)) {
    return { apiKey: innerPlain };
  }
  throw new Error(
    `[1795000000000-encrypt-integration-credentials] inner-envelope row ${row.id} ` +
      `(ref=${row.ref}) does not match any known inner-envelope ref prefix. ` +
      `Expected one of: '${WEBHOOK_SECRET_REF_PREFIX}', '${AI_PROVIDER_CREDENTIALS_REF_PREFIX}'. ` +
      `A new inner-envelope writer was added without updating this migration.`,
  );
}

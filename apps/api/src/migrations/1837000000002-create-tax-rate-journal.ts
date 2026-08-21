/**
 * Append-only tax-rate provenance journal (#2250, ADR-052 § 4).
 *
 * One row per CHANGE in an observed rate, never one per read. A mutable
 * "source" field can only say how things stand now; it cannot answer when the
 * shop changed the rate, what OpenLinker last wrote onto a channel, or whether
 * somebody overwrote it afterwards - and the last of those is what makes a
 * shop-versus-channel disagreement attributable rather than mysterious.
 *
 * No unique constraint: rows are meant to repeat over time, and the "write only
 * on a change" rule is a service-level dedup against the latest row rather than
 * a constraint. The single index serves both reads the model has - the latest
 * entry for one item on one connection, and the latest per connection for one
 * item - because both walk the same prefix.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTaxRateJournal1837000000002 implements MigrationInterface {
  name = 'CreateTaxRateJournal1837000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tax_rate_journal" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "productId" text NOT NULL,
        "variantId" text,
        "connectionId" uuid NOT NULL,
        "origin" character varying(32) NOT NULL,
        "taxRate" character varying(16),
        "frozen" boolean NOT NULL DEFAULT false,
        "observedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tax_rate_journal" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tax_rate_journal_latest"
        ON "tax_rate_journal" ("productId", "variantId", "connectionId", "observedAt" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tax_rate_journal_latest"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tax_rate_journal"`);
  }
}

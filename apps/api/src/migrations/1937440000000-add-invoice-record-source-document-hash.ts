/**
 * Add Invoice Record Source Document Hash Migration
 *
 * Adds the nullable `sourceDocumentHash` text column to `invoice_records`
 * (#3620): the Base64URL SHA-256 of the stored `sourceDocument` bytes, written
 * with it at issue time, so a verification link is built from a hash taken once
 * from the bytes that were sent instead of being recomputed on every read.
 * Neutral (ADR-026): opaque document bytes, no regime vocabulary. Nullable with
 * no default and NO backfill - existing rows read NULL and a reader falls back
 * to hashing their stored `sourceDocument`, which yields the same value.
 *
 * Generated: 2026-10-26 (synthetic sequential prefix per docs/migrations.md #1013,
 * sorted after main's newest migration).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInvoiceRecordSourceDocumentHash1937440000000 implements MigrationInterface {
  name = 'AddInvoiceRecordSourceDocumentHash1937440000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoice_records" ADD COLUMN IF NOT EXISTS "sourceDocumentHash" text`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoice_records" DROP COLUMN IF EXISTS "sourceDocumentHash"`
    );
  }
}

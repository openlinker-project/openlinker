/**
 * Offer Creation Record Test Fixtures
 *
 * Factory helper for seeding `offer_creation_records` rows in integration
 * tests. Returns the inserted row's primary key so tests can reference it.
 *
 * @module apps/api/test/integration/fixtures
 */
import { DataSource } from 'typeorm';

export interface TestOfferCreationRecordOverrides {
  internalVariantId?: string;
  connectionId?: string;
  externalOfferId?: string | null;
  status?: 'pending' | 'draft' | 'validating' | 'active' | 'failed';
  publishImmediately?: boolean;
  /** Seeds the jsonb `request` column. `null` to omit the snapshot. */
  request?: Record<string, unknown> | null;
}

/**
 * Insert an `offer_creation_records` row directly via SQL and return its id.
 *
 * Uses raw SQL (not `DataSource.getRepository(...).save`) because the ORM
 * entity lives in `@openlinker/core` and integration tests avoid importing
 * core ORM entities to keep the fixture layer lightweight. The same pattern
 * is used by connection/user fixtures.
 */
export async function createTestOfferCreationRecord(
  dataSource: DataSource,
  overrides?: TestOfferCreationRecordOverrides,
): Promise<string> {
  const requestValue = overrides?.request === undefined ? null : overrides.request;
  const result = (await dataSource.query(
    `INSERT INTO offer_creation_records
       ("internalVariantId", "connectionId", "externalOfferId", "status", "errors", "publishImmediately", "request")
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING id`,
    [
      overrides?.internalVariantId ?? 'ol_variant_abc123',
      overrides?.connectionId ?? '11111111-1111-4111-8111-111111111111',
      overrides?.externalOfferId ?? null,
      overrides?.status ?? 'pending',
      null,
      overrides?.publishImmediately ?? false,
      requestValue === null ? null : JSON.stringify(requestValue),
    ],
  )) as Array<{ id: string }>;

  return result[0].id;
}

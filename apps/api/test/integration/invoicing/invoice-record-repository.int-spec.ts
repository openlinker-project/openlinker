/**
 * Invoice Records persistence Integration Test (#751)
 *
 * Proves the `CreateInvoiceRecords1808000000000` migration + real Postgres
 * behaviour for the invoicing foundation (ADR-026): the table + columns exist,
 * and the partial-unique fiscal-dedup index (`(connectionId, idempotencyKey)
 * WHERE idempotencyKey IS NOT NULL`) actually rejects a duplicate while still
 * allowing many NULL-key rows. The repository's domain-error conversion and
 * mapping are unit-tested separately; this spec exercises the real index the
 * unit test can only mock.
 *
 * @module apps/api/test/integration/invoicing
 */
import { InvoiceRecordOrmEntity } from '@openlinker/core/invoicing/orm-entities';
import type { Repository } from 'typeorm';

import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from '../setup';

const CONNECTION_ID = '00000000-0000-0000-0000-000000000751';

function row(overrides: Partial<InvoiceRecordOrmEntity> = {}): InvoiceRecordOrmEntity {
  const entity = new InvoiceRecordOrmEntity();
  Object.assign(
    entity,
    {
      connectionId: CONNECTION_ID,
      orderId: 'ol_order_int1',
      providerType: 'subiekt',
      documentType: 'invoice',
      status: 'pending',
      idempotencyKey: 'idem-int-1',
    },
    overrides,
  );
  return entity;
}

describe('invoice_records persistence (integration)', () => {
  let harness: IntegrationTestHarness;
  let repo: Repository<InvoiceRecordOrmEntity>;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  beforeEach(async () => {
    await resetTestHarness();
    repo = harness.getDataSource().getRepository(InvoiceRecordOrmEntity);
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('persists a row with neutral defaults and reads it back', async () => {
    const saved = await repo.save(row());
    expect(saved.id).toBeDefined();

    const found = await repo.findOne({
      where: { orderId: 'ol_order_int1', connectionId: CONNECTION_ID },
    });
    expect(found?.providerType).toBe('subiekt');
    expect(found?.documentType).toBe('invoice');
    // Migration default applied without the app setting it explicitly.
    expect(found?.regulatoryStatus).toBe('not-applicable');
    expect(found?.clearanceReference).toBeNull();
  });

  it('rejects a duplicate (connectionId, idempotencyKey) at the DB index', async () => {
    await repo.save(row());
    await expect(repo.save(row({ orderId: 'ol_order_int_dup' }))).rejects.toThrow();
  });

  it('allows multiple rows with a null idempotencyKey (partial index)', async () => {
    const a = await repo.save(row({ idempotencyKey: null, orderId: 'ol_order_a' }));
    const b = await repo.save(row({ idempotencyKey: null, orderId: 'ol_order_b' }));
    expect(a.id).not.toBe(b.id);
  });
});

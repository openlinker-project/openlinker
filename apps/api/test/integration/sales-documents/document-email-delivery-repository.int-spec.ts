/**
 * Document Email Delivery persistence Integration Test (#3550)
 *
 * Proves the `document_email_deliveries` table against real Postgres: a send is
 * recorded once, an order's attempts read back newest first, one order's rows do
 * not leak into another's, and a value this build does not recognise reads back
 * as a FAILURE (never as a delivery that is not recorded).
 *
 * @module apps/api/test/integration/sales-documents
 */
import { DocumentEmailDeliveryOrmEntity } from '@openlinker/core/sales-documents/infrastructure/persistence/entities/document-email-delivery.orm-entity';
import { DocumentEmailDeliveryRepository } from '@openlinker/core/sales-documents/infrastructure/persistence/repositories/document-email-delivery.repository';
import type { Repository } from 'typeorm';

import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from '../setup';

const base = {
  documentKind: 'invoice',
  documentId: 'inv-1',
  sentVia: 'openlinker' as const,
  outcome: 'sent' as const,
  failureReason: null,
  recipient: 'buyer@example.com',
  actorUserId: 'user-1',
};

describe('document_email_deliveries persistence (integration)', () => {
  let harness: IntegrationTestHarness;
  let orm: Repository<DocumentEmailDeliveryOrmEntity>;
  let repository: DocumentEmailDeliveryRepository;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  beforeEach(async () => {
    await resetTestHarness();
    orm = harness.getDataSource().getRepository(DocumentEmailDeliveryOrmEntity);
    repository = new DocumentEmailDeliveryRepository(orm);
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('should record a send and read it back for its order', async () => {
    const saved = await repository.record({ ...base, internalOrderId: 'ol_order_1' });

    const rows = await repository.listByOrder('ol_order_1', 10);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: saved.id,
      documentKind: 'invoice',
      sentVia: 'openlinker',
      outcome: 'sent',
      recipient: 'buyer@example.com',
    });
  });

  it('should list an order newest first and honour the limit', async () => {
    await repository.record({ ...base, internalOrderId: 'ol_order_1', documentId: 'first' });
    await repository.record({ ...base, internalOrderId: 'ol_order_1', documentId: 'second' });
    await repository.record({ ...base, internalOrderId: 'ol_order_1', documentId: 'third' });

    const rows = await repository.listByOrder('ol_order_1', 2);

    expect(rows.map((r) => r.documentId)).toEqual(['third', 'second']);
  });

  it('should not return another order\'s attempts', async () => {
    await repository.record({ ...base, internalOrderId: 'ol_order_1' });
    await repository.record({ ...base, internalOrderId: 'ol_order_2' });

    const rows = await repository.listByOrder('ol_order_1', 10);

    expect(rows).toHaveLength(1);
    expect(rows[0].internalOrderId).toBe('ol_order_1');
  });

  it('should keep a failure with its closed reason and no sender', async () => {
    await repository.record({
      ...base,
      internalOrderId: 'ol_order_1',
      sentVia: null,
      outcome: 'failed',
      failureReason: 'no-document',
    });

    const [row] = await repository.listByOrder('ol_order_1', 10);

    expect(row).toMatchObject({ sentVia: null, outcome: 'failed', failureReason: 'no-document' });
  });

  it('should read an unrecognised outcome as failed, never as sent', async () => {
    await orm.insert({
      internalOrderId: 'ol_order_1',
      documentKind: 'invoice',
      documentId: 'inv-1',
      sentVia: 'carrier-pigeon',
      outcome: 'delivered-maybe',
      failureReason: 'something-new',
    });

    const [row] = await repository.listByOrder('ol_order_1', 10);

    expect(row.outcome).toBe('failed');
    expect(row.sentVia).toBeNull();
    expect(row.failureReason).toBeNull();
  });
});

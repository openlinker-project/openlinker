/**
 * Buyer Email Delivery persistence Integration Test (#3554)
 *
 * Proves `buyer_email_deliveries` against real Postgres: every outcome is
 * recorded and read back newest first for its order, the at-most-once check
 * sees only SENT rows for the same subject, a later bounce moves a sent row to
 * bounced exactly once, and a row this build cannot read is left out of the
 * timeline rather than shown as something it may not be.
 *
 * @module apps/api/test/integration/orders
 */
import { BuyerEmailDeliveryOrmEntity } from '@openlinker/core/orders/infrastructure/persistence/entities/buyer-email-delivery.orm-entity';
import { BuyerEmailDeliveryRepository } from '@openlinker/core/orders/infrastructure/persistence/repositories/buyer-email-delivery.repository';
import type { Repository } from 'typeorm';

import {
  getTestHarness,
  resetTestHarness,
  teardownTestHarness,
  type IntegrationTestHarness,
} from '../setup';

const base = {
  internalOrderId: 'ol_order_1',
  connectionId: 'conn-1',
  templateKey: 'return-received' as const,
  subjectRef: 'ol_return_1',
  outcome: 'sent' as const,
  suppressionReason: null,
  recipient: 'buyer@example.com',
};

describe('buyer_email_deliveries persistence (integration)', () => {
  let harness: IntegrationTestHarness;
  let orm: Repository<BuyerEmailDeliveryOrmEntity>;
  let repository: BuyerEmailDeliveryRepository;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  beforeEach(async () => {
    await resetTestHarness();
    orm = harness.getDataSource().getRepository(BuyerEmailDeliveryOrmEntity);
    repository = new BuyerEmailDeliveryRepository(orm);
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('should record each outcome and list an order newest first', async () => {
    await repository.record({
      ...base,
      outcome: 'suppressed',
      suppressionReason: 'emails-off-for-connection',
    });
    await repository.record({ ...base });

    const rows = await repository.listByOrder('ol_order_1', 10);

    expect(rows.map((row) => row.outcome)).toEqual(['sent', 'suppressed']);
    expect(rows[1]?.suppressionReason).toBe('emails-off-for-connection');
  });

  it('should see a sent email for the same subject only', async () => {
    await repository.record({ ...base });
    await repository.record({
      ...base,
      subjectRef: 'ol_return_2',
      outcome: 'suppressed',
      suppressionReason: 'template-not-enabled',
    });

    expect(await repository.hasSent('ol_order_1', 'return-received', 'ol_return_1')).toBe(true);
    expect(await repository.hasSent('ol_order_1', 'return-received', 'ol_return_2')).toBe(false);
    expect(await repository.hasSent('ol_order_1', 'shipped', 'ol_return_1')).toBe(false);
  });

  it('should move a sent row to bounced exactly once', async () => {
    const sent = await repository.record({ ...base });

    expect(await repository.markBounced(sent.id)).toBe(true);
    expect(await repository.markBounced(sent.id)).toBe(false);

    const [row] = await repository.listByOrder('ol_order_1', 10);
    expect(row?.outcome).toBe('bounced');
  });

  it('should leave out a row this build cannot read', async () => {
    await repository.record({ ...base });
    await orm.insert({ ...base, templateKey: 'marketing', outcome: 'sent' });

    const rows = await repository.listByOrder('ol_order_1', 10);

    expect(rows).toHaveLength(1);
  });
});

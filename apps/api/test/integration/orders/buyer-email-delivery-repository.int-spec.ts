/**
 * Buyer Email Delivery persistence Integration Test (#3554)
 *
 * Proves `buyer_email_deliveries` against real Postgres: every outcome is
 * recorded and read back newest first for its order, the at-most-once send
 * slot admits exactly one of two concurrent claims for a subject and frees
 * itself on a release or a bounce, and a row this build cannot read is left
 * out of the timeline rather than shown as something it may not be.
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

  it('should record a suppression and a settled send, newest first', async () => {
    await repository.recordSuppression({ ...base, suppressionReason: 'emails-off-for-connection' });
    const claim = await repository.claimSend({ ...base });
    await repository.settleClaim(claim!.id, 'sent');

    const rows = await repository.listByOrder('ol_order_1', 10);

    expect(rows.map((row) => row.outcome)).toEqual(['sent', 'suppressed']);
    expect(rows[1]?.suppressionReason).toBe('emails-off-for-connection');
  });

  it('should let exactly one of two concurrent claims for one subject win', async () => {
    // A return received in two parcels on two lines: nothing serialises the
    // two firings, so the index must.
    const [first, second] = await Promise.all([
      repository.claimSend({ ...base }),
      repository.claimSend({ ...base }),
    ]);

    expect([first, second].filter((claim) => claim !== null)).toHaveLength(1);
  });

  it('should keep the slot once sent, and scope it to the subject', async () => {
    const claim = await repository.claimSend({ ...base });
    await repository.settleClaim(claim!.id, 'sent');

    expect(await repository.claimSend({ ...base })).toBeNull();
    expect(await repository.claimSend({ ...base, subjectRef: 'ol_return_2' })).not.toBeNull();
    expect(await repository.claimSend({ ...base, templateKey: 'shipped' })).not.toBeNull();
  });

  it('should free the slot when a claim is released or bounces', async () => {
    const released = await repository.claimSend({ ...base });
    await repository.releaseClaim(released!.id);
    const bounced = await repository.claimSend({ ...base });
    expect(bounced).not.toBeNull();
    await repository.settleClaim(bounced!.id, 'bounced');

    expect(await repository.claimSend({ ...base })).not.toBeNull();
  });

  it('should leave out a row this build cannot read', async () => {
    await repository.recordSuppression({ ...base, suppressionReason: 'template-not-enabled' });
    await orm.insert({ ...base, templateKey: 'marketing', outcome: 'sent', suppressionReason: null });

    const rows = await repository.listByOrder('ol_order_1', 10);

    expect(rows).toHaveLength(1);
  });
});

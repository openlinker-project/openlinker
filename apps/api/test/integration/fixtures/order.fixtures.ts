/**
 * Order Test Fixtures
 *
 * Factory helpers for seeding order_records rows in integration tests.
 *
 * @module apps/api/test/integration/fixtures
 */
import { DataSource } from 'typeorm';
import { OrderRecordOrmEntity } from '@openlinker/core/orders';

/**
 * Seed an order_records row directly in the database.
 */
export async function createTestOrderRecord(
  dataSource: DataSource,
  overrides?: Partial<OrderRecordOrmEntity>,
): Promise<OrderRecordOrmEntity> {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const repo = dataSource.getRepository(OrderRecordOrmEntity);

  const entity = repo.create({
    internalOrderId: `ol_order_fixture_${suffix}`,
    customerId: null,
    sourceConnectionId: '11111111-1111-4111-8111-111111111111',
    sourceEventId: null,
    orderSnapshot: { items: [] },
    syncStatus: [
      {
        destinationConnectionId: '22222222-2222-4222-8222-222222222222',
        status: 'pending',
      },
    ],
    ...overrides,
  });

  return repo.save(entity);
}

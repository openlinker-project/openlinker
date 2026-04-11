/**
 * Order Test Fixtures
 *
 * Factory helpers for seeding order_records rows in integration tests.
 *
 * @module apps/api/test/integration/fixtures
 */
import { DataSource } from 'typeorm';
import { OrderRecordOrmEntity } from '@openlinker/core/orders/infrastructure/persistence/entities/order-record.orm-entity';

let orderCounter = 0;

/**
 * Seed an order_records row directly in the database.
 */
export async function createTestOrderRecord(
  dataSource: DataSource,
  overrides?: Partial<OrderRecordOrmEntity>,
): Promise<OrderRecordOrmEntity> {
  orderCounter++;
  const repo = dataSource.getRepository(OrderRecordOrmEntity);

  const entity = repo.create({
    internalOrderId: `ol_order_fixture_${orderCounter}`,
    customerId: null,
    sourceConnectionId: '00000000-0000-0000-0000-000000000001',
    sourceEventId: null,
    orderSnapshot: { items: [] },
    syncStatus: [
      {
        destinationConnectionId: '00000000-0000-0000-0000-000000000002',
        status: 'pending',
      },
    ],
    ...overrides,
  });

  return repo.save(entity);
}

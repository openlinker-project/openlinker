/**
 * Order Cancellation Signal Repository (#2069)
 *
 * TypeORM implementation of `OrderCancellationSignalRepositoryPort`. Both
 * methods are single raw statements — the same idiom
 * `OrderRecordRepository.markCancelled` already uses — because TypeORM's
 * `Repository` entity API cannot express `ON CONFLICT DO NOTHING` with no
 * conflict action, or a `DELETE ... RETURNING`, without dropping to raw SQL.
 *
 * @module libs/core/src/orders/infrastructure/persistence/repositories
 * @implements {OrderCancellationSignalRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { OrderCancellationSignalRepositoryPort } from '../../../domain/ports/order-cancellation-signal-repository.port';
import { OrderCancellationSignalOrmEntity } from '../entities/order-cancellation-signal.orm-entity';

@Injectable()
export class OrderCancellationSignalRepository implements OrderCancellationSignalRepositoryPort {
  constructor(
    @InjectRepository(OrderCancellationSignalOrmEntity)
    private readonly repository: Repository<OrderCancellationSignalOrmEntity>
  ) {}

  async record(
    sourceConnectionId: string,
    externalOrderId: string,
    cancelledAt: Date
  ): Promise<void> {
    await this.repository.query(
      `INSERT INTO "order_cancellation_signals" ("sourceConnectionId", "externalOrderId", "cancelledAt")
       VALUES ($1, $2, $3)
       ON CONFLICT ("sourceConnectionId", "externalOrderId") DO NOTHING`,
      [sourceConnectionId, externalOrderId, cancelledAt]
    );
  }

  async consume(sourceConnectionId: string, externalOrderId: string): Promise<Date | null> {
    const rows = (await this.repository.query(
      `DELETE FROM "order_cancellation_signals"
       WHERE "sourceConnectionId" = $1 AND "externalOrderId" = $2
       RETURNING "cancelledAt"`,
      [sourceConnectionId, externalOrderId]
    )) as Array<{ cancelledAt: Date }>;
    return rows[0]?.cancelledAt ?? null;
  }
}

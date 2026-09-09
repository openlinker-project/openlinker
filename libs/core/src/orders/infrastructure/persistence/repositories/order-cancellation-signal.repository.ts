/**
 * Order Cancellation Signal Repository (#2069)
 *
 * TypeORM implementation of `OrderCancellationSignalRepositoryPort`.
 *
 * `record()` is a single raw statement — the same idiom
 * `OrderRecordRepository.markCancelled` already uses — because TypeORM's
 * `Repository` entity API cannot express `ON CONFLICT DO NOTHING` with no
 * conflict action without dropping to raw SQL.
 *
 * `consume()` deliberately goes through the QueryBuilder rather than
 * `Repository.query()`, even though both can express `DELETE ... RETURNING`.
 * TypeORM's raw driver-level `query()` special-cases `DELETE`/`UPDATE`: it
 * wraps the result as `[rows, rowCount]` instead of returning `rows` directly
 * (see `PostgresQueryRunner.query`'s `switch (raw.command)` branch) — a
 * caller expecting a plain rows array silently reads `rows[0]` as the WHOLE
 * `[rows, rowCount]` tuple and gets `undefined` for every field, with no
 * error anywhere. `DeleteQueryBuilder.execute()` normalizes this itself
 * (`DeleteResult.raw = queryResult.records`), matching every other
 * write-with-`RETURNING` in this codebase (`OrderHoldRepository.releaseHeld`,
 * `InvoiceRecordRepository`, `PromptTemplateRepository`, …) — none of which
 * uses raw `.query()` for exactly this reason.
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
    const result = await this.repository
      .createQueryBuilder()
      .delete()
      .from(OrderCancellationSignalOrmEntity)
      .where('"sourceConnectionId" = :sourceConnectionId AND "externalOrderId" = :externalOrderId', {
        sourceConnectionId,
        externalOrderId,
      })
      .returning('"cancelledAt"')
      .execute();

    const rows = result.raw as Array<{ cancelledAt: Date }>;
    return rows[0]?.cancelledAt ?? null;
  }
}

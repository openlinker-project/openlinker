/**
 * Order Column Preset Repository (#3530)
 *
 * TypeORM implementation of `OrderColumnPresetRepositoryPort`.
 *
 * The workspace default is written update-first under a transaction-scoped
 * advisory lock, not through `ON CONFLICT`: Postgres treats NULLs as distinct
 * in a unique index, so `ON CONFLICT ("userId") WHERE "userId" IS NULL` never
 * fires against a plain partial index and every save inserted another
 * "default" row. The migration's index is `NULLS NOT DISTINCT` (the hard
 * guarantee in a migrated schema), but TypeORM 0.3.17 cannot declare that on
 * the entity, so the synchronize-built test schema lacks it - the lock is what
 * makes two admins saving at once converge on one row in either schema.
 *
 * @module libs/core/src/orders/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { OrderColumnPresetOrmEntity } from '../entities/order-column-preset.orm-entity';
import type { OrderColumnPresetRepositoryPort } from '../../../domain/ports/order-column-preset-repository.port';
import type {
  CreateOrderColumnPresetInput,
  OrderColumnPreset,
  UpdateOrderColumnPresetInput,
} from '../../../domain/types/order-column-preset.types';

@Injectable()
export class OrderColumnPresetRepository implements OrderColumnPresetRepositoryPort {
  constructor(
    @InjectRepository(OrderColumnPresetOrmEntity)
    private readonly ormRepository: Repository<OrderColumnPresetOrmEntity>
  ) {}

  async findByUserId(userId: string): Promise<OrderColumnPreset[]> {
    const entities = await this.ormRepository.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });
    return entities.map((entity) => this.toDomain(entity));
  }

  async findWorkspaceDefault(): Promise<OrderColumnPreset | null> {
    const entity = await this.ormRepository.findOne({ where: { userId: IsNull() } });
    return entity ? this.toDomain(entity) : null;
  }

  async findById(id: string): Promise<OrderColumnPreset | null> {
    const entity = await this.ormRepository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async create(input: CreateOrderColumnPresetInput): Promise<OrderColumnPreset> {
    const entity = new OrderColumnPresetOrmEntity();
    entity.userId = input.userId;
    entity.name = input.name;
    entity.columns = input.columns;
    const saved = await this.ormRepository.save(entity);
    return this.toDomain(saved);
  }

  async update(id: string, patch: UpdateOrderColumnPresetInput): Promise<OrderColumnPreset> {
    if (patch.name !== undefined) {
      await this.ormRepository.update({ id }, { name: patch.name });
    }
    if (patch.columns !== undefined) {
      await this.ormRepository.update({ id }, { columns: patch.columns });
    }
    const updated = await this.ormRepository.findOne({ where: { id } });
    if (!updated) {
      throw new Error(`OrderColumnPreset ${id} vanished during update`);
    }
    return this.toDomain(updated);
  }

  async upsertWorkspaceDefault(columns: string[]): Promise<OrderColumnPreset> {
    await this.ormRepository.manager.transaction(async (manager) => {
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtext('order_column_presets.workspace_default'))`
      );
      const updated = await manager
        .createQueryBuilder()
        .update(OrderColumnPresetOrmEntity)
        .set({ columns, updatedAt: () => 'now()' })
        .where('"userId" IS NULL')
        .execute();
      if (!updated.affected) {
        await manager.insert(OrderColumnPresetOrmEntity, {
          userId: null,
          name: 'Workspace default',
          columns,
        });
      }
    });
    const row = await this.findWorkspaceDefault();
    if (!row) {
      throw new Error('Workspace default preset vanished immediately after upsert');
    }
    return row;
  }

  async delete(id: string): Promise<void> {
    await this.ormRepository.delete({ id });
  }

  private toDomain(entity: OrderColumnPresetOrmEntity): OrderColumnPreset {
    return {
      id: entity.id,
      userId: entity.userId,
      name: entity.name,
      columns: entity.columns,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}

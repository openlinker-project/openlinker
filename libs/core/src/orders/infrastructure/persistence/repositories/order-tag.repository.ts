/**
 * Order Tag Repository (#3532)
 *
 * @module libs/core/src/orders/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { OrderTagOrmEntity } from '../entities/order-tag.orm-entity';
import { OrderTagAssignmentOrmEntity } from '../entities/order-tag-assignment.orm-entity';
import type { OrderTagRepositoryPort } from '../../../domain/ports/order-tag-repository.port';
import type {
  BulkAssignOrderTagResult,
  CreateOrderTagInput,
  OrderTag,
  OrderTagColor,
  OrderTagWithCount,
  UpdateOrderTagInput,
} from '../../../domain/types/order-tag.types';

@Injectable()
export class OrderTagRepository implements OrderTagRepositoryPort {
  constructor(
    @InjectRepository(OrderTagOrmEntity)
    private readonly tags: Repository<OrderTagOrmEntity>,
    @InjectRepository(OrderTagAssignmentOrmEntity)
    private readonly assignments: Repository<OrderTagAssignmentOrmEntity>,
    private readonly dataSource: DataSource
  ) {}

  async findAllWithCounts(): Promise<OrderTagWithCount[]> {
    const rows = await this.tags
      .createQueryBuilder('t')
      .leftJoin('order_tag_assignments', 'a', 'a."tagId" = t.id')
      .select('t.id', 'id')
      .addSelect('t.name', 'name')
      .addSelect('t.color', 'color')
      .addSelect('t."createdAt"', 'createdAt')
      .addSelect('t."updatedAt"', 'updatedAt')
      .addSelect('COUNT(a.id)', 'orderCount')
      .groupBy('t.id')
      .orderBy('t.name', 'ASC')
      .getRawMany<{
        id: string;
        name: string;
        color: string;
        createdAt: Date;
        updatedAt: Date;
        orderCount: string;
      }>();

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color as OrderTagColor,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      orderCount: Number(row.orderCount),
    }));
  }

  async findById(id: string): Promise<OrderTag | null> {
    const entity = await this.tags.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async findByName(name: string): Promise<OrderTag | null> {
    const entity = await this.tags.findOne({ where: { name } });
    return entity ? this.toDomain(entity) : null;
  }

  async count(): Promise<number> {
    return this.tags.count();
  }

  async create(input: CreateOrderTagInput): Promise<OrderTag> {
    const entity = new OrderTagOrmEntity();
    entity.name = input.name;
    entity.color = input.color;
    const saved = await this.tags.save(entity);
    return this.toDomain(saved);
  }

  async update(id: string, patch: UpdateOrderTagInput): Promise<OrderTag> {
    const update: Partial<OrderTagOrmEntity> = {};
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.color !== undefined) update.color = patch.color;
    await this.tags.update({ id }, update);
    const updated = await this.tags.findOne({ where: { id } });
    if (!updated) {
      throw new Error(`OrderTag ${id} vanished during update`);
    }
    return this.toDomain(updated);
  }

  async delete(id: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(OrderTagAssignmentOrmEntity, { tagId: id });
      await manager.delete(OrderTagOrmEntity, { id });
    });
  }

  async findTagIdsForOrder(internalOrderId: string): Promise<string[]> {
    const rows = await this.assignments.find({ where: { internalOrderId } });
    return rows.map((row) => row.tagId);
  }

  async findTagIdsForOrders(
    internalOrderIds: readonly string[]
  ): Promise<Map<string, string[]>> {
    if (internalOrderIds.length === 0) {
      return new Map();
    }
    const rows = await this.assignments.find({
      where: { internalOrderId: In([...internalOrderIds]) },
    });
    const byOrder = new Map<string, string[]>();
    for (const row of rows) {
      const list = byOrder.get(row.internalOrderId);
      if (list) {
        list.push(row.tagId);
      } else {
        byOrder.set(row.internalOrderId, [row.tagId]);
      }
    }
    return byOrder;
  }

  async assign(tagId: string, internalOrderId: string, assignedByUserId: string): Promise<void> {
    // Idempotent — a repeat assign is a no-op, never a duplicate-key error.
    await this.assignments
      .createQueryBuilder()
      .insert()
      .values({ tagId, internalOrderId, assignedByUserId })
      .orIgnore()
      .execute();
  }

  async unassign(tagId: string, internalOrderId: string): Promise<void> {
    await this.assignments.delete({ tagId, internalOrderId });
  }

  async bulkAssign(
    tagId: string,
    internalOrderIds: readonly string[],
    assignedByUserId: string
  ): Promise<BulkAssignOrderTagResult> {
    if (internalOrderIds.length === 0) {
      return { tagId, added: 0, alreadyTagged: 0 };
    }
    const existing = await this.assignments.find({
      where: { tagId, internalOrderId: In([...internalOrderIds]) },
    });
    const alreadyTaggedIds = new Set(existing.map((row) => row.internalOrderId));
    const toInsert = internalOrderIds.filter((id) => !alreadyTaggedIds.has(id));

    if (toInsert.length > 0) {
      await this.assignments
        .createQueryBuilder()
        .insert()
        .values(
          toInsert.map((internalOrderId) => ({ tagId, internalOrderId, assignedByUserId }))
        )
        .orIgnore()
        .execute();
    }

    return { tagId, added: toInsert.length, alreadyTagged: alreadyTaggedIds.size };
  }

  private toDomain(entity: OrderTagOrmEntity): OrderTag {
    return {
      id: entity.id,
      name: entity.name,
      color: entity.color as OrderTagColor,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}

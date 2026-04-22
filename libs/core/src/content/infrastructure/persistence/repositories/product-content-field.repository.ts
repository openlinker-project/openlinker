/**
 * Product Content Field Repository
 *
 * TypeORM-backed implementation of `ProductContentFieldRepositoryPort`.
 * Handles the upsert path manually because the unique key spans a nullable
 * column (`connection_id`); TypeORM's `upsert()` helper doesn't compose well
 * with NULL-aware uniqueness, so we do find-then-insert/update inside a
 * single repository call.
 *
 * Mapping between ORM and domain entities is private to this class.
 *
 * @module libs/core/src/content/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ProductContentField } from '../../../domain/entities/product-content-field.entity';
import type {
  ProductContentFieldKey,
  ProductContentFieldRepositoryPort,
  ProductContentFieldUpsert,
} from '../../../domain/ports/product-content-field-repository.port';
import type { FieldKey } from '../../../domain/types/content.types';
import { ProductContentFieldOrmEntity } from '../entities/product-content-field.orm-entity';

@Injectable()
export class ProductContentFieldRepository implements ProductContentFieldRepositoryPort {
  constructor(
    @InjectRepository(ProductContentFieldOrmEntity)
    private readonly ormRepository: Repository<ProductContentFieldOrmEntity>,
  ) {}

  async findByKey(key: ProductContentFieldKey): Promise<ProductContentField | null> {
    const entity = await this.ormRepository.findOne({
      where: {
        productId: key.productId,
        connectionId: key.connectionId === null ? IsNull() : key.connectionId,
        fieldKey: key.fieldKey,
      },
    });
    return entity ? this.toDomain(entity) : null;
  }

  async upsert(payload: ProductContentFieldUpsert): Promise<ProductContentField> {
    const existing = await this.ormRepository.findOne({
      where: {
        productId: payload.productId,
        connectionId: payload.connectionId === null ? IsNull() : payload.connectionId,
        fieldKey: payload.fieldKey,
      },
    });

    if (existing) {
      existing.draftValue = payload.draftValue;
      existing.baseValue = payload.baseValue;
      existing.baseVersion = payload.baseVersion;
      existing.hasConflict = payload.hasConflict;
      existing.updatedBy = payload.updatedBy;
      const saved = await this.ormRepository.save(existing);
      return this.toDomain(saved);
    }

    const fresh = this.ormRepository.create({
      productId: payload.productId,
      connectionId: payload.connectionId,
      fieldKey: payload.fieldKey,
      draftValue: payload.draftValue,
      baseValue: payload.baseValue,
      baseVersion: payload.baseVersion,
      hasConflict: payload.hasConflict,
      updatedBy: payload.updatedBy,
    });
    const saved = await this.ormRepository.save(fresh);
    return this.toDomain(saved);
  }

  async delete(key: ProductContentFieldKey): Promise<void> {
    await this.ormRepository.delete({
      productId: key.productId,
      connectionId: key.connectionId === null ? IsNull() : key.connectionId,
      fieldKey: key.fieldKey,
    });
  }

  private toDomain(entity: ProductContentFieldOrmEntity): ProductContentField {
    return new ProductContentField(
      entity.id,
      entity.productId,
      entity.connectionId,
      entity.fieldKey as FieldKey,
      entity.draftValue,
      entity.baseValue,
      entity.baseVersion,
      entity.hasConflict,
      entity.updatedAt,
      entity.updatedBy,
    );
  }
}

/**
 * Seller Policies Cache Repository
 *
 * TypeORM implementation of `SellerPoliciesCacheRepositoryPort`. Handles all
 * ORM ↔ domain mapping privately; callers receive plain `CachedSellerPolicies`
 * values only.
 *
 * @module libs/core/src/listings/infrastructure/persistence/repositories
 * @implements {SellerPoliciesCacheRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type {
  CachedSellerPolicies,
  SellerPoliciesCacheRepositoryPort,
} from '../../../domain/ports/seller-policies-cache-repository.port';
import { SellerPoliciesCacheOrmEntity } from '../entities/seller-policies-cache.orm-entity';

@Injectable()
export class SellerPoliciesCacheRepository implements SellerPoliciesCacheRepositoryPort {
  constructor(
    @InjectRepository(SellerPoliciesCacheOrmEntity)
    private readonly repository: Repository<SellerPoliciesCacheOrmEntity>,
  ) {}

  async findByConnectionId(connectionId: string): Promise<CachedSellerPolicies | null> {
    const row = await this.repository.findOne({ where: { connectionId } });
    return row ? this.toDomain(row) : null;
  }

  async upsert(entry: CachedSellerPolicies): Promise<void> {
    // Using TypeORM's `upsert` helper keyed on the primary column so concurrent
    // writers for the same connection collapse into a single row.
    await this.repository.upsert(
      {
        connectionId: entry.connectionId,
        policies: entry.policies,
        fetchedAt: entry.fetchedAt,
      },
      { conflictPaths: ['connectionId'] },
    );
  }

  private toDomain(row: SellerPoliciesCacheOrmEntity): CachedSellerPolicies {
    return {
      connectionId: row.connectionId,
      policies: row.policies,
      fetchedAt: row.fetchedAt,
    };
  }
}

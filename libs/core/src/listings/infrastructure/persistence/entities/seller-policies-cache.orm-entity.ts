/**
 * Seller Policies Cache ORM Entity
 *
 * TypeORM entity for `seller_policies_cache` — one row per connection, keyed
 * by `connectionId`. Stores the full `SellerPolicies` document as JSONB and
 * the `fetchedAt` timestamp used for TTL checks.
 *
 * @module libs/core/src/listings/infrastructure/persistence/entities
 * @see {@link SellerPoliciesCacheRepositoryPort} for the domain port
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import type { SellerPolicies } from '@openlinker/core/integrations';

@Entity('seller_policies_cache')
export class SellerPoliciesCacheOrmEntity {
  @PrimaryColumn({ type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'jsonb' })
  policies!: SellerPolicies;

  @Column({ type: 'timestamptz' })
  fetchedAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

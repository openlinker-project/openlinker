/**
 * Destination Category ORM Entity (#1979, ADR-037)
 *
 * TypeORM entity for the `destination_categories` table — the neutral
 * destination-taxonomy projection.
 *
 * Uniqueness spans a nullable key (`taxonomyOwner` for a marketplace tree vs
 * `connectionId` for a shop-owned one), so it needs TWO PARTIAL unique indexes
 * rather than one composite: Postgres treats NULLs as distinct, so a plain
 * unique over both columns would not prevent duplicates. Same NULL-distinct
 * pattern `product_content_field` uses for its master-vs-channel split.
 *
 * The partial predicates are declared HERE, not only in the migration, because
 * the integration harness builds its schema with `synchronize` and never runs
 * migrations (`docs/testing-guide.md`) — an index declared only in the migration
 * would be absent under test, and the repository's `ON CONFLICT ... WHERE`
 * upsert would fail with "no unique or exclusion constraint matching".
 *
 * @module libs/core/src/listings/infrastructure/persistence/entities
 * @see {@link DestinationCategory} for the corresponding domain entity
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

import type { TaxonomyOwner } from '../../../domain/types/taxonomy-owner.types';

@Entity('destination_categories')
// Marketplace tree — stored once per owner, however many connections read it.
@Index('UQ_destination_categories_owner_external', ['taxonomyOwner', 'externalId'], {
  unique: true,
  where: '"taxonomyOwner" IS NOT NULL',
})
// Shop-owned tree — one per connection.
@Index('UQ_destination_categories_connection_external', ['connectionId', 'externalId'], {
  unique: true,
  where: '"connectionId" IS NOT NULL',
})
// Level reads (`browse`), one index per scope column.
@Index('IDX_destination_categories_owner_parent', ['taxonomyOwner', 'parentId'])
@Index('IDX_destination_categories_connection_parent', ['connectionId', 'parentId'])
export class DestinationCategoryOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', nullable: true })
  taxonomyOwner!: TaxonomyOwner | null;

  @Column({ type: 'uuid', nullable: true })
  connectionId!: string | null;

  @Column({ type: 'text' })
  externalId!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  parentId!: string | null;

  /** `null` for a shop node — a shop accepts a product in any node (ADR-024). */
  @Column({ type: 'boolean', nullable: true })
  leaf!: boolean | null;

  /**
   * Diacritic-stripped, lowercased `name`, derived by the repository via
   * `normalizeCategorySearchText`. Infrastructure-only: it never reaches the
   * domain entity, so the normalization strategy stays out of every consumer.
   *
   * Matched with `LIKE '%…%'`, which the migration's GIN `gin_trgm_ops` index
   * accelerates. Deliberately NOT the `%` similarity operator: that one *errors*
   * without the `pg_trgm` extension, and the test harness's `synchronize`-built
   * schema has no extension. `LIKE` keeps correctness independent of the
   * extension and degrades to a sequential scan instead of a failure.
   */
  @Column({ type: 'text' })
  searchText!: string;

  /** Watermark — rows below a completing run's value are gone upstream. */
  @Column({ type: 'timestamptz' })
  syncedAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

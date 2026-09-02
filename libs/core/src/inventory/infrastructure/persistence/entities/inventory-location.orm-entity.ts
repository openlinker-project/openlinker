/**
 * Inventory Location ORM Entity
 *
 * TypeORM entity for the `inventory_locations` table (ADR-058 decision 1).
 *
 * `kind` and `status` are plain `varchar` columns rather than DB enums — the
 * union is enforced in TypeScript (`as const` + union, per the repo convention),
 * so widening the vocabulary never needs an `ALTER TYPE`.
 *
 * `latitude` / `longitude` are `numeric(9,6)`, which pg returns as a **string**;
 * the repository coerces once in `toDomain` (the ADR-040 numeric precedent) so
 * no consumer ever sees a stringly-typed coordinate.
 *
 * Both indexes are declared at class level with the SAME names the migration
 * uses. The integration harness builds its schema by `synchronize`, not by
 * migration, so unnamed decorators would produce hash names there and the two
 * schemas would silently diverge on exactly the constraint that enforces code
 * uniqueness.
 *
 * The FK to `connections` is declared in the migration only — no `@ManyToOne`
 * relation — following the `category_mappings` / `fulfillment_routing_rules`
 * precedent. `setup.ts` records the consequence: nothing cascades from
 * `connections` in the test schema, so the table is truncated explicitly.
 *
 * There is deliberately **no relation to `InventoryItemOrmEntity`**: existing
 * `inventory_items.locationId` values are unattributable, so adding an FK is a
 * step-(iii)-class change (ADR-058 decision 3), not part of this slice.
 *
 * @module libs/core/src/inventory/infrastructure/persistence/entities
 */
import {
  Entity,
  PrimaryColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('inventory_locations')
@Index('UQ_inventory_locations_code', ['code'], { unique: true })
@Index('IDX_inventory_locations_owner_connection', ['ownerConnectionId'])
export class InventoryLocationOrmEntity {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  code!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 32 })
  kind!: string;

  // Provenance, never authority (ADR-058 decision 1) — whose sync may write
  // positions here, not who decides anything about them. The FK to connections
  // is ON DELETE SET NULL: an operator's warehouse outlives the integration.
  @Column({ type: 'uuid', nullable: true })
  ownerConnectionId!: string | null;

  // Free-text operator reference, NOT an identifier mapping.
  @Column({ type: 'text', nullable: true })
  externalRef!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status!: string;

  @Column({ type: 'varchar', length: 2, nullable: true })
  countryIso2!: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  postcode!: string | null;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  latitude!: string | null;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  longitude!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

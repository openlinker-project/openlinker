/**
 * Bundle Definition ORM Entity (#3607)
 *
 * One row per VERSION of a bundle's composition. A bundle is an ordinary master
 * variant, so there is no identifier-mapping entry of its own; history is kept
 * so an order frozen against version N stays explainable after version N+1.
 *
 * @module libs/core/src/products/infrastructure/persistence/entities
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('bundle_definitions')
@Index('UQ_bundle_definitions_variant_version', ['variantId', 'version'], { unique: true })
export class BundleDefinitionOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The bundle's own master variant id. Text: internal ids are `ol_variant_*`. */
  @Column({ type: 'text' })
  variantId!: string;

  @Column({ type: 'integer' })
  version!: number;

  /** `{variantId, productId, quantity, giftSlot?}[]`, coerced on read. */
  @Column({ type: 'jsonb' })
  components!: Record<string, unknown>[];

  /** Set on every version of a variant when the bundle is deleted; history stays. */
  @Column({ type: 'timestamptz', nullable: true })
  retiredAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

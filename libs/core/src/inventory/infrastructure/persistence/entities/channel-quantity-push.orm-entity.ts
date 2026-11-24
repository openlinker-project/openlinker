/**
 * Channel Quantity Push ORM Entity (#4062)
 *
 * TypeORM mapping for `channel_quantity_pushes`, the append-only record of
 * quantities OpenLinker wrote to channel listings.
 *
 * @module libs/core/src/inventory/infrastructure/persistence/entities
 */
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('channel_quantity_pushes')
// The movement detail reads one variant's pushes for one observation.
@Index('IDX_channel_quantity_pushes_variant_observed', ['productVariantId', 'observedAt'])
// "Last sent" reads the newest push per variant and connection.
@Index('IDX_channel_quantity_pushes_variant_conn_pushed', ['productVariantId', 'connectionId', 'pushedAt'])
// The retention prune ranges over time alone.
@Index('IDX_channel_quantity_pushes_pushed', ['pushedAt'])
export class ChannelQuantityPushOrmEntity {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_channel_quantity_pushes' })
  id!: string;

  @Column({ type: 'text' })
  connectionId!: string;

  @Column({ type: 'text' })
  externalOfferId!: string;

  @Column({ type: 'text', nullable: true })
  productVariantId!: string | null;

  @Column({ type: 'integer', nullable: true })
  quantity!: number | null;

  @Column({ type: 'varchar', length: 16 })
  outcome!: string;

  @Column({ type: 'varchar', length: 48, nullable: true })
  errorCode!: string | null;

  @Column({ type: 'text', nullable: true })
  message!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  observedAt!: Date | null;

  @Column({ type: 'timestamptz' })
  pushedAt!: Date;
}

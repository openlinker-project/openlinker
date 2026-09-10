/**
 * Price Change Auto-Applied Log ORM Entity (#3144)
 *
 * @module libs/core/src/listings/infrastructure/persistence/entities
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('price_change_auto_applied_log')
@Index('IDX_price_change_auto_applied_log_applied_at', ['appliedAt'])
export class PriceChangeAutoAppliedLogOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  productVariantId!: string;

  @Column({ type: 'uuid' })
  destinationConnectionId!: string;

  @Column({ type: 'uuid' })
  sourceConnectionId!: string;

  @Column({ type: 'numeric', precision: 14, scale: 4 })
  oldAmount!: string;

  @Column({ type: 'numeric', precision: 14, scale: 4 })
  newAmount!: string;

  @Column({ type: 'varchar', length: 8 })
  currency!: string;

  @Column({ type: 'timestamptz' })
  appliedAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

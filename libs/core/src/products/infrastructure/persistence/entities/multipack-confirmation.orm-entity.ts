/**
 * Multipack confirmation ORM entity (#3624)
 *
 * An operator's statement that one sale of a variant at pack quantity N means N
 * units of that variant. It replaces nothing and creates no product: it only
 * lets a held multipack order continue. Keyed by value (no foreign keys).
 *
 * @module libs/core/src/products/infrastructure/persistence/entities
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('multipack_confirmations')
@Index('UQ_multipack_confirmations_variant_pack', ['variantId', 'packQuantity'], { unique: true })
export class MultipackConfirmationOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  variantId!: string;

  @Column({ type: 'integer' })
  packQuantity!: number;

  @Column({ type: 'text', nullable: true })
  confirmedByUserId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  confirmedAt!: Date;
}

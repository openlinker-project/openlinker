/**
 * Promotion ORM Entity (#3935)
 *
 * The definition of a promotion. Real columns for what is queried (list order,
 * window, limits, the duplicate-guard hash), jsonb for the kind-specific parts
 * (conditions, benefit). The unique `(definitionHash, effectiveFrom)` index backs
 * the save-time duplicate guard. What a promotion has DONE lives in
 * `promotion_state`, `promotion_grants` and `promotion_applications`, none of
 * which carries an FK to this table (history outlives a deleted promotion).
 *
 * @module libs/core/src/promotions/infrastructure/persistence/entities
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('promotions')
@Index('UQ_promotions_hash_from', ['definitionHash', 'effectiveFrom'], { unique: true })
@Index('IDX_promotions_position', ['position'])
export class PromotionOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'boolean', default: false })
  isActive!: boolean;

  @Column({ type: 'int' })
  position!: number;

  @Column({ type: 'date' })
  effectiveFrom!: string;

  @Column({ type: 'date', nullable: true })
  effectiveTo!: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  conditions!: unknown[];

  @Column({ type: 'jsonb' })
  benefit!: unknown;

  @Column({ type: 'boolean', default: true })
  combinable!: boolean;

  @Column({ type: 'int', nullable: true })
  unitCap!: number | null;

  @Column({ type: 'int', nullable: true })
  customerLimit!: number | null;

  @Column({ type: 'varchar', length: 64 })
  definitionHash!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

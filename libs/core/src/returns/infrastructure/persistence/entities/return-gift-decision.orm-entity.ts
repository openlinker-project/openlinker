/**
 * Return Gift Decision ORM Entity (#3943)
 *
 * The operator's decision about a gift on a return: keep, ask back, deduct. One
 * row per `(returnId, giftLineId)`. No FK to `returns` or to the order (indexed
 * references by value, this context's posture); the unique index carries the same
 * name as the migration so the `synchronize`-built test schema enforces it too.
 *
 * @module libs/core/src/returns/infrastructure/persistence/entities
 */
import { Check, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('return_gift_decisions')
@Index('UQ_return_gift_decisions_return_gift', ['returnId', 'giftLineId'], { unique: true })
@Check('CHK_return_gift_decisions_decision', `"decision" IN ('keep','ask_back','deduct')`)
@Check(
  'CHK_return_gift_decisions_deduction',
  `("decision" = 'deduct') = ("deductionGross" IS NOT NULL)`
)
export class ReturnGiftDecisionOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  returnId!: string;

  @Column({ type: 'text' })
  giftLineId!: string;

  @Column({ type: 'varchar', length: 16 })
  decision!: string;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  deductionGross!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'text', nullable: true })
  decidedByUserId!: string | null;

  @Column({ type: 'timestamptz' })
  decidedAt!: Date;
}

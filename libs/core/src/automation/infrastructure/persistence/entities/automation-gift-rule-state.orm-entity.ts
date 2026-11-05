/**
 * Automation Gift Rule State ORM Entity (#3938)
 *
 * The MUTABLE half of a gift rule: why it is paused and how far the operator has
 * raised its cap. Kept out of `automation_rules` because that row's definition
 * hash is the rule's identity and nothing here is part of it. One row per rule,
 * created on first need; no FK to `automation_rules` (a deleted rule must not be
 * blocked by, or erase, its own history), so the harness truncates it explicitly.
 *
 * @module libs/core/src/automation/infrastructure/persistence/entities
 */
import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('automation_gift_rule_state')
export class AutomationGiftRuleStateOrmEntity {
  @PrimaryColumn({ type: 'uuid' })
  ruleId!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  pausedReason!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  pausedAt!: Date | null;

  @Column({ type: 'int', default: 0 })
  capExtension!: number;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

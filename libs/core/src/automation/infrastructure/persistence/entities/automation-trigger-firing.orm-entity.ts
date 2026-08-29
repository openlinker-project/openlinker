/**
 * Automation Trigger Firing ORM Entity (#2358, Wave-2 spec §5.2 + §7.2)
 *
 * TypeORM entity for `automation_trigger_firings` — the durable at-most-once
 * record for the two `deadline-sweep` triggers. The domain contract, including
 * why this is not folded into `automation_runs` (the retention policies are
 * incompatible) lives on the `AutomationTriggerFiring` domain entity.
 *
 * **`UQ_automation_trigger_firings_rule_subject` IS the guarantee.** #2360's
 * writer inserts with `ON CONFLICT DO NOTHING` against it; a durable
 * conditional write, not a best-effort in-memory guard, because an automation
 * that fires is an outward-facing side effect that may spend money.
 *
 * **The key deliberately excludes `definitionHash`** — spec §5.2: *"Editing a
 * rule does not erase its firing record."* Adding the hash would silently
 * re-arm every T3/T4 rule against its entire backlog on the next edit. Do not
 * add it.
 *
 * No FK to `automation_rules`; `setup.ts` lists this table in
 * `tablesToTruncate` explicitly.
 *
 * @module libs/core/src/automation/infrastructure/persistence/entities
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('automation_trigger_firings')
@Index('UQ_automation_trigger_firings_rule_subject', ['ruleId', 'subjectKind', 'subjectId'], {
  unique: true,
})
export class AutomationTriggerFiringOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  ruleId!: string;

  @Column({ type: 'varchar', length: 16 })
  subjectKind!: string;

  @Column({ type: 'text' })
  subjectId!: string;

  @Column({ type: 'timestamptz' })
  firedAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

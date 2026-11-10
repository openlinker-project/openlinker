/**
 * Automation Rule ORM Entity (#2358, Wave-2 spec §5)
 *
 * TypeORM entity for the `automation_rules` table. The domain contract — the
 * three declared divergences from #2161, and why `createdAt` is behavioural
 * rather than an audit stamp — lives on the `AutomationRule` domain entity;
 * this file carries only what is specific to the SCHEMA.
 *
 * **`trigger` is a legal Postgres column name but has no precedent in this
 * repo.** `TRIGGER` is *non-reserved* in Postgres and is fine unquoted as a
 * column; TypeORM emits quoted identifiers regardless, and every identifier in
 * the migration is quoted. It is kept because it is the spec §7.2 column name
 * and the operator's own word. **Hand-written SQL over this table or
 * `automation_runs` must quote it** — #2385/#2386 write raw SQL for the run log.
 *
 * **`trigger`, `subjectKind`-style vocabulary columns are plain `varchar`, with
 * no PG enum and no `CHECK`** — the `order_changes` (#2333) precedent. A
 * database-level list costs a migration per value and turns an unknown value
 * into a hard write failure rather than a coercion miss; `isAutomationTrigger`
 * coerces on read.
 *
 * **No `CHECK` on `jsonb_array_length(actions) <= 3` either**, for a sharper
 * reason: the integration harness builds schema via TypeORM `synchronize`,
 * which emits no raw CHECK, so the constraint would hold in production and
 * silently not in tests. The 1..3 cap is enforced in `AutomationRulesService`.
 *
 * **`isActive` defaults `false` — fail closed.** Belt-and-braces only: the
 * repository always supplies a boolean, so a column default never actually
 * fires. The service is the real enforcement point.
 *
 * **`moneyAckByUserId` carries no FK to `users`** — the `packedByUserId`
 * precedent (#2287). Display and attribution only, never filtered on; a
 * dangling id from a deleted user is the honest outcome for an audit fact, and
 * deleting a user must never cascade away an operator's automation.
 *
 * **Every jsonb default here is declared, and that is not cosmetic.** The
 * integration harness builds its schema by `synchronize`, which emits only what
 * these decorators declare, while production runs the migration — so a default
 * present in one and absent from the other means an INSERT that omits the column
 * succeeds in one schema and violates NOT NULL in the other. Keep the two sides
 * identical whenever a column is touched.
 *
 * Every index is declared at class level with the SAME NAME the migration uses —
 * the harness synchronizes from these decorators, so a name or predicate that
 * drifts from the migration means the tests exercise a different schema than
 * production runs.
 *
 * @module libs/core/src/automation/infrastructure/persistence/entities
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * The duplicate guard's last line (spec §5.5). The service's semantic overlap
 * check catches an identical definition over an OVERLAPPING window; this index
 * catches the exact same-`effectiveFrom` race the check cannot, and the
 * repository translates its violation into `AutomationRuleConflictError`.
 */
@Entity('automation_rules')
@Index('UQ_automation_rules_trigger_hash_from', ['trigger', 'definitionHash', 'effectiveFrom'], {
  unique: true,
})
@Index('IDX_automation_rules_trigger_active', ['trigger', 'isActive'])
export class AutomationRuleOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Operator-facing name; frozen onto every run row this rule produces. */
  @Column({ type: 'text' })
  name!: string;

  /** The scope axis (spec §5.5 divergence 1). Coerced by `isAutomationTrigger` on read. */
  @Column({ type: 'varchar', length: 64 })
  trigger!: string;

  /** Trigger-scoped parameters; `{}` for the six parameterless triggers. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  triggerConfig!: Record<string, unknown>;

  /** AND-ed, closed-vocabulary. Malformed members are dropped on read, never thrown. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  conditions!: unknown[];

  /** Ordered 1..3 steps; order is semantic (stop on first failure). */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  actions!: unknown[];

  /** SHA-256 over the canonicalized `(trigger, triggerConfig, conditions, actions)`. */
  @Column({ type: 'varchar', length: 64 })
  definitionHash!: string;

  @Column({ type: 'boolean', default: false })
  isActive!: boolean;

  @Column({ type: 'date' })
  effectiveFrom!: string;

  @Column({ type: 'date', nullable: true })
  effectiveTo!: string | null;

  /** Spec §5.7 S3-2: who acknowledged arming an untestable money rule. Written by #2363. */
  @Column({ type: 'uuid', nullable: true })
  moneyAckByUserId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  moneyAckAt!: Date | null;

  /**
   * BEHAVIOURAL, not an audit stamp: the deadline sweep compares against it to
   * honour S3-9 ("a rule acts only on facts that occur after it was saved").
   */
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

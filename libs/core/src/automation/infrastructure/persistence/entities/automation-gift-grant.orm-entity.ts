/**
 * Automation Gift Grant ORM Entity (#3938)
 *
 * One row per (rule, order): the gift a rule gave an order. The unique index IS
 * the idempotency guarantee - the writer inserts with `ON CONFLICT DO NOTHING`, so
 * a re-ingestion or a retried job cannot give the same gift twice - and the table
 * is also what the unit cap and the per-customer limit are summed over. Neither
 * `ruleId` nor `internalOrderId` carries an FK (indexed references by value, the
 * `automation_trigger_firings` precedent): the history outlives a deleted rule.
 *
 * @module libs/core/src/automation/infrastructure/persistence/entities
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('automation_gift_grants')
@Index('UQ_automation_gift_grants_rule_order', ['ruleId', 'internalOrderId'], { unique: true })
@Index('IDX_automation_gift_grants_rule_customer', ['ruleId', 'customerId'])
@Index('IDX_automation_gift_grants_order', ['internalOrderId'])
export class AutomationGiftGrantOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  ruleId!: string;

  @Column({ type: 'text' })
  internalOrderId!: string;

  @Column({ type: 'text', nullable: true })
  customerId!: string | null;

  @Column({ type: 'int' })
  quantity!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

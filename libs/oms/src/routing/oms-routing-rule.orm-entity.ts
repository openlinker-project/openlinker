/**
 * OMS Routing Rule — ORM entity
 *
 * One row per rule in a connection's ordered routing ruleset. Plugin-private
 * working state, `oms_`-prefixed per ADR-055 ("core owns what crosses the port;
 * the plugin owns only its private working state").
 *
 * ## Not `fulfillment_routing_rules`
 *
 * `libs/core/src/mappings` already ships a table with a nearly identical name
 * that answers a different question — ADR-012 *dispatch resolution*, "which
 * processor or carrier ships this?". This table is *sourcing*: "which location
 * sources this?". `fulfillment-router.port.ts` forbids wiring one into the
 * other or renaming either, so the `oms_` prefix is load-bearing.
 *
 * @module libs/oms/src/routing
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('oms_routing_rules')
@Index('IDX_oms_routing_rules_connection_position', ['connectionId', 'position'])
// Declared HERE as well as in the migration, and that duplication is the point.
// The integration harness builds its schema by `synchronize` off these
// decorators, not by running the migration, so an index declared only in the
// migration exists in production and in NO test environment — the two schemas
// then disagree on the single constraint that stops a connection carrying two
// live rules for the same `(kind, name)`, and every test would pass while the
// duplicate detection ADR-054's storage amendment asks for went unexercised.
// This is the rule `inventory-locations.int-spec.ts` already states for
// `UQ_inventory_locations_code`; an int-spec here proves it rather than
// assuming it.
@Index('UQ_oms_routing_rules_live_name', ['connectionId', 'kind', 'name'], {
  unique: true,
  where: '"effectiveTo" IS NULL',
})
export class OmsRoutingRuleOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The OMS connection whose ruleset this row belongs to. */
  @Column({ type: 'text' })
  connectionId!: string;

  /** Ascending evaluation order within the ruleset. */
  @Column({ type: 'integer' })
  position!: number;

  /** `filter` | `sort` — narrowed by the coercer, never trusted from the column. */
  @Column({ type: 'varchar', length: 16 })
  kind!: string;

  /** A member of the closed vocabulary — again narrowed, never trusted. */
  @Column({ type: 'varchar', length: 64 })
  name!: string;

  @Column({ type: 'varchar', length: 32 })
  afterAction!: string;

  /**
   * Operator-authored location order, read only by the `priority` sort.
   * Defaults to an empty array so a row authored for any other sort needs no
   * value and reads back as "ranks nothing".
   */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  priorityLocationIds!: unknown;

  /**
   * Per-rule effective dating, the #2170 `sales_document_rules` precedent —
   * one of the three reasons ADR-054's amendment moved routing rules out of a
   * config blob, which has no history surface at all.
   */
  @Column({ type: 'timestamptz', nullable: true })
  effectiveFrom!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  effectiveTo!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

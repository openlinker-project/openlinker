/**
 * Return Line ORM Entity
 *
 * TypeORM entity for the `return_lines` table (#2327, ADR-060).
 *
 * **The PK is a plain uuid, not an `ol_*` internal id.** A return line is never
 * referenced from outside its aggregate and has no external counterpart to map,
 * so minting a prefixed internal id would buy nothing and would additionally
 * force an `ENTITY_TYPE_ID_PREFIX` entry (the lowercased default would yield the
 * unreadable `ol_returnline_*`). `refund_records` is the precedent for an
 * internally-referenced row taking `uuid_generate_v4()`.
 *
 * `returnId` carries the ONE foreign key this slice wants —
 * `returns(id) ON DELETE CASCADE` — declared in the migration only, with no
 * `@ManyToOne` relation (the `category_mappings` / `inventory_locations`
 * precedent). A line is a part of its header, not a peer of it; deleting a
 * header must take its lines, and nothing else in the schema owns them.
 *
 * There is deliberately **no separate index on `returnId`**: the leading column
 * of `UQ_return_lines_return_index` already serves every `WHERE returnId = ?`
 * lookup and the FK's own referential check, so a second index would be pure
 * write amplification.
 *
 * `resolvedOrderLineId` gets no FK because none is possible — see the column.
 *
 * @module libs/core/src/returns/infrastructure/persistence/entities
 */
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('return_lines')
// Line-level replay idempotency for #2328: re-pulling a return UPDATES line 0,
// it never appends a second one. The pair is the only stable line identity
// available — Erli's lines are positional and carry no id at all.
@Index('UQ_return_lines_return_index', ['returnId', 'lineIndex'], { unique: true })
// Reverse navigation from an order line to the returns against it. Partial:
// unattributed lines are exactly the rows this lookup can never match.
@Index('IDX_return_lines_resolved_order_line', ['resolvedOrderLineId'], {
  where: '"resolvedOrderLineId" IS NOT NULL',
})
// The counter ordering IS the model (ADR-060) — you cannot receive more than
// was advised, nor dispose of more than arrived. Expressed in the DB rather
// than in a domain method so that no caller, including one that bypasses this
// context, can persist an impossible line. Declared class-level with the SAME
// NAME as the migration's constraint (the `offer_commercial_snapshots`
// price/currency-pair precedent): the integration harness builds its schema by
// `synchronize`, so an anonymous @Check would produce a hash name there and the
// int-spec would be asserting a constraint the migration-built schema does not
// have under that name.
@Check(
  'CHK_return_lines_quantity_ordering',
  '"quantityAdvised" >= 0 AND "quantityReceived" >= 0 AND "quantityRestocked" >= 0 AND "quantityScrapped" >= 0 AND "quantityAdvised" >= "quantityReceived" AND "quantityReceived" >= "quantityRestocked" + "quantityScrapped"'
)
export class ReturnLineOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  returnId!: string;

  @Column({ type: 'integer' })
  lineIndex!: number;

  @Column({ type: 'text', nullable: true })
  externalLineId!: string | null;

  /**
   * NULLABLE BY DESIGN, and un-FK-able by construction: `order_records` has no
   * lines table — items live inside the `orderSnapshot` jsonb — so this is a
   * by-value reference INTO a document. An unattributed line still persists and
   * still blocks the downstream triggers that need attribution.
   */
  @Column({ type: 'text', nullable: true })
  resolvedOrderLineId!: string | null;

  /** Best-effort provenance, never authority. */
  @Column({ type: 'text', nullable: true })
  offerId!: string | null;

  @Column({ type: 'text', nullable: true })
  sku!: string | null;

  /** Display fallback for a line whose attribution failed. */
  @Column({ type: 'text', nullable: true })
  name!: string | null;

  /**
   * `RefundReason` verbatim, stored as `text` rather than a DB enum (the house
   * convention: the union is enforced in TypeScript, so widening it never needs
   * an `ALTER TYPE`). Read back through a narrow-or-fallback coercion, never a
   * blind cast — see `ReturnRepository.toRefundReason`.
   */
  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'integer' })
  quantityAdvised!: number;

  // Written by Wave 2's receive/dispose flows; nothing in this slice moves them.
  @Column({ type: 'integer', default: 0 })
  quantityReceived!: number;

  @Column({ type: 'integer', default: 0 })
  quantityRestocked!: number;

  @Column({ type: 'integer', default: 0 })
  quantityScrapped!: number;

  /** Custody — five values, no `inspected`. Undriven until Wave 2. */
  @Column({ type: 'varchar', length: 32, default: 'advised' })
  custodyState!: string;

  /** Money — orthogonal to custody, never collapsed with it. Undriven until Wave 2. */
  @Column({ type: 'varchar', length: 32, default: 'not_refundable' })
  moneyState!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  disposition!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  receivedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  disposedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

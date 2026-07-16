/**
 * Invoice Numbering Route ORM Entity
 *
 * TypeORM entity for the `invoice_numbering_routes` table (#9 / #10) — the
 * detachable rule routing a connection's document to a numbering series by its
 * neutral document type and optional register/entity scope. Replaces the pre-#9
 * `invoice_numbering_assignments` main/correction split.
 *
 * Resolution key: `(connectionId, documentType, register)`. A surrogate `id`
 * primary key is used because `register` is nullable (a NULL cannot sit in a
 * composite primary key); two partial unique indexes enforce
 * NULL-distinct uniqueness on the routing key (see the migration). No FK to
 * `connections`: the route (and its series) survives connection deletion, and
 * the FK to `invoice_numbering_series` is `ON DELETE RESTRICT` so a series is
 * never cascade-deleted out from under a route.
 *
 * @module libs/core/src/invoicing/infrastructure/persistence/entities
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('invoice_numbering_routes')
export class InvoiceNumberingRouteOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'text' })
  documentType!: string;

  /** Optional neutral register/entity scope; NULL = the type's register-less default route. */
  @Column({ type: 'text', nullable: true })
  register!: string | null;

  @Column({ type: 'uuid' })
  seriesId!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

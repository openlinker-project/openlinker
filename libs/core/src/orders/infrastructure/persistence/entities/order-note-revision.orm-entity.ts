/**
 * Order Note Revision ORM Entity (#3531)
 *
 * Append-only: one row per note edit, capturing the text as it stood
 * immediately before the edit overwrote it. No FK to `order_notes` — the
 * `return_line_events` precedent of an append-only act ledger referencing its
 * parent by value only, since nothing here needs the DB to enforce the
 * relationship and cascading a note's revisions away on delete would erase
 * the exact history "a deleted note leaves an entry without its text" relies
 * on staying readable.
 *
 * @module libs/core/src/orders/infrastructure/persistence/entities
 */
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('order_note_revisions')
export class OrderNoteRevisionOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index('IDX_order_note_revisions_noteId')
  noteId!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'boolean' })
  showToPacker!: boolean;

  @Column({ type: 'timestamptz' })
  supersededAt!: Date;
}

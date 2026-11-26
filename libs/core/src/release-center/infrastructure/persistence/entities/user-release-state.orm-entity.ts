/**
 * User Release State ORM Entity (#4141)
 *
 * One row per user: the release-center version cursor and the dialog
 * preference. The FK to `users` lives in the migration only (no `@ManyToOne`),
 * the convention of the fulfilment tables, and every name here matches the
 * migration because the harness builds schema by `synchronize`.
 *
 * @module libs/core/src/release-center/infrastructure/persistence/entities
 */
import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('user_release_state')
export class UserReleaseStateOrmEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_user_release_state' })
  userId!: string;

  @Column({ type: 'text', nullable: true })
  lastSeenVersion!: string | null;

  // The four numbers exist so the cursor guard is one row comparison in SQL.
  @Column({ type: 'integer', nullable: true })
  major!: number | null;

  @Column({ type: 'integer', nullable: true })
  minor!: number | null;

  @Column({ type: 'integer', nullable: true })
  patch!: number | null;

  @Column({ type: 'integer', nullable: true })
  rank!: number | null;

  @Column({ type: 'boolean', default: false })
  skipDialog!: boolean;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}

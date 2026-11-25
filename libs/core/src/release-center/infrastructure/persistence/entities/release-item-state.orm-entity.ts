/**
 * Release Item State ORM Entity (#4141)
 *
 * One row per (scope, owner, item). Installation and user scope share a table
 * but not a uniqueness rule, so there are two PARTIAL unique indexes and a
 * CHECK tying `userId` to the scope. No Postgres enums: the vocabularies grow
 * in code, and a CHECK on `doneVia` is the only closed set worth the migration.
 * FKs (`userId` CASCADE, `actedByUserId` SET NULL) live in the migration only.
 *
 * @module libs/core/src/release-center/infrastructure/persistence/entities
 */
import { Check, Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('release_item_states')
@Index('UQ_release_item_states_installation_key', ['itemKey'], {
  unique: true,
  where: `"scope" = 'installation'`,
})
@Index('UQ_release_item_states_user_key', ['userId', 'itemKey'], {
  unique: true,
  where: `"scope" = 'user'`,
})
@Check('CHK_release_item_states_scope_user', `("scope" = 'user') = ("userId" IS NOT NULL)`)
@Check('CHK_release_item_states_done_via', `"doneVia" IS NULL OR "doneVia" IN ('auto', 'manual')`)
export class ReleaseItemStateOrmEntity {
  @PrimaryColumn({
    type: 'uuid',
    default: () => 'gen_random_uuid()',
    primaryKeyConstraintName: 'PK_release_item_states',
  })
  id!: string;

  @Column({ type: 'text' })
  scope!: string;

  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ type: 'text' })
  itemKey!: string;

  @Column({ type: 'text' })
  status!: string;

  @Column({ type: 'text', nullable: true })
  doneVia!: string | null;

  /** Plain uuid, no relation: the FK (SET NULL) is migration-only. */
  @Column({ type: 'uuid', nullable: true })
  actedByUserId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  snoozedUntil!: Date | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}

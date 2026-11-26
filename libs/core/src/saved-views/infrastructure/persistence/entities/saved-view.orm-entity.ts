/**
 * Saved View ORM Entity
 *
 * TypeORM mapping for `saved_views` (#4241). Constraints are declared
 * class-level under the SAME NAMES the migration uses, because the integration
 * harness builds its schema by `synchronize` and an unnamed decorator would
 * mint a hash name there (see `fulfillment-work-migration-parity.int-spec.ts`).
 *
 * Personal and shared views are separate uniqueness domains, hence two PARTIAL
 * unique indexes rather than one over nullable columns (NULLs are distinct in
 * a plain unique index, so a nullable owner would never collide).
 *
 * `owner_user_id` is set ONLY for personal views and carries the
 * `ON DELETE CASCADE` foreign key declared in the migration: a deleted user
 * takes their personal views with them. A shared view is installation-owned and
 * must outlive its author, so its owner is NULL (a FK has one delete rule per
 * column, so "CASCADE for personal, SET NULL for shared" is expressed as
 * "shared rows have no owner at all", pinned by the CHECK below) and the author
 * is kept in `created_by_user_id`, a plain uuid with no FK. No `@ManyToOne` here
 * by design - the FK is migration-only, the `mcp_tokens` precedent, so this leaf
 * context never names the users context.
 *
 * @module libs/core/src/saved-views/infrastructure/persistence/entities
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

@Entity('saved_views')
@Index('UQ_saved_views_personal_name', ['ownerUserId', 'pageKey', 'name'], {
  unique: true,
  where: `"scope" = 'personal'`,
})
@Index('UQ_saved_views_shared_name', ['pageKey', 'name'], {
  unique: true,
  where: `"scope" = 'shared'`,
})
@Index('UQ_saved_views_shared_default', ['pageKey'], {
  unique: true,
  where: `"scope" = 'shared' AND "is_workspace_default" = true`,
})
@Index('IDX_saved_views_page_owner', ['pageKey', 'ownerUserId'])
@Check(
  'CHK_saved_views_scope_owner',
  `("scope" = 'personal' AND "owner_user_id" IS NOT NULL) OR ("scope" = 'shared' AND "owner_user_id" IS NULL)`
)
export class SavedViewOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', name: 'scope' })
  scope!: string;

  @Column({ type: 'uuid', name: 'owner_user_id', nullable: true })
  ownerUserId!: string | null;

  @Column({ type: 'uuid', name: 'created_by_user_id', nullable: true })
  createdByUserId!: string | null;

  @Column({ type: 'text', name: 'page_key' })
  pageKey!: string;

  @Column({ type: 'text', name: 'name' })
  name!: string;

  @Column({ type: 'jsonb', name: 'definition' })
  definition!: unknown;

  @Column({ type: 'integer', name: 'revision', default: 1 })
  revision!: number;

  @Column({ type: 'boolean', name: 'is_workspace_default', default: false })
  isWorkspaceDefault!: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}

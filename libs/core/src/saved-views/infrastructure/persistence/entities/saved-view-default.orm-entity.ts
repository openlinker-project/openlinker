/**
 * Saved View Default ORM Entity
 *
 * TypeORM mapping for `saved_view_defaults` (#4241): one row per
 * `(user, page)` naming the view that user lands on. `saved_view_id` NULL is a
 * deliberate choice of the system "All" view (which is code, not a row), as
 * distinct from "no row", which falls through to the workspace default.
 *
 * Both FKs (user, view) are `ON DELETE CASCADE` and migration-only, as on
 * `saved_views`.
 *
 * @module libs/core/src/saved-views/infrastructure/persistence/entities
 */
import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('saved_view_defaults')
export class SavedViewDefaultOrmEntity {
  @PrimaryColumn({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @PrimaryColumn({ type: 'text', name: 'page_key' })
  pageKey!: string;

  @Column({ type: 'uuid', name: 'saved_view_id', nullable: true })
  savedViewId!: string | null;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}

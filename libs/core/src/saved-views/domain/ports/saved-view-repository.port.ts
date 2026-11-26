/**
 * Saved View Repository Port
 *
 * Persistence contract for views and per-user defaults. Intra-context: siblings
 * go through `ISavedViewsService`. Uniqueness is the database's job - `insert`
 * and `updateIfRevision` translate the unique violation into
 * `SavedViewNameTakenError`, never a read-then-write check.
 *
 * @module libs/core/src/saved-views/domain/ports
 */
import type { SavedView, SavedViewDefault } from '../entities/saved-view.entity';
import type { SavedViewScope } from '../types/saved-view.types';

export interface InsertSavedViewInput {
  scope: SavedViewScope;
  ownerUserId: string | null;
  createdByUserId: string;
  pageKey: string;
  name: string;
  definition: unknown;
  isWorkspaceDefault: boolean;
}

export interface SavedViewPatch {
  name?: string;
  definition?: unknown;
  isWorkspaceDefault?: boolean;
}

export interface SavedViewRepositoryPort {
  findById(id: string): Promise<SavedView | null>;
  /** The caller's own personal views plus every shared view for the page. */
  listVisible(userId: string, pageKey: string): Promise<SavedView[]>;
  countPersonal(userId: string, pageKey: string): Promise<number>;
  /** Throws `SavedViewNameTakenError` on a duplicate name within the scope's uniqueness domain. */
  insert(input: InsertSavedViewInput): Promise<SavedView>;
  /**
   * Applies the patch only when the stored revision still equals
   * `expectedRevision`, bumping it. `null` means "no row matched" - the caller
   * disambiguates a vanished row from a stale revision.
   */
  updateIfRevision(
    id: string,
    expectedRevision: number,
    patch: SavedViewPatch
  ): Promise<SavedView | null>;
  delete(id: string): Promise<boolean>;
  findDefault(userId: string, pageKey: string): Promise<SavedViewDefault | null>;
  /** `savedViewId: null` records an explicit choice of the system "All" view. */
  upsertDefault(userId: string, pageKey: string, savedViewId: string | null): Promise<void>;
  clearDefault(userId: string, pageKey: string): Promise<void>;
}

/**
 * Saved View Domain Entity
 *
 * A persisted personal or shared view. `definition` is kept as `unknown`
 * because it is stored as jsonb and read tolerantly: the service coerces it
 * through `readSavedViewDefinition` rather than trusting the stored shape.
 *
 * @module libs/core/src/saved-views/domain/entities
 */
import type { SavedViewScope } from '../types/saved-view.types';

export class SavedView {
  constructor(
    public readonly id: string,
    public readonly scope: SavedViewScope,
    /** Personal: the owner. Shared: always null (see the ORM entity for why). */
    public readonly ownerUserId: string | null,
    public readonly createdByUserId: string | null,
    public readonly pageKey: string,
    public readonly name: string,
    public readonly definition: unknown,
    public readonly revision: number,
    public readonly isWorkspaceDefault: boolean,
    public readonly createdAt: Date,
    public readonly updatedAt: Date
  ) {}
}

/** A user's explicit default for a page. `savedViewId: null` is a deliberate choice of the system "All" view. */
export class SavedViewDefault {
  constructor(
    public readonly userId: string,
    public readonly pageKey: string,
    public readonly savedViewId: string | null
  ) {}
}

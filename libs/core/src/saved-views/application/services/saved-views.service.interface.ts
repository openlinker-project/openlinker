/**
 * Saved Views Service Interface
 *
 * The cross-context contract for named list views. Authorization is expressed
 * through the actor flag (`isAdmin`), never role strings.
 *
 * @module libs/core/src/saved-views/application/services
 */
import type {
  CreateSavedViewInput,
  SavedViewActor,
  SavedViewReadModel,
  UpdateSavedViewInput,
} from '../../domain/types/saved-view.types';

export interface ISavedViewsService {
  /** The caller's personal views plus every shared view for the page, each flagged for the caller. */
  list(actor: SavedViewActor, pageKey: string): Promise<SavedViewReadModel[]>;

  /** Throws InvalidSavedViewError, SavedViewForbiddenError (shared by non-admin), SavedViewNameTakenError. */
  create(actor: SavedViewActor, input: CreateSavedViewInput): Promise<SavedViewReadModel>;

  /**
   * Throws SavedViewNotFoundError (also for another user's personal view),
   * SavedViewForbiddenError, SavedViewRevisionConflictError, SavedViewNameTakenError.
   */
  update(
    actor: SavedViewActor,
    id: string,
    input: UpdateSavedViewInput
  ): Promise<SavedViewReadModel>;

  remove(actor: SavedViewActor, id: string): Promise<void>;

  /**
   * Set (`viewId`) or clear (`null` = the system "All" view) the caller's
   * default for a page. A view the caller cannot see answers not-found.
   */
  setDefault(actor: SavedViewActor, pageKey: string, viewId: string | null): Promise<void>;
}

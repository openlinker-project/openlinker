/**
 * Saved Views Context Public API
 *
 * Named, restorable list views (#4241): personal (owner only) and shared
 * (installation-owned, admin-managed). System views live in frontend code.
 *
 * A LEAF context - nothing here imports a sibling `@openlinker/core/*`
 * context, and nothing here speaks HTTP.
 *
 * @module libs/core/src/saved-views
 */

export {
  SAVED_VIEW_DEFINITION_VERSION,
  SAVED_VIEW_LIMITS,
  SavedViewLimitRuleValues,
  SavedViewScopeValues,
  SortDirectionValues,
  checkSavedViewDefinition,
  normaliseSavedViewName,
  readSavedViewDefinition,
} from './domain/types/saved-view.types';
export type {
  CreateSavedViewInput,
  ReadSavedViewDefinitionResult,
  SavedViewActor,
  SavedViewDefinition,
  SavedViewDefinitionBreach,
  SavedViewLimitRule,
  SavedViewReadModel,
  SavedViewScope,
  SavedViewSort,
  SavedViewSortDirection,
  UpdateSavedViewInput,
} from './domain/types/saved-view.types';

export { SavedView, SavedViewDefault } from './domain/entities/saved-view.entity';
export type {
  InsertSavedViewInput,
  SavedViewPatch,
  SavedViewRepositoryPort,
} from './domain/ports/saved-view-repository.port';

export type { SavedViewDefinitionPolicyPort } from './domain/ports/saved-view-definition-policy.port';

export {
  InvalidSavedViewError,
  SavedViewForbiddenError,
  SavedViewNameTakenError,
  SavedViewNotFoundError,
  SavedViewRevisionConflictError,
} from './domain/exceptions/saved-view.exceptions';

export type { ISavedViewsService } from './application/services/saved-views.service.interface';

export { SavedViewsModule } from './saved-views.module';
export * from './saved-views.tokens';

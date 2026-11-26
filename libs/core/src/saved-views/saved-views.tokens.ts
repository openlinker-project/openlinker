/**
 * Saved Views Context DI Tokens
 *
 * Symbol-only by convention (§ Symbol DI Token Re-export Convention): the
 * context barrel does `export * from './saved-views.tokens'`.
 *
 * @module libs/core/src/saved-views
 */

export const SAVED_VIEW_REPOSITORY_TOKEN = Symbol('SavedViewRepositoryPort');
export const SAVED_VIEWS_SERVICE_TOKEN = Symbol('ISavedViewsService');
export const SAVED_VIEW_DEFINITION_POLICY_TOKEN = Symbol('SavedViewDefinitionPolicyPort');

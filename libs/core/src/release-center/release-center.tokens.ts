/**
 * Release Center Context DI Tokens
 *
 * Symbol-only by convention (§ Symbol DI Token Re-export Convention): the
 * context barrel does `export * from './release-center.tokens'`.
 *
 * @module libs/core/src/release-center
 */

export const RELEASE_CENTER_ITEM_STATE_REPOSITORY_TOKEN = Symbol('ReleaseItemStateRepositoryPort');
export const RELEASE_CENTER_CURSOR_REPOSITORY_TOKEN = Symbol('ReleaseCursorRepositoryPort');
export const RELEASE_CENTER_ITEM_STATE_SERVICE_TOKEN = Symbol('IReleaseItemStateService');
export const RELEASE_CENTER_CURSOR_SERVICE_TOKEN = Symbol('IReleaseCursorService');

/**
 * Content Module Dependency Injection Tokens
 *
 * Symbol tokens for the content bounded context. Used to inject the
 * repository port, the publisher port, and the application service via
 * NestJS DI without leaking concrete classes.
 *
 * @module libs/core/src/content
 */
export const PRODUCT_CONTENT_FIELD_REPOSITORY_TOKEN = Symbol(
  'ProductContentFieldRepositoryPort',
);
export const CONTENT_PUBLISHER_PORT_TOKEN = Symbol('ContentPublisherPort');
export const CONTENT_DRAFT_SERVICE_TOKEN = Symbol('IContentDraftService');
export const CONTENT_SUGGESTION_SERVICE_TOKEN = Symbol('IContentSuggestionService');
export const CONTENT_STATE_READER_SERVICE_TOKEN = Symbol('IContentStateReaderService');

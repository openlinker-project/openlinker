/**
 * Shared HTML utilities
 *
 * The inbound sanitization boundary for description HTML (#2198). Kept on its
 * own export subpath so a consumer that only needs `Logger` or `http` does not
 * import a sanitizer.
 *
 * @module libs/shared/src/html
 */
export { sanitizeStoredHtml } from './sanitize-stored-html';

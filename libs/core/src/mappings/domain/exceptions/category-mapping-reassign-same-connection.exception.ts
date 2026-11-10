/**
 * Category Mapping Reassign Same Connection Exception
 *
 * Thrown by `MappingConfigService.reassignCategoryMappings` when the source
 * and target connection are the same (#3993). Every row would then clash with
 * itself and be dropped as "already mapped", silently deleting the
 * connection's whole category mapping set, so the request is refused before
 * anything is read or written. Raised in the service rather than only at the
 * HTTP boundary so every caller (browser, curl, MCP) is covered.
 *
 * @module libs/core/src/mappings/domain/exceptions
 */

export class CategoryMappingReassignSameConnectionException extends Error {
  constructor(public readonly connectionId: string) {
    super(
      `Cannot move category mappings from connection '${connectionId}' onto itself: choose a different marketplace connection`,
    );
    this.name = 'CategoryMappingReassignSameConnectionException';
    Error.captureStackTrace(this, this.constructor);
  }
}

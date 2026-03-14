/**
 * Marketplace Cursor Types
 *
 * Cursor-related types for the Marketplace capability contract.
 *
 * Domain-only: no framework dependencies.
 *
 * @module libs/core/src/integrations/domain/types
 */

/**
 * Opaque marketplace cursor value.
 *
 * Cursor semantics are marketplace/adapter-specific. Core treats cursor as an
 * opaque token and only persists it. Adapters must ensure cursors are monotonic
 * per connection.
 */
export type MarketplaceCursor = string;


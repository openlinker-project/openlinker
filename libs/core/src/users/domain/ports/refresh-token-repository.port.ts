/**
 * Refresh Token Repository Port
 *
 * Persistence contract for refresh tokens. Implemented by
 * RefreshTokenRepository in the infrastructure layer.
 *
 * The port speaks domain entities only — chain linkage is carried on
 * `RefreshToken.rotatedFromId`, not via repository-level arguments.
 * `revokeChain` walks both ancestors and descendants of a given token
 * in a single SQL round-trip (recursive CTE).
 *
 * @module libs/core/src/users/domain/ports
 */
import type { RefreshToken } from '../entities/refresh-token.entity';
import type { RefreshTokenRevocationReason } from '../types/refresh-token.types';

export interface RefreshTokenRepositoryPort {
  /**
   * Insert a freshly-constructed token row. The caller (service)
   * populates `rotatedFromId` to NULL (login) or the predecessor's id
   * (rotation).
   */
  insert(token: RefreshToken): Promise<RefreshToken>;

  /** Look up by hash. Returns null if no row matches. */
  findByHash(tokenHash: string): Promise<RefreshToken | null>;

  /**
   * Mark a single token revoked with the given reason. Idempotent
   * (already-revoked rows are a no-op).
   */
  revoke(id: string, reason: RefreshTokenRevocationReason, at?: Date): Promise<void>;

  /**
   * Revoke the entire rotation chain reachable from `tokenId` — the
   * token itself, every ancestor (via `rotated_from_id`), and every
   * descendant. Used on reuse-detection. Already-revoked rows are
   * left as-is.
   */
  revokeChain(tokenId: string, reason: RefreshTokenRevocationReason): Promise<void>;
}

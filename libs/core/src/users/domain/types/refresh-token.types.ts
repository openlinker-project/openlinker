/**
 * Refresh Token Types
 *
 * Domain types for the refresh-token rotation flow (#710). The
 * revocation reason is persisted alongside `revokedAt` for audit so
 * operators can distinguish normal rotations from logout vs. the
 * security-critical reuse-detection branch.
 *
 * @module libs/core/src/users/domain/types
 */

export const RefreshTokenRevocationReasonValues = [
  'rotated',
  'logout',
  'reuse_detected',
] as const;

export type RefreshTokenRevocationReason =
  (typeof RefreshTokenRevocationReasonValues)[number];

/**
 * Narrow a raw `revoked_reason` column value into the domain union.
 * Repositories call this on the persistence boundary so the domain
 * entity never holds a stringly-typed reason. Throws if the DB row
 * has a value outside the documented set — that signals data
 * corruption (manual edit / unrecognised migration) and should fail
 * loud rather than silently shape an invalid domain object.
 */
export function parseRefreshTokenRevocationReason(
  value: string | null,
): RefreshTokenRevocationReason | null {
  if (value === null) return null;
  if ((RefreshTokenRevocationReasonValues as readonly string[]).includes(value)) {
    return value as RefreshTokenRevocationReason;
  }
  throw new Error(`Invalid refresh_tokens.revoked_reason: ${value}`);
}

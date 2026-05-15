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

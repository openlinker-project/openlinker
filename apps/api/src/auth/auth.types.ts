/**
 * Authentication & Authorization Types
 *
 * Shared type definitions for the auth module. Includes JWT payload shape
 * and the authenticated user object attached to requests by the JWT strategy.
 *
 * @module apps/api/src/auth
 */
import type { UserRole } from '@openlinker/core/users';

/**
 * Shape of the JWT token payload after signing/verification.
 */
export interface JwtPayload {
  sub: string;
  username: string;
  role: UserRole;
  /**
   * Consent to demo session recording (#1938). Carried as a claim so
   * `AnalyticsConsentGuard` can gate every route without a per-request
   * database read. Optional on the wire: a token minted before the claim
   * existed reads as no consent (fail closed) rather than crashing.
   */
  analyticsConsent?: boolean;
}

/**
 * Authenticated user object attached to req.user by the JWT strategy.
 * Available in controllers via @CurrentUser() decorator.
 */
export interface AuthenticatedUser {
  id: string;
  username: string;
  role: UserRole;
  /**
   * Mirrors the claim above (#1938). `JwtStrategy` always normalises it to a
   * boolean, but the field stays optional because a token minted before the
   * claim existed carries no value — consumers must treat absent as "no
   * consent", which is what `AnalyticsConsentGuard`'s truthiness check does.
   */
  analyticsConsent?: boolean;
}

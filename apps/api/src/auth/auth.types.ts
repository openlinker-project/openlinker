/**
 * Authentication & Authorization Types
 *
 * Shared type definitions for the auth module. Includes JWT payload shape
 * and the authenticated user object attached to requests by the JWT strategy.
 *
 * @module apps/api/src/auth
 */
import { UserRole } from '@openlinker/core/users';

/**
 * Shape of the JWT token payload after signing/verification.
 */
export interface JwtPayload {
  sub: string;
  username: string;
  role: UserRole;
}

/**
 * Authenticated user object attached to req.user by the JWT strategy.
 * Available in controllers via @CurrentUser() decorator.
 */
export interface AuthenticatedUser {
  id: string;
  username: string;
  role: UserRole;
}

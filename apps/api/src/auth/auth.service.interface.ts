/**
 * Authentication Service Interface
 *
 * Contract for user credential validation and JWT token issuance.
 *
 * @module apps/api/src/auth
 */
import type { User } from '@openlinker/core/users';
import type { LoginResponseDto } from './dto/login-response.dto';

export const AUTH_SERVICE_TOKEN = Symbol('IAuthService');

/**
 * How a self-service password change ended (#3456). A closed union rather than
 * exceptions: both refusals are ordinary answers to a form, and the controller
 * maps each to its own 400.
 */
export type ChangePasswordOutcome = 'changed' | 'incorrect-current' | 'unchanged';

export interface IAuthService {
  validateUser(username: string, password: string): Promise<User | null>;
  login(user: User): LoginResponseDto;
  getMe(userId: string): Promise<User>;
  /**
   * Persists the caller's own analytics opt-in and returns the refreshed user
   * so the controller can answer with the authoritative post-update state
   * rather than echoing the request body (#1882).
   */
  updateAnalyticsConsent(userId: string, analyticsConsent: boolean): Promise<User>;
  /**
   * The signed-in user replaces their own password (#3456). Re-verifies the
   * current password, refuses a new password equal to it, and — on success —
   * writes the new hash and clears `mustChangePassword` in one statement.
   * The caller re-mints its token through `/auth/refresh` afterwards.
   */
  changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<ChangePasswordOutcome>;
}

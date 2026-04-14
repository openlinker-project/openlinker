/**
 * Password Reset Service Interface
 *
 * Contract for the password reset use cases: requesting a reset link and
 * consuming a token to set a new password.
 *
 * @module apps/api/src/auth
 */

export interface IPasswordResetService {
  requestReset(email: string): Promise<void>;
  resetPassword(token: string, newPassword: string): Promise<void>;
}

export const PASSWORD_RESET_SERVICE_TOKEN = Symbol('IPasswordResetService');

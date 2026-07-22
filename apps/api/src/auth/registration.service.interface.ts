/**
 * Registration Service Interface
 *
 * Contract for self-service user registration. Validates uniqueness, hashes
 * passwords, and persists new users pending either admin approval (normal
 * mode) or email confirmation (demo mode, #1624).
 *
 * Gated by the OL_REGISTRATION_ENABLED env flag (default: false).
 *
 * @module apps/api/src/auth
 */

export interface IRegistrationService {
  /**
   * `clientIp` is only consulted when demo mode is enabled, to key the
   * per-IP registration rate limit (#1469). Omit it for non-demo callers.
   */
  register(username: string, email: string, password: string, clientIp?: string): Promise<void>;
}

export const REGISTRATION_SERVICE_TOKEN = Symbol('IRegistrationService');

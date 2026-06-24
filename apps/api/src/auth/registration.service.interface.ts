/**
 * Registration Service Interface
 *
 * Contract for self-service user registration. Validates uniqueness, hashes
 * passwords, and persists new users in the pending state for admin approval.
 *
 * Gated by the OL_REGISTRATION_ENABLED env flag (default: false).
 *
 * @module apps/api/src/auth
 */

export interface IRegistrationService {
  register(username: string, email: string, password: string): Promise<void>;
}

export const REGISTRATION_SERVICE_TOKEN = Symbol('IRegistrationService');

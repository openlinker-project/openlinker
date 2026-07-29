/**
 * User Domain Entity
 *
 * Represents an authenticated user of the OpenLinker platform. This is a
 * pure domain entity with no framework dependencies, used by the auth module
 * for credential validation and session management.
 *
 * @module libs/core/src/users/domain/entities
 */

import type { UserRole } from '../types/role.types';
import type { UserStatus } from '../types/user-status.types';

export class User {
  constructor(
    public readonly id: string,
    public readonly username: string,
    public readonly email: string | null,
    public readonly passwordHash: string,
    public readonly role: UserRole,
    public readonly status: UserStatus,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
    // Opt-in for demo-only usage analytics, captured at registration (#1743).
    // Defaults to false (opt-in): accounts created before this field existed,
    // and callers that don't set it, are treated as NOT having consented, so
    // analytics is never enabled without an affirmative choice.
    public readonly analyticsConsent: boolean = false
  ) {}
}

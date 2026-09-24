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
    public readonly analyticsConsent: boolean = false,
    // The packer's own free-text label for their bench and printer, e.g.
    // "Bench 3 / Zebra ZD420" (#3424). Deliberately CONFIG rather than
    // identity: ADR-071 refuses a station PRINCIPAL - no station token, no
    // PIN, no badge - so this carries no authentication weight and is read
    // and displayed exactly like a connection's operator-authored `name`.
    public readonly packStationLabel: string | null = null,
    // Best-effort presence heartbeat, bumped by BENCH ACTIVITY and never by a
    // login or session event (#3424), so a signed-in but idle packer reads as
    // offline. `null` means never observed, which the board renders as
    // offline: an account that has never touched a bench is not at one.
    //
    // Whether that reads as ONLINE is a threshold over this instant computed
    // at read time and never stored - a stored boolean would need something
    // to flip it back, and nothing would.
    public readonly lastActiveAt: Date | null = null
  ) {}
}

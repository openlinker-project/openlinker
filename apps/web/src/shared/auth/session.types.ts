/**
 * Permission strings granted to a user. Mirrors the backend's
 * `PermissionValues` from `@openlinker/core/users` — keep the two in sync
 * when adding new resource actions.
 */
export const PermissionValues = [
  'connections:read',
  'connections:write',
  'sync:read',
  'sync:write',
  'integrations:read',
  'integrations:write',
  'adapters:read',
  'orders:read',
  'orders:write',
  'products:read',
  'products:write',
  'inventory:read',
  'inventory:write',
  'listings:read',
  'listings:write',
  'users:read',
  'users:write',
  'customers:read',
  // #3424 - the pack bench's own write affordances. Its own value rather than
  // `orders:write` so a packer, who holds nothing else, can still claim work.
  'bench:write',
  'shipments:read',
  'shipments:write',
  'invoices:read',
  'invoices:write',
  'webhooks:read',
  'ai:suggest',
  'content:write',
  'automations:read',
  'automations:write',
  // DISPLAY-ONLY (#3066): gates the locations-list Add/Edit/Delete/Retire
  // affordances. Deliberately not `inventory:write` — see that constant's
  // docblock on the backend for why.
  'inventory-locations:write',
  'analytics:write',
] as const;

export type Permission = (typeof PermissionValues)[number];

export interface MeResponse {
  id: string;
  username: string;
  email: string | null;
  role: string;
  permissions: Permission[];
  /**
   * Account opt-in for demo-only usage analytics (#1743). Optional so a
   * payload from an API predating this field is tolerated; consumers treat a
   * missing value as no consent (opt-in default).
   */
  analyticsConsent?: boolean;
  /**
   * The signed-in user's own bench/printer label (#3404), e.g.
   * "Zebra ZD420 · Bench 3", or `null` if unset. Optional so a payload from
   * an API predating this field is tolerated. This is always the VIEWER'S
   * own value — never a colleague's — so there is no PII concern in `/auth/me`
   * carrying it.
   */
  packStationLabel?: string | null;
}

export interface SessionUser {
  id: string;
  username: string;
  email: string | null;
  role: string;
  permissions: Permission[];
  /** Account opt-in for demo-only usage analytics (#1743). Absent ⇒ opt-in (off). */
  analyticsConsent?: boolean;
  /** The signed-in user's own bench/printer label (#3404). Absent/null ⇒ unset. */
  packStationLabel?: string | null;
}

export interface Session {
  status: 'anonymous' | 'authenticated';
  accessToken: string | null;
  user: SessionUser | null;
}

export const ANONYMOUS_SESSION: Session = {
  status: 'anonymous',
  accessToken: null,
  user: null,
};

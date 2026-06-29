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
] as const;

export type Permission = (typeof PermissionValues)[number];

export interface MeResponse {
  id: string;
  username: string;
  email: string | null;
  role: string;
  permissions: Permission[];
}

export interface SessionUser {
  id: string;
  username: string;
  email: string | null;
  role: string;
  permissions: Permission[];
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

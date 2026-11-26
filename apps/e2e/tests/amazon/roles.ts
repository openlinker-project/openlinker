/**
 * Provisions throwaway viewer/operator accounts for the Amazon suite
 * (admin creates the user with a one-time password, which is changed on first login).
 *
 * @module tests/amazon
 */
import type { E2eEnv } from '../../src/config/env';
import type { OlApi } from './amazon-test';

export interface RoleUser {
  username: string;
  password: string;
  id: string;
}

const cache = new Map<string, RoleUser>();

export async function provisionRoleUser(env: E2eEnv, admin: OlApi, role: 'viewer' | 'operator'): Promise<RoleUser> {
  const hit = cache.get(role);
  if (hit) return hit;
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const user = { username: `e2e-amz-${role}-${stamp}`, password: `E2e-Pass-${stamp}-x!`, id: '' };
  const created = await admin.call('POST', '/users', {
    displayName: `E2E Amazon ${role}`,
    username: user.username,
    email: `${user.username}@example.test`,
    role,
  });
  if (created.status >= 300) throw new Error(`create ${role} failed: ${created.status} ${JSON.stringify(created.body)}`);
  const temp = created.body.temporaryPassword as string;
  const login = await fetch(`${env.apiUrl}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: user.username, password: temp }),
  });
  if (!login.ok) throw new Error(`first login ${role} failed: ${login.status}`);
  const token = ((await login.json()) as { access_token: string }).access_token;
  const change = await fetch(`${env.apiUrl}/v1/auth/me/password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ currentPassword: temp, newPassword: user.password }),
  });
  if (!change.ok) throw new Error(`password change ${role} failed: ${change.status} ${await change.text()}`);
  user.id = created.body.id as string;
  cache.set(role, user);
  return user;
}

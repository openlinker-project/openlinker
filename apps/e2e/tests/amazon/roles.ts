/**
 * Provisions throwaway viewer/operator accounts for the Amazon suite
 * (register, then the admin approves with the wanted role).
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
  const reg = await fetch(`${env.apiUrl}/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: user.username, email: `${user.username}@example.test`, password: user.password }),
  });
  if (!reg.ok) throw new Error(`register ${role} failed: ${reg.status} ${await reg.text()}`);
  const list = await admin.call('GET', '/users');
  const items = (list.body?.users ?? list.body) as { id: string; username: string; status?: string }[];
  const found = items.find((u) => u.username === user.username);
  if (!found) throw new Error(`registered ${role} not found in the admin user list`);
  const approve = await admin.call('POST', `/users/${found.id}/approve`, { role });
  if (approve.status >= 300) throw new Error(`approve ${role} failed: ${approve.status} ${JSON.stringify(approve.body)}`);
  user.id = found.id;
  cache.set(role, user);
  return user;
}

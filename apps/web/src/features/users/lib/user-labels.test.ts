import { describe, expect, it } from 'vitest';
import { getMessages } from '../../../shared/i18n';
import { ASSIGNABLE_ROLES, userRoleLabel, userStatusLabel } from './user-labels';

describe('user labels', () => {
  const copy = getMessages('users');

  it('should label every assignable role', () => {
    expect(ASSIGNABLE_ROLES.map((role) => userRoleLabel(role, copy))).toEqual([
      'Viewer',
      'Operator',
      'Packer',
      'Admin',
    ]);
  });

  it('should label every status', () => {
    expect(userStatusLabel('active', copy)).toBe('Active');
    expect(userStatusLabel('pending', copy)).toBe('Pending');
    expect(userStatusLabel('deactivated', copy)).toBe('Deactivated');
  });

  it('should show a value it does not know as it is', () => {
    expect(userRoleLabel('auditor', copy)).toBe('auditor');
    expect(userStatusLabel('suspended', copy)).toBe('suspended');
  });

  it('should not treat an inherited property name as a known value', () => {
    expect(userRoleLabel('constructor', copy)).toBe('constructor');
  });
});

import { describe, expect, it } from 'vitest';
import { getMessages, interpolate } from '../../../shared/i18n';
import { createLoginFormSchema } from './login-form.schema';
import { createChangePasswordFormSchema } from './change-password-form.schema';

describe('auth form schema factories', () => {
  const copy = getMessages('auth').validation;

  it('should report the username message from the copy when the username is empty', () => {
    const result = createLoginFormSchema(copy).safeParse({ username: '   ', password: 'secret' });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(copy.username);
  });

  it('should accept a filled login form', () => {
    const result = createLoginFormSchema(copy).safeParse({ username: 'admin', password: 'secret' });

    expect(result.success).toBe(true);
  });

  it('should build a schema whose messages come from the copy it was given', () => {
    const custom = { ...copy, passwordRequired: 'Custom required message' };

    const result = createLoginFormSchema(custom).safeParse({ username: 'admin', password: '' });

    expect(result.error?.issues.map((issue) => issue.message)).toContain('Custom required message');
  });

  it('should interpolate the minimum length into the change-password message', () => {
    const result = createChangePasswordFormSchema(copy).safeParse({
      currentPassword: 'one-time',
      newPassword: 'short',
      confirmPassword: 'short',
    });

    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      interpolate(copy.passwordMin, { min: 8 }),
    );
  });
});

/**
 * Mailer Settings Form Schema — Unit Tests
 *
 * Covers the From-address validation branch (#1749): both the bare-email
 * and `Display Name <email>` forms must pass, malformed input must fail,
 * and the pre-existing length/required-for-SMTP rules must stay intact.
 *
 * @module apps/web/src/features/mailer-settings/components
 */
import { describe, expect, it } from 'vitest';
import { MAX_FROM_ADDRESS_LENGTH, mailerSettingsFormSchema } from './mailer-settings-form.schema';

const validSmtpBase = {
  transport: 'smtp' as const,
  smtpHost: 'smtp.example.com',
  smtpPort: '587',
  smtpSecure: true,
  password: '',
};

describe('mailerSettingsFormSchema', () => {
  it('should accept a bare email address', () => {
    const result = mailerSettingsFormSchema.safeParse({
      ...validSmtpBase,
      fromAddress: 'noreply@openlinker.io',
    });

    expect(result.success).toBe(true);
  });

  it('should accept a "Display Name <email>" address', () => {
    const result = mailerSettingsFormSchema.safeParse({
      ...validSmtpBase,
      fromAddress: 'OpenLinker <noreply@openlinker.io>',
    });

    expect(result.success).toBe(true);
  });

  it('should reject a malformed bare address', () => {
    const result = mailerSettingsFormSchema.safeParse({
      ...validSmtpBase,
      fromAddress: 'not-an-email',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'fromAddress');
      expect(issue?.message).toContain('Enter a valid email address');
    }
  });

  it('should reject a display-name address with a malformed inner email', () => {
    const result = mailerSettingsFormSchema.safeParse({
      ...validSmtpBase,
      fromAddress: 'Name <not-an-email>',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'fromAddress');
      expect(issue?.message).toContain('Enter a valid email address');
    }
  });

  it('should reject an empty From address for SMTP transport', () => {
    const result = mailerSettingsFormSchema.safeParse({
      ...validSmtpBase,
      fromAddress: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'fromAddress');
      expect(issue?.message).toBe('From address is required for SMTP transport');
    }
  });

  it('should accept an empty From address for console transport', () => {
    const result = mailerSettingsFormSchema.safeParse({
      ...validSmtpBase,
      transport: 'console',
      fromAddress: '',
    });

    expect(result.success).toBe(true);
  });

  it('should reject an address with two bracketed emails rather than silently picking one', () => {
    const result = mailerSettingsFormSchema.safeParse({
      ...validSmtpBase,
      fromAddress: 'A <b@example.com> <d@example.com>',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'fromAddress');
      expect(issue?.message).toContain('Enter a valid email address');
    }
  });

  it('should reject a From address longer than the max length', () => {
    const tooLong = `${'a'.repeat(MAX_FROM_ADDRESS_LENGTH)}@example.com`;
    const result = mailerSettingsFormSchema.safeParse({
      ...validSmtpBase,
      fromAddress: tooLong,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'fromAddress');
      expect(issue?.message).toContain('too long');
    }
  });
});

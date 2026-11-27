/**
 * Password-reset notifier unit tests: the notifier composes `MailerPort`. The
 * adapters behind the port are covered next to them in `libs/core` (#3552).
 */
import type { ConfigService } from '@nestjs/config';
import { User, type MailerPort } from '@openlinker/core/users';
import { MailerPasswordResetNotifierAdapter } from './mailer-password-reset-notifier.adapter';

function makeConfig(values: Record<string, string>): ConfigService {
  return {
    get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
  } as unknown as ConfigService;
}

describe('MailerPasswordResetNotifierAdapter', () => {
  const makeUser = (email: string | null): User =>
    new User('u-1', 'admin', email, 'hash', 'admin', 'active', new Date(), new Date());

  it('sends a reset email containing the tokenized link via the mailer', async () => {
    const mailer: jest.Mocked<MailerPort> = { sendEmail: jest.fn().mockResolvedValue(undefined) };
    const notifier = new MailerPasswordResetNotifierAdapter(
      mailer,
      makeConfig({ WEB_URL: 'https://app.example.com' })
    );

    await notifier.notifyResetRequested(makeUser('user@example.com'), 'raw-token-123');

    expect(mailer.sendEmail).toHaveBeenCalledTimes(1);
    const message = mailer.sendEmail.mock.calls[0][0];
    expect(message.to).toBe('user@example.com');
    expect(message.text).toContain('https://app.example.com/reset-password/raw-token-123');
  });

  it('does not send when the user has no email', async () => {
    const mailer: jest.Mocked<MailerPort> = { sendEmail: jest.fn() };
    const notifier = new MailerPasswordResetNotifierAdapter(mailer, makeConfig({}));

    await notifier.notifyResetRequested(makeUser(null), 'raw-token-123');

    expect(mailer.sendEmail).not.toHaveBeenCalled();
  });
});

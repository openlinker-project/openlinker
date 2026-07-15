/**
 * Mailer infrastructure unit tests: transport selection by config, the
 * console + SMTP adapter contracts, and the password-reset notifier that
 * composes MailerPort.
 */
import type { ConfigService } from '@nestjs/config';
import { User, type MailerPort } from '@openlinker/core/users';
import { ConsoleMailerAdapter } from './console-mailer.adapter';
import { SmtpMailerAdapter, type SmtpTransport } from './smtp-mailer.adapter';
import { createMailer } from './mailer.provider';
import { MailerPasswordResetNotifierAdapter } from './mailer-password-reset-notifier.adapter';

function makeConfig(values: Record<string, string>): ConfigService {
  return {
    get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
  } as unknown as ConfigService;
}

describe('createMailer (transport selection)', () => {
  it('defaults to the console adapter when no SMTP host is configured', () => {
    const mailer = createMailer(makeConfig({}));
    expect(mailer).toBeInstanceOf(ConsoleMailerAdapter);
  });

  it('uses the console adapter when MAIL_TRANSPORT=console even if a host is set', () => {
    const mailer = createMailer(makeConfig({ MAIL_TRANSPORT: 'console', MAIL_SMTP_HOST: 'smtp.x' }));
    expect(mailer).toBeInstanceOf(ConsoleMailerAdapter);
  });

  it('uses the SMTP adapter when a host is configured', () => {
    const mailer = createMailer(makeConfig({ MAIL_SMTP_HOST: 'smtp.example.com' }));
    expect(mailer).toBeInstanceOf(SmtpMailerAdapter);
  });

  it('throws when MAIL_TRANSPORT=smtp but no host is set', () => {
    expect(() => createMailer(makeConfig({ MAIL_TRANSPORT: 'smtp' }))).toThrow(/MAIL_SMTP_HOST/);
  });
});

describe('SmtpMailerAdapter', () => {
  it('forwards the message to the underlying transport with the From address', async () => {
    const transport: jest.Mocked<SmtpTransport> = { sendMail: jest.fn().mockResolvedValue({}) };
    const adapter = new SmtpMailerAdapter(transport, 'no-reply@openlinker.local');

    await adapter.sendEmail({ to: 'a@b.com', subject: 'Hi', text: 'Body' });

    expect(transport.sendMail).toHaveBeenCalledWith({
      from: 'no-reply@openlinker.local',
      to: 'a@b.com',
      subject: 'Hi',
      text: 'Body',
      html: undefined,
    });
  });
});

describe('ConsoleMailerAdapter', () => {
  it('resolves without throwing (logs only)', async () => {
    const adapter = new ConsoleMailerAdapter();
    await expect(
      adapter.sendEmail({ to: 'a@b.com', subject: 'Hi', text: 'Body' }),
    ).resolves.toBeUndefined();
  });
});

describe('MailerPasswordResetNotifierAdapter', () => {
  const makeUser = (email: string | null): User =>
    new User('u-1', 'admin', email, 'hash', 'admin', 'active', new Date(), new Date());

  it('sends a reset email containing the tokenized link via the mailer', async () => {
    const mailer: jest.Mocked<MailerPort> = { sendEmail: jest.fn().mockResolvedValue(undefined) };
    const notifier = new MailerPasswordResetNotifierAdapter(
      mailer,
      makeConfig({ WEB_URL: 'https://app.example.com' }),
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

/**
 * Mailer infrastructure unit tests: the console + SMTP adapter contracts,
 * the DB-backed router adapter that resolves the effective transport per
 * send (#1643), and the password-reset notifier that composes MailerPort.
 */
import type { ConfigService } from '@nestjs/config';
import { User, type MailerPort } from '@openlinker/core/users';
import type { IMailerSettingsService } from '@openlinker/core/mailer';
import { ConsoleMailerAdapter } from './console-mailer.adapter';
import { SmtpMailerAdapter, type SmtpTransport } from './smtp-mailer.adapter';
import { MailerPasswordResetNotifierAdapter } from './mailer-password-reset-notifier.adapter';
import { DbBackedMailerAdapter } from './db-backed-mailer.adapter';

const sendMailMock = jest.fn().mockResolvedValue({});
const createTransportMock = jest.fn((..._args: unknown[]) => ({ sendMail: sendMailMock }));
jest.mock('nodemailer', () => ({
  createTransport: (...args: unknown[]) => createTransportMock(...args),
}));

function makeConfig(values: Record<string, string>): ConfigService {
  return {
    get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
  } as unknown as ConfigService;
}

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
      adapter.sendEmail({ to: 'a@b.com', subject: 'Hi', text: 'Body' })
    ).resolves.toBeUndefined();
  });
});

describe('DbBackedMailerAdapter', () => {
  const buildSettings = (
    resolved: Awaited<ReturnType<IMailerSettingsService['resolveTransportConfig']>>
  ): jest.Mocked<IMailerSettingsService> => ({
    getSettings: jest.fn(),
    updateSettings: jest.fn(),
    setSmtpPassword: jest.fn(),
    clearSmtpPassword: jest.fn(),
    resolveTransportConfig: jest.fn().mockResolvedValue(resolved),
  });

  beforeEach(() => {
    sendMailMock.mockClear();
    createTransportMock.mockClear();
  });

  it('sends via the console adapter when the resolved transport is console', async () => {
    const settings = buildSettings({
      transport: 'console',
      smtpHost: null,
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: null,
      smtpPassword: null,
      fromAddress: 'no-reply@openlinker.local',
    });
    const consoleSpy = jest.spyOn(ConsoleMailerAdapter.prototype, 'sendEmail');
    const adapter = new DbBackedMailerAdapter(settings);

    await adapter.sendEmail({ to: 'a@b.com', subject: 'Hi', text: 'Body' });

    expect(consoleSpy).toHaveBeenCalledWith({ to: 'a@b.com', subject: 'Hi', text: 'Body' });
    expect(createTransportMock).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('falls back to console when transport is smtp but no host is resolved (defensive)', async () => {
    const settings = buildSettings({
      transport: 'smtp',
      smtpHost: null,
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: null,
      smtpPassword: null,
      fromAddress: 'no-reply@openlinker.local',
    });
    const adapter = new DbBackedMailerAdapter(settings);

    await expect(
      adapter.sendEmail({ to: 'a@b.com', subject: 'Hi', text: 'Body' })
    ).resolves.toBeUndefined();
    expect(createTransportMock).not.toHaveBeenCalled();
  });

  it('builds an SMTP transporter from the resolved config and sends through it', async () => {
    const settings = buildSettings({
      transport: 'smtp',
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: 'user',
      smtpPassword: 'pass',
      fromAddress: 'no-reply@openlinker.local',
    });
    const adapter = new DbBackedMailerAdapter(settings);

    await adapter.sendEmail({ to: 'a@b.com', subject: 'Hi', text: 'Body' });

    expect(createTransportMock).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'user', pass: 'pass' },
    });
    expect(sendMailMock).toHaveBeenCalledWith({
      from: 'no-reply@openlinker.local',
      to: 'a@b.com',
      subject: 'Hi',
      text: 'Body',
      html: undefined,
    });
  });

  it('omits auth when no SMTP user is resolved', async () => {
    const settings = buildSettings({
      transport: 'smtp',
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: null,
      smtpPassword: null,
      fromAddress: 'no-reply@openlinker.local',
    });
    const adapter = new DbBackedMailerAdapter(settings);

    await adapter.sendEmail({ to: 'a@b.com', subject: 'Hi', text: 'Body' });

    expect(createTransportMock).toHaveBeenCalledWith(expect.objectContaining({ auth: undefined }));
  });
});

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

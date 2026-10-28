/**
 * Mailer adapter unit tests: the console + SMTP adapter contracts and the
 * DB-backed router adapter that resolves the effective transport per send
 * (#1643). Moved with the adapters into core by #3552.
 */
import type { IMailerSettingsService } from '../../application/services/mailer-settings.service.interface';
import { ConsoleMailerAdapter } from './console-mailer.adapter';
import { SmtpMailerAdapter, type SmtpTransport } from './smtp-mailer.adapter';
import { DbBackedMailerAdapter } from './db-backed-mailer.adapter';

const sendMailMock = jest.fn().mockResolvedValue({});
const createTransportMock = jest.fn((..._args: unknown[]) => ({ sendMail: sendMailMock }));
jest.mock('nodemailer', () => ({
  createTransport: (...args: unknown[]) => createTransportMock(...args),
}));

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

  it('forwards an HTML body alongside the plain-text fallback when present', async () => {
    const transport: jest.Mocked<SmtpTransport> = { sendMail: jest.fn().mockResolvedValue({}) };
    const adapter = new SmtpMailerAdapter(transport, 'no-reply@openlinker.local');

    await adapter.sendEmail({
      to: 'a@b.com',
      subject: 'Hi',
      text: 'Body',
      html: '<p>Body</p>',
    });

    expect(transport.sendMail).toHaveBeenCalledWith({
      from: 'no-reply@openlinker.local',
      to: 'a@b.com',
      subject: 'Hi',
      text: 'Body',
      html: '<p>Body</p>',
    });
  });
});

describe('SmtpMailerAdapter attachments (#3550)', () => {
  it('forwards attachments to the transport', async () => {
    const transport: jest.Mocked<SmtpTransport> = { sendMail: jest.fn().mockResolvedValue({}) };
    const adapter = new SmtpMailerAdapter(transport, 'no-reply@openlinker.local');
    const pdf = new Uint8Array([1, 2, 3]);

    await adapter.sendEmail({
      to: 'a@b.com',
      subject: 'Invoice',
      text: 'Attached',
      attachments: [{ filename: 'invoice.pdf', content: pdf, contentType: 'application/pdf' }],
    });

    expect(transport.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [{ filename: 'invoice.pdf', content: pdf, contentType: 'application/pdf' }],
      }),
    );
  });

  it('should not add an attachments key when there is nothing to attach', async () => {
    const transport: jest.Mocked<SmtpTransport> = { sendMail: jest.fn().mockResolvedValue({}) };
    const adapter = new SmtpMailerAdapter(transport, 'no-reply@openlinker.local');

    await adapter.sendEmail({ to: 'a@b.com', subject: 'Hi', text: 'Body', attachments: [] });

    expect(transport.sendMail.mock.calls[0][0]).not.toHaveProperty('attachments');
  });
});

describe('ConsoleMailerAdapter', () => {
  it('resolves without throwing (logs only)', async () => {
    const adapter = new ConsoleMailerAdapter();
    await expect(
      adapter.sendEmail({ to: 'a@b.com', subject: 'Hi', text: 'Body' })
    ).resolves.toBeUndefined();
  });

  it('resolves without throwing when an HTML body is present (ignored gracefully)', async () => {
    const adapter = new ConsoleMailerAdapter();
    await expect(
      adapter.sendEmail({ to: 'a@b.com', subject: 'Hi', text: 'Body', html: '<p>Body</p>' }),
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

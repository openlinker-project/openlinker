/**
 * MailerTransportModule (#3552)
 *
 * Both hosts import this module, so the binding they share must resolve to the
 * DB-backed adapter and must actually deliver through whatever transport the
 * settings service reports.
 */
import type { Provider } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MAILER_TOKEN, type MailerPort } from '@openlinker/core/users';
import { DbBackedMailerAdapter } from '../infrastructure/adapters/db-backed-mailer.adapter';
import { MailerTransportModule } from '../mailer-transport.module';
import { MAILER_SETTINGS_SERVICE_TOKEN } from '../mailer.tokens';

describe('MailerTransportModule binding', () => {
  it('should resolve MAILER_TOKEN to the DB-backed adapter that reads settings per send', async () => {
    const resolveTransportConfig = jest.fn().mockResolvedValue({
      transport: 'console',
      smtpHost: null,
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: null,
      smtpPassword: null,
      fromAddress: 'no-reply@openlinker.local',
    });

    // The module's own `imports` need a database, so its declared providers -
    // read off the real module, not restated here - are compiled against a
    // stubbed settings service.
    const declared = Reflect.getMetadata('providers', MailerTransportModule) as Provider[];
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: MAILER_SETTINGS_SERVICE_TOKEN, useValue: { resolveTransportConfig } },
        ...declared,
      ],
    }).compile();

    const mailer = moduleRef.get<MailerPort>(MAILER_TOKEN);
    await mailer.sendEmail({ to: 'a@b.com', subject: 'Hi', text: 'Body' });

    expect(mailer).toBeInstanceOf(DbBackedMailerAdapter);
    expect(resolveTransportConfig).toHaveBeenCalledTimes(1);
    expect(Reflect.getMetadata('exports', MailerTransportModule)).toEqual([MAILER_TOKEN]);
  });
});

/**
 * Mailer Settings Repository — Unit Tests
 *
 * Mocks the TypeORM repository so the spec is fast and independent of
 * Postgres. Pins: singleton-id upsert (`ON CONFLICT (id) DO UPDATE` via
 * `.upsert`), ORM ↔ domain mapping, and the defensive throw on an unknown
 * `transport` value read back from the row.
 *
 * @module libs/core/src/mailer/infrastructure/persistence/repositories
 */
import type { Repository } from 'typeorm';
import { MailerSettingsRepository } from './mailer-settings.repository';
import type { MailerSettingsOrmEntity } from '../entities/mailer-settings.orm-entity';

describe('MailerSettingsRepository', () => {
  let ormRepo: jest.Mocked<
    Pick<Repository<MailerSettingsOrmEntity>, 'findOne' | 'findOneOrFail' | 'upsert'>
  >;
  let subject: MailerSettingsRepository;

  const ormRow = (overrides: Partial<MailerSettingsOrmEntity> = {}): MailerSettingsOrmEntity => ({
    id: 'singleton',
    transport: 'smtp',
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpSecure: false,
    fromAddress: 'noreply@example.com',
    updatedAt: new Date('2026-05-01T00:00:00Z'),
    updatedBy: 'admin',
    ...overrides,
  });

  beforeEach(() => {
    ormRepo = {
      findOne: jest.fn(),
      findOneOrFail: jest.fn(),
      upsert: jest.fn(),
    };
    subject = new MailerSettingsRepository(
      ormRepo as unknown as Repository<MailerSettingsOrmEntity>
    );
  });

  describe('findSettings', () => {
    it('returns null when no row exists', async () => {
      ormRepo.findOne.mockResolvedValue(null);
      expect(await subject.findSettings()).toBeNull();
    });

    it('maps the row to the domain entity', async () => {
      ormRepo.findOne.mockResolvedValue(ormRow());

      const settings = await subject.findSettings();

      expect(settings).toMatchObject({
        transport: 'smtp',
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        smtpSecure: false,
        fromAddress: 'noreply@example.com',
        updatedBy: 'admin',
      });
      expect(ormRepo.findOne).toHaveBeenCalledWith({ where: { id: 'singleton' } });
    });

    it('throws when the persisted transport value is unrecognized', async () => {
      ormRepo.findOne.mockResolvedValue(ormRow({ transport: 'sendgrid' }));
      await expect(subject.findSettings()).rejects.toThrow(/unknown value/);
    });
  });

  describe('upsertSettings', () => {
    it('upserts on the singleton id and returns the saved row', async () => {
      ormRepo.upsert.mockResolvedValue({} as never);
      ormRepo.findOneOrFail.mockResolvedValue(ormRow({ transport: 'console', smtpHost: null }));

      const result = await subject.upsertSettings(
        {
          transport: 'console',
          smtpHost: null,
          smtpPort: null,
          smtpSecure: false,
          fromAddress: null,
        },
        'admin'
      );

      expect(ormRepo.upsert).toHaveBeenCalledWith(
        {
          id: 'singleton',
          transport: 'console',
          smtpHost: null,
          smtpPort: null,
          smtpSecure: false,
          fromAddress: null,
          updatedBy: 'admin',
        },
        { conflictPaths: ['id'] }
      );
      expect(result.transport).toBe('console');
    });
  });
});

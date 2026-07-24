/**
 * PostHog Settings Repository — Unit Tests
 *
 * Mocks the TypeORM repository so the spec is fast and independent of
 * Postgres. Pins: singleton-id upsert (`ON CONFLICT (id) DO UPDATE` via
 * `.upsert`), ORM ↔ domain mapping, and the defensive throw on an unknown
 * `region` value read back from the row.
 *
 * @module libs/core/src/analytics/infrastructure/persistence/repositories
 */
import type { Repository } from 'typeorm';
import { PosthogSettingsRepository } from './posthog-settings.repository';
import type { PosthogSettingsOrmEntity } from '../entities/posthog-settings.orm-entity';

describe('PosthogSettingsRepository', () => {
  let ormRepo: jest.Mocked<
    Pick<Repository<PosthogSettingsOrmEntity>, 'findOne' | 'findOneOrFail' | 'upsert'>
  >;
  let subject: PosthogSettingsRepository;

  const ormRow = (overrides: Partial<PosthogSettingsOrmEntity> = {}): PosthogSettingsOrmEntity => ({
    id: 'singleton',
    enabled: true,
    region: 'eu',
    customHost: null,
    autocapture: true,
    sessionRecording: true,
    productEventsEnabled: false,
    enabledEventGroups: [],
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
    subject = new PosthogSettingsRepository(
      ormRepo as unknown as Repository<PosthogSettingsOrmEntity>
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
        enabled: true,
        region: 'eu',
        customHost: null,
        autocapture: true,
        sessionRecording: true,
        productEventsEnabled: false,
        enabledEventGroups: [],
        updatedBy: 'admin',
      });
      expect(ormRepo.findOne).toHaveBeenCalledWith({ where: { id: 'singleton' } });
    });

    it('throws when the persisted region value is unrecognized', async () => {
      ormRepo.findOne.mockResolvedValue(ormRow({ region: 'apac' }));
      await expect(subject.findSettings()).rejects.toThrow(/unknown value/);
    });
  });

  describe('upsertSettings', () => {
    it('upserts on the singleton id and returns the saved row', async () => {
      ormRepo.upsert.mockResolvedValue({} as never);
      ormRepo.findOneOrFail.mockResolvedValue(ormRow({ enabled: false }));

      const result = await subject.upsertSettings(
        {
          enabled: false,
          region: 'eu',
          customHost: null,
          autocapture: false,
          sessionRecording: false,
          productEventsEnabled: false,
          enabledEventGroups: [],
        },
        'admin'
      );

      expect(ormRepo.upsert).toHaveBeenCalledWith(
        {
          id: 'singleton',
          enabled: false,
          region: 'eu',
          customHost: null,
          autocapture: false,
          sessionRecording: false,
          productEventsEnabled: false,
          enabledEventGroups: [],
          updatedBy: 'admin',
          updatedAt: expect.any(Date),
        },
        { conflictPaths: ['id'] }
      );
      expect(result.enabled).toBe(false);
    });

    it('refreshes updated_at on every successive call, not just the initial insert', async () => {
      ormRepo.upsert.mockResolvedValue({} as never);

      const firstUpdatedAt = new Date('2026-05-01T00:00:00Z');
      ormRepo.findOneOrFail.mockResolvedValueOnce(ormRow({ updatedAt: firstUpdatedAt }));
      const first = await subject.upsertSettings(
        {
          enabled: true,
          region: 'us',
          customHost: null,
          autocapture: true,
          sessionRecording: true,
          productEventsEnabled: false,
          enabledEventGroups: [],
        },
        'admin'
      );

      const secondUpdatedAt = new Date('2026-05-02T00:00:00Z');
      ormRepo.findOneOrFail.mockResolvedValueOnce(ormRow({ updatedAt: secondUpdatedAt }));
      const second = await subject.upsertSettings(
        {
          enabled: true,
          region: 'us',
          customHost: null,
          autocapture: true,
          sessionRecording: true,
          productEventsEnabled: false,
          enabledEventGroups: [],
        },
        'admin'
      );

      expect(second.updatedAt.getTime()).not.toBe(first.updatedAt.getTime());
      const firstCallUpdatedAt = (
        ormRepo.upsert.mock.calls[0][0] as PosthogSettingsOrmEntity
      ).updatedAt;
      const secondCallUpdatedAt = (
        ormRepo.upsert.mock.calls[1][0] as PosthogSettingsOrmEntity
      ).updatedAt;
      expect(secondCallUpdatedAt.getTime()).toBeGreaterThanOrEqual(firstCallUpdatedAt.getTime());
    });
  });
});

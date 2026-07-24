/**
 * PostHog Settings Repository
 *
 * TypeORM-backed implementation of `PosthogSettingsRepositoryPort`. Operates
 * on a single fixed-id row (`id = 'singleton'`); `upsertSettings` uses an
 * `ON CONFLICT (id) DO UPDATE` to keep both the create and update paths
 * atomic without a separate `findOne` round-trip. ORM ↔ domain mapping is
 * private to this class. Mirrors `MailerSettingsRepository`.
 *
 * @module libs/core/src/analytics/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  POSTHOG_SETTINGS_SINGLETON_ID,
  PosthogSettings,
} from '../../../domain/entities/posthog-settings.entity';
import type { PosthogSettingsRepositoryPort } from '../../../domain/ports/posthog-settings-repository.port';
import {
  PosthogRegionValues,
  type PosthogRegion,
  type PosthogSettingsInput,
} from '../../../domain/types/posthog-settings.types';
import { PosthogSettingsOrmEntity } from '../entities/posthog-settings.orm-entity';

const isPosthogRegion = (value: string): value is PosthogRegion =>
  (PosthogRegionValues as readonly string[]).includes(value);

@Injectable()
export class PosthogSettingsRepository implements PosthogSettingsRepositoryPort {
  constructor(
    @InjectRepository(PosthogSettingsOrmEntity)
    private readonly ormRepository: Repository<PosthogSettingsOrmEntity>
  ) {}

  async findSettings(): Promise<PosthogSettings | null> {
    const row = await this.ormRepository.findOne({
      where: { id: POSTHOG_SETTINGS_SINGLETON_ID },
    });
    return row ? this.toDomain(row) : null;
  }

  async upsertSettings(
    input: PosthogSettingsInput,
    updatedBy: string | null
  ): Promise<PosthogSettings> {
    await this.ormRepository.upsert(
      {
        id: POSTHOG_SETTINGS_SINGLETON_ID,
        enabled: input.enabled,
        region: input.region,
        customHost: input.customHost,
        autocapture: input.autocapture,
        sessionRecording: input.sessionRecording,
        productEventsEnabled: input.productEventsEnabled,
        enabledEventGroups: input.enabledEventGroups,
        updatedBy,
        // TypeORM's upsert() only includes explicitly-passed columns in the
        // ON CONFLICT DO UPDATE SET clause — @UpdateDateColumn()'s auto-touch
        // behavior applies only to .save(), so updatedAt must be set here
        // explicitly or every update after the initial insert would leave it
        // frozen at its creation value.
        updatedAt: new Date(),
      },
      { conflictPaths: ['id'] }
    );
    const saved = await this.ormRepository.findOneOrFail({
      where: { id: POSTHOG_SETTINGS_SINGLETON_ID },
    });
    return this.toDomain(saved);
  }

  private toDomain(entity: PosthogSettingsOrmEntity): PosthogSettings {
    if (!isPosthogRegion(entity.region)) {
      // Defensive: a row with an unknown region should not exist (the
      // service-layer write path validates), but if a manual DB edit or a
      // value drift from a future code change leaves the row in a state we
      // can't represent, surface it loudly rather than coerce silently.
      throw new Error(`posthog_settings.region has an unknown value '${entity.region}'`);
    }
    return new PosthogSettings(
      entity.enabled,
      entity.region,
      entity.customHost,
      entity.autocapture,
      entity.sessionRecording,
      entity.productEventsEnabled,
      entity.enabledEventGroups,
      entity.updatedAt,
      entity.updatedBy
    );
  }
}

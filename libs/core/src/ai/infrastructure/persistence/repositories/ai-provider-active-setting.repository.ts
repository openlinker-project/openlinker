/**
 * AI Provider Active Setting Repository
 *
 * TypeORM-backed implementation of `AiProviderActiveSettingRepositoryPort`.
 * Operates on a single fixed-id row (`id = 'singleton'`); `upsertActive`
 * uses an `ON CONFLICT (id) DO UPDATE` to keep both the create and update
 * paths atomic without a separate `findOne` round-trip. ORM ↔ domain
 * mapping is private to this class.
 *
 * @module libs/core/src/ai/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AI_PROVIDER_ACTIVE_SETTING_SINGLETON_ID, AiProviderActiveSetting } from '../../../domain/entities/ai-provider-active-setting.entity';
import type { AiProviderActiveSettingRepositoryPort } from '../../../domain/ports/ai-provider-active-setting-repository.port';
import { AiProviderValues, type AiProvider } from '../../../domain/types/ai-completion.types';
import { AiProviderActiveSettingOrmEntity } from '../entities/ai-provider-active-setting.orm-entity';

const isAiProvider = (value: string): value is AiProvider =>
  (AiProviderValues as readonly string[]).includes(value);

@Injectable()
export class AiProviderActiveSettingRepository
  implements AiProviderActiveSettingRepositoryPort
{
  constructor(
    @InjectRepository(AiProviderActiveSettingOrmEntity)
    private readonly ormRepository: Repository<AiProviderActiveSettingOrmEntity>,
  ) {}

  async findActive(): Promise<AiProviderActiveSetting | null> {
    const row = await this.ormRepository.findOne({
      where: { id: AI_PROVIDER_ACTIVE_SETTING_SINGLETON_ID },
    });
    return row ? this.toDomain(row) : null;
  }

  async upsertActive(
    activeProvider: AiProvider,
    updatedBy: string | null,
  ): Promise<AiProviderActiveSetting> {
    await this.ormRepository.upsert(
      {
        id: AI_PROVIDER_ACTIVE_SETTING_SINGLETON_ID,
        activeProvider,
        updatedBy,
      },
      { conflictPaths: ['id'] },
    );
    const saved = await this.ormRepository.findOneOrFail({
      where: { id: AI_PROVIDER_ACTIVE_SETTING_SINGLETON_ID },
    });
    return this.toDomain(saved);
  }

  private toDomain(entity: AiProviderActiveSettingOrmEntity): AiProviderActiveSetting {
    if (!isAiProvider(entity.activeProvider)) {
      // Defensive: a row with an unknown provider should not exist (the
      // service-layer write path validates), but if a manual DB edit or a
      // value drift from a future code change leaves the row in a state
      // we can't represent, surface it loudly rather than coerce silently.
      throw new Error(
        `ai_provider_active_setting.active_provider has an unknown value '${entity.activeProvider}'`,
      );
    }
    return new AiProviderActiveSetting(entity.activeProvider, entity.updatedAt, entity.updatedBy);
  }
}

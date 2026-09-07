/**
 * Analytics Display Settings Repository
 *
 * TypeORM-backed implementation of `AnalyticsDisplaySettingsRepositoryPort`.
 * Operates on a single fixed-id row (`id = 'singleton'`); `upsertSettings`
 * uses an `ON CONFLICT (id) DO UPDATE` to keep both the create and update
 * paths atomic without a separate `findOne` round-trip. ORM ↔ domain mapping
 * is private to this class. Mirrors `PosthogSettingsRepository` (same
 * context).
 *
 * @module libs/core/src/analytics/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ANALYTICS_DISPLAY_SETTINGS_SINGLETON_ID,
  AnalyticsDisplaySettings,
} from '../../../domain/entities/analytics-display-settings.entity';
import type { AnalyticsDisplaySettingsRepositoryPort } from '../../../domain/ports/analytics-display-settings-repository.port';
import {
  NetGrossBasisValues,
  RateBasisValues,
  type AnalyticsDisplaySettingsInput,
  type NetGrossBasis,
  type RateBasis,
} from '../../../domain/types/analytics-display-settings.types';
import { AnalyticsDisplaySettingsOrmEntity } from '../entities/analytics-display-settings.orm-entity';

const isRateBasis = (value: string): value is RateBasis =>
  (RateBasisValues as readonly string[]).includes(value);

const isNetGrossBasis = (value: string): value is NetGrossBasis =>
  (NetGrossBasisValues as readonly string[]).includes(value);

@Injectable()
export class AnalyticsDisplaySettingsRepository implements AnalyticsDisplaySettingsRepositoryPort {
  constructor(
    @InjectRepository(AnalyticsDisplaySettingsOrmEntity)
    private readonly ormRepository: Repository<AnalyticsDisplaySettingsOrmEntity>
  ) {}

  async findSettings(): Promise<AnalyticsDisplaySettings | null> {
    const row = await this.ormRepository.findOne({
      where: { id: ANALYTICS_DISPLAY_SETTINGS_SINGLETON_ID },
    });
    return row ? this.toDomain(row) : null;
  }

  async upsertSettings(
    input: AnalyticsDisplaySettingsInput,
    updatedByUserId: string | null
  ): Promise<AnalyticsDisplaySettings> {
    await this.ormRepository.upsert(
      {
        id: ANALYTICS_DISPLAY_SETTINGS_SINGLETON_ID,
        displayCurrency: input.displayCurrency,
        rateBasis: input.rateBasis,
        includeBackfilledTaxRatesInNetSales: input.includeBackfilledTaxRatesInNetSales,
        netGrossBasis: input.netGrossBasis,
        updatedByUserId,
        // TypeORM's upsert() only includes explicitly-passed columns in the
        // ON CONFLICT DO UPDATE SET clause — @UpdateDateColumn()'s auto-touch
        // behavior applies only to .save(), so updatedAt must be set here
        // explicitly or every update after the initial insert would leave it
        // frozen at its creation value (same fix as `PosthogSettingsRepository`).
        updatedAt: new Date(),
      },
      { conflictPaths: ['id'] }
    );
    const saved = await this.ormRepository.findOneOrFail({
      where: { id: ANALYTICS_DISPLAY_SETTINGS_SINGLETON_ID },
    });
    return this.toDomain(saved);
  }

  private toDomain(entity: AnalyticsDisplaySettingsOrmEntity): AnalyticsDisplaySettings {
    if (!isRateBasis(entity.rateBasis)) {
      // Defensive: a row with an unknown rate basis should not exist (the
      // service-layer write path validates via the DTO), but if a manual DB
      // edit or a value drift from a future code change leaves the row in a
      // state we can't represent, surface it loudly rather than coerce
      // silently — same posture as `PosthogSettingsRepository.toDomain`.
      throw new Error(`analytics_display_settings.rate_basis has an unknown value '${entity.rateBasis}'`);
    }
    if (!isNetGrossBasis(entity.netGrossBasis)) {
      throw new Error(
        `analytics_display_settings.net_gross_basis has an unknown value '${entity.netGrossBasis}'`
      );
    }
    return new AnalyticsDisplaySettings(
      entity.displayCurrency,
      entity.rateBasis,
      entity.includeBackfilledTaxRatesInNetSales,
      entity.netGrossBasis,
      entity.updatedAt,
      entity.updatedByUserId
    );
  }
}

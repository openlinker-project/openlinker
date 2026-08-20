/**
 * Reporting Currency Setting Repository
 *
 * TypeORM-backed implementation of `ReportingCurrencySettingRepositoryPort`.
 * Operates on a single fixed-id row (`id = 'singleton'`); `upsertSetting` uses
 * an `ON CONFLICT (id) DO UPDATE` so create and update are one atomic
 * statement without a separate `findOne` round-trip. Copied from
 * `AiProviderActiveSettingRepository`, which is the established shape for
 * every singleton settings table in the repo.
 *
 * @module libs/core/src/currency/infrastructure/persistence/repositories
 * @implements {ReportingCurrencySettingRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  REPORTING_CURRENCY_SETTING_SINGLETON_ID,
  ReportingCurrencySetting,
} from '../../../domain/entities/reporting-currency-setting.entity';
import type { ReportingCurrencySettingRepositoryPort } from '../../../domain/ports/reporting-currency-setting-repository.port';
import { ReportingCurrencySettingOrmEntity } from '../entities/reporting-currency-setting.orm-entity';

@Injectable()
export class ReportingCurrencySettingRepository implements ReportingCurrencySettingRepositoryPort {
  constructor(
    @InjectRepository(ReportingCurrencySettingOrmEntity)
    private readonly ormRepository: Repository<ReportingCurrencySettingOrmEntity>
  ) {}

  async findSetting(): Promise<ReportingCurrencySetting | null> {
    const row = await this.ormRepository.findOne({
      where: { id: REPORTING_CURRENCY_SETTING_SINGLETON_ID },
    });
    return row ? this.toDomain(row) : null;
  }

  async upsertSetting(
    reportingCurrency: string,
    updatedBy: string | null
  ): Promise<ReportingCurrencySetting> {
    await this.ormRepository.upsert(
      {
        id: REPORTING_CURRENCY_SETTING_SINGLETON_ID,
        reportingCurrency,
        updatedBy,
      },
      { conflictPaths: ['id'] }
    );
    const saved = await this.ormRepository.findOneOrFail({
      where: { id: REPORTING_CURRENCY_SETTING_SINGLETON_ID },
    });
    return this.toDomain(saved);
  }

  private toDomain(entity: ReportingCurrencySettingOrmEntity): ReportingCurrencySetting {
    // Deliberately NOT narrowed to `SupportedReportingCurrency` here. The
    // supported set is validated on the write path and is a function of which
    // providers are registered, so it can legitimately shrink between the day
    // a row was written and the day it is read. Throwing on the read would
    // turn a policy change into a boot failure; the service reports the stored
    // value with its provenance and lets the operator re-choose.
    return new ReportingCurrencySetting(entity.reportingCurrency, entity.updatedAt, entity.updatedBy);
  }
}

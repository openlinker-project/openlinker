/**
 * Operational Settings Repository
 *
 * TypeORM-backed implementation of `OperationalSettingsRepositoryPort`.
 * Operates on a single fixed-id row (`id = 'singleton'`), with
 * `ON CONFLICT (id) DO UPDATE` so create and update are one atomic statement -
 * the shape every singleton settings table in the repo already uses
 * (`AiProviderActiveSettingRepository`, `PosthogSettingsRepository`).
 *
 * One deviation from those, forced by this table's shape: the update is
 * PARTIAL. Their inputs carry every column, so passing the whole object is
 * correct; here an omitted field must be left as it was while an explicit
 * `null` must clear it. `TypeORM.upsert` only writes the keys it is given, so
 * the payload is assembled key by key from what the input actually mentions -
 * spreading the input wholesale would write `undefined` into the SET list and
 * clear a value the caller never named.
 *
 * @module libs/core/src/operational-settings/infrastructure/persistence/repositories
 * @implements {OperationalSettingsRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  OPERATIONAL_SETTINGS_SINGLETON_ID,
  OperationalSettings,
} from '../../../domain/entities/operational-settings.entity';
import type { OperationalSettingsRepositoryPort } from '../../../domain/ports/operational-settings-repository.port';
import type { OperationalSettingsInput } from '../../../domain/types/operational-settings.types';
import { OperationalSettingsOrmEntity } from '../entities/operational-settings.orm-entity';

@Injectable()
export class OperationalSettingsRepository implements OperationalSettingsRepositoryPort {
  constructor(
    @InjectRepository(OperationalSettingsOrmEntity)
    private readonly ormRepository: Repository<OperationalSettingsOrmEntity>
  ) {}

  async findSettings(): Promise<OperationalSettings | null> {
    const row = await this.ormRepository.findOne({
      where: { id: OPERATIONAL_SETTINGS_SINGLETON_ID },
    });
    return row ? this.toDomain(row) : null;
  }

  async upsertSettings(
    input: OperationalSettingsInput,
    updatedBy: string | null
  ): Promise<OperationalSettings> {
    const payload: Partial<OperationalSettingsOrmEntity> & { id: string } = {
      id: OPERATIONAL_SETTINGS_SINGLETON_ID,
      updatedBy,
      // `@UpdateDateColumn`'s auto-touch applies to `.save()` only, so an
      // upsert that omits it leaves the stamp frozen at insert time.
      updatedAt: new Date(),
    };

    if (input.catalogueSweepBudget !== undefined) {
      payload.catalogueSweepBudget = input.catalogueSweepBudget;
    }
    if (input.inventorySweepBudget !== undefined) {
      payload.inventorySweepBudget = input.inventorySweepBudget;
    }
    if (input.sweepPageSize !== undefined) {
      payload.sweepPageSize = input.sweepPageSize;
    }
    if (input.deletionAuditBudget !== undefined) {
      payload.deletionAuditBudget = input.deletionAuditBudget;
    }
    if (input.deletionAuditCadence !== undefined) {
      payload.deletionAuditCadence = input.deletionAuditCadence;
    }

    await this.ormRepository.upsert(payload, { conflictPaths: ['id'] });

    const saved = await this.ormRepository.findOneOrFail({
      where: { id: OPERATIONAL_SETTINGS_SINGLETON_ID },
    });
    return this.toDomain(saved);
  }

  /**
   * Deliberately does NOT throw on an out-of-range stored number, unlike
   * `AiProviderActiveSettingRepository.toDomain`. A budget is a scalar with a
   * safe clamp, not a closed union with no representable fallback, and the
   * service clamps on the way out - so a row edited straight in the database
   * degrades to a bounded value rather than taking the sweep down.
   */
  private toDomain(entity: OperationalSettingsOrmEntity): OperationalSettings {
    return new OperationalSettings(
      entity.catalogueSweepBudget,
      entity.inventorySweepBudget,
      entity.sweepPageSize,
      entity.deletionAuditBudget,
      entity.deletionAuditCadence,
      entity.updatedAt,
      entity.updatedBy
    );
  }
}

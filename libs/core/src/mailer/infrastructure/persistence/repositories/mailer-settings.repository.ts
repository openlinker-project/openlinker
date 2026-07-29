/**
 * Mailer Settings Repository
 *
 * TypeORM-backed implementation of `MailerSettingsRepositoryPort`. Operates
 * on a single fixed-id row (`id = 'singleton'`); `upsertSettings` uses an
 * `ON CONFLICT (id) DO UPDATE` to keep both the create and update paths
 * atomic without a separate `findOne` round-trip. ORM ↔ domain mapping is
 * private to this class. Mirrors `AiProviderActiveSettingRepository`.
 *
 * @module libs/core/src/mailer/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  MAILER_SETTINGS_SINGLETON_ID,
  MailerSettings,
} from '../../../domain/entities/mailer-settings.entity';
import type { MailerSettingsRepositoryPort } from '../../../domain/ports/mailer-settings-repository.port';
import {
  MailerTransportValues,
  type MailerSettingsInput,
  type MailerTransport,
} from '../../../domain/types/mailer-settings.types';
import { MailerSettingsOrmEntity } from '../entities/mailer-settings.orm-entity';

const isMailerTransport = (value: string): value is MailerTransport =>
  (MailerTransportValues as readonly string[]).includes(value);

@Injectable()
export class MailerSettingsRepository implements MailerSettingsRepositoryPort {
  constructor(
    @InjectRepository(MailerSettingsOrmEntity)
    private readonly ormRepository: Repository<MailerSettingsOrmEntity>
  ) {}

  async findSettings(): Promise<MailerSettings | null> {
    const row = await this.ormRepository.findOne({
      where: { id: MAILER_SETTINGS_SINGLETON_ID },
    });
    return row ? this.toDomain(row) : null;
  }

  async upsertSettings(
    input: MailerSettingsInput,
    updatedBy: string | null
  ): Promise<MailerSettings> {
    await this.ormRepository.upsert(
      {
        id: MAILER_SETTINGS_SINGLETON_ID,
        transport: input.transport,
        smtpHost: input.smtpHost,
        smtpPort: input.smtpPort,
        smtpSecure: input.smtpSecure,
        fromAddress: input.fromAddress,
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
      where: { id: MAILER_SETTINGS_SINGLETON_ID },
    });
    return this.toDomain(saved);
  }

  private toDomain(entity: MailerSettingsOrmEntity): MailerSettings {
    if (!isMailerTransport(entity.transport)) {
      // Defensive: a row with an unknown transport should not exist (the
      // service-layer write path validates), but if a manual DB edit or a
      // value drift from a future code change leaves the row in a state we
      // can't represent, surface it loudly rather than coerce silently.
      throw new Error(`mailer_settings.transport has an unknown value '${entity.transport}'`);
    }
    return new MailerSettings(
      entity.transport,
      entity.smtpHost,
      entity.smtpPort,
      entity.smtpSecure,
      entity.fromAddress,
      entity.updatedAt,
      entity.updatedBy
    );
  }
}

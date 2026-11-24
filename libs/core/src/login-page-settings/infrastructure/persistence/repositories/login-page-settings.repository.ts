/**
 * Login Page Settings Repository
 *
 * TypeORM implementation of the singleton login-page copy row.
 *
 * @module libs/core/src/login-page-settings/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  LOGIN_PAGE_SETTINGS_SINGLETON_ID,
  LoginPageSettings,
} from '../../../domain/entities/login-page-settings.entity';
import type { LoginPageSettingsRepositoryPort } from '../../../domain/ports/login-page-settings-repository.port';
import {
  readLoginPageCopy,
  type LoginPageCopyByLocale,
} from '../../../domain/types/login-page-settings.types';
import { LoginPageSettingsOrmEntity } from '../entities/login-page-settings.orm-entity';

@Injectable()
export class LoginPageSettingsRepository implements LoginPageSettingsRepositoryPort {
  constructor(
    @InjectRepository(LoginPageSettingsOrmEntity)
    private readonly ormRepository: Repository<LoginPageSettingsOrmEntity>
  ) {}

  async findSettings(): Promise<LoginPageSettings | null> {
    const row = await this.ormRepository.findOne({
      where: { id: LOGIN_PAGE_SETTINGS_SINGLETON_ID },
    });
    return row ? this.toDomain(row) : null;
  }

  async saveSettings(
    settings: { copy: LoginPageCopyByLocale; registrationEnabled: boolean | null },
    updatedBy: string | null
  ): Promise<LoginPageSettings> {
    await this.ormRepository.upsert(
      {
        id: LOGIN_PAGE_SETTINGS_SINGLETON_ID,
        copy: settings.copy,
        registrationEnabled: settings.registrationEnabled,
        updatedBy,
        // `@UpdateDateColumn` auto-touches on `.save()` only, not on upsert.
        updatedAt: new Date(),
      },
      { conflictPaths: ['id'] }
    );
    const saved = await this.ormRepository.findOneOrFail({
      where: { id: LOGIN_PAGE_SETTINGS_SINGLETON_ID },
    });
    return this.toDomain(saved);
  }

  private toDomain(row: LoginPageSettingsOrmEntity): LoginPageSettings {
    return new LoginPageSettings(
      readLoginPageCopy(row.copy),
      row.registrationEnabled,
      row.updatedAt,
      row.updatedBy
    );
  }
}

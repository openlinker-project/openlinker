/**
 * Operational Settings Module (core)
 *
 * NestJS module for the operational-settings context - a LEAF: it imports no
 * sibling core context and speaks no HTTP. Both hosts consume it: the api for
 * the admin surface, the worker so its sweep handlers and `SchedulerService`
 * read the resolved value per tick instead of a compile-time constant.
 *
 * Static `@Module`, never `forRoot` - the settings row is process-wide, and a
 * dynamic module would hand two importers two service instances reading the
 * same row through two `ConfigService` closures for no benefit.
 *
 * `TypeOrmModule.forFeature([...])` is mandatory rather than decorative:
 * runtime entity discovery is `autoLoadEntities: true`, so without it the
 * table never materialises in the `synchronize`-built dev/test schema.
 *
 * @module libs/core/src/operational-settings
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperationalSettingsService } from './application/services/operational-settings.service';
import { OperationalSettingsOrmEntity } from './infrastructure/persistence/entities/operational-settings.orm-entity';
import { OperationalSettingsRepository } from './infrastructure/persistence/repositories/operational-settings.repository';
import {
  OPERATIONAL_SETTINGS_REPOSITORY_TOKEN,
  OPERATIONAL_SETTINGS_SERVICE_TOKEN,
} from './operational-settings.tokens';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([OperationalSettingsOrmEntity])],
  providers: [
    OperationalSettingsRepository,
    { provide: OPERATIONAL_SETTINGS_REPOSITORY_TOKEN, useExisting: OperationalSettingsRepository },
    OperationalSettingsService,
    { provide: OPERATIONAL_SETTINGS_SERVICE_TOKEN, useExisting: OperationalSettingsService },
  ],
  exports: [OPERATIONAL_SETTINGS_REPOSITORY_TOKEN, OPERATIONAL_SETTINGS_SERVICE_TOKEN],
})
export class OperationalSettingsModule {}

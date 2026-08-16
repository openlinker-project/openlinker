/**
 * Fiscalization Module (core)
 *
 * NestJS module for the fiscalization bounded context. Wires the
 * `fiscal_registration_records` ORM entity into TypeORM, binds the repository to
 * its port token, and provides `FiscalRegistrationService`.
 *
 * No `FiscalizationPort` binding lives here: adapters are resolved per
 * connection through the integrations registry under the `'Fiscalization'`
 * capability, so `IntegrationsModule` is imported for the token the service
 * depends on. No cycle - integrations does not reference fiscalization.
 *
 * @module libs/core/src/fiscalization
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationsModule } from '@openlinker/core/integrations';

import { FiscalRegistrationService } from './application/services/fiscal-registration.service';
import { FiscalRegistrationRecordOrmEntity } from './infrastructure/persistence/entities/fiscal-registration-record.orm-entity';
import { FiscalRegistrationRecordRepository } from './infrastructure/persistence/repositories/fiscal-registration-record.repository';
import {
  FISCAL_REGISTRATION_RECORD_REPOSITORY_TOKEN,
  FISCAL_REGISTRATION_SERVICE_TOKEN,
} from './fiscalization.tokens';

// No token re-export here: `fiscalization.tokens.ts` plus the barrel's
// `export *` is the single publication path (engineering standards § Symbol DI
// Token Re-export Convention), so a new token cannot land on one surface and
// miss the other.

@Module({
  imports: [TypeOrmModule.forFeature([FiscalRegistrationRecordOrmEntity]), IntegrationsModule],
  providers: [
    FiscalRegistrationRecordRepository,
    {
      provide: FISCAL_REGISTRATION_RECORD_REPOSITORY_TOKEN,
      useExisting: FiscalRegistrationRecordRepository,
    },
    FiscalRegistrationService,
    {
      provide: FISCAL_REGISTRATION_SERVICE_TOKEN,
      useExisting: FiscalRegistrationService,
    },
  ],
  exports: [FISCAL_REGISTRATION_RECORD_REPOSITORY_TOKEN, FISCAL_REGISTRATION_SERVICE_TOKEN],
})
export class FiscalizationModule {}

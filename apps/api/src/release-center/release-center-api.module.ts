/**
 * Release Center API Module
 *
 * Mounts `/release-state`. Imports core's modules (never an api wrapper that
 * exports nothing) plus the host IntegrationsModule, which supplies
 * `CONNECTION_SERVICE_TOKEN`.
 *
 * @module apps/api/src/release-center
 */
import { Module } from '@nestjs/common';
import { OperationalSettingsModule as CoreOperationalSettingsModule } from '@openlinker/core/operational-settings';
import { ReleaseCenterModule } from '@openlinker/core/release-center';
import { IntegrationsModule } from '../integrations/integrations.module';
import { ReleaseStateController } from './http/release-state.controller';
import { ReleaseStateViewService } from './release-state-view.service';
import { RELEASE_STATE_VIEW_SERVICE_TOKEN } from './release-state-view.service.interface';

@Module({
  imports: [IntegrationsModule, CoreOperationalSettingsModule, ReleaseCenterModule],
  controllers: [ReleaseStateController],
  providers: [
    ReleaseStateViewService,
    { provide: RELEASE_STATE_VIEW_SERVICE_TOKEN, useExisting: ReleaseStateViewService },
  ],
})
export class ReleaseCenterApiModule {}

/**
 * Catalog Trust Module
 *
 * NestJS module for the per-connection catalog-trust read (#2258). Composes
 * the integrations and sync contexts via their published cross-context seams
 * (IIntegrationsService, ISyncCursorsService, ISyncJobsService) — no
 * persistence of its own. Mirrors AnalyticsTrustModule (#1982).
 *
 * @module libs/core/src/catalog-trust
 */
import { Module } from '@nestjs/common';
import { IntegrationsModule } from '@openlinker/core/integrations';
import { SyncModule } from '@openlinker/core/sync';
import { CatalogTrustService } from './application/services/catalog-trust.service';
import { CATALOG_TRUST_SERVICE_TOKEN } from './catalog-trust.tokens';

@Module({
  imports: [IntegrationsModule, SyncModule],
  providers: [
    CatalogTrustService,
    {
      provide: CATALOG_TRUST_SERVICE_TOKEN,
      useExisting: CatalogTrustService,
    },
  ],
  exports: [CATALOG_TRUST_SERVICE_TOKEN],
})
export class CatalogTrustModule {}

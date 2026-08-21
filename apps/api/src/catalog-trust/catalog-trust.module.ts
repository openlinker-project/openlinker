/**
 * Catalog Trust API Module
 *
 * REST surface for the per-connection catalog-trust read (#2258). A sibling
 * of AnalyticsTrustApiModule — same composition shape over a core context
 * that owns no persistence.
 *
 * @module apps/api/src/catalog-trust
 */
import { Module } from '@nestjs/common';
import { CatalogTrustModule as CoreCatalogTrustModule } from '@openlinker/core/catalog-trust';
import { CatalogTrustController } from './http/catalog-trust.controller';

@Module({
  imports: [CoreCatalogTrustModule],
  controllers: [CatalogTrustController],
})
export class CatalogTrustApiModule {}

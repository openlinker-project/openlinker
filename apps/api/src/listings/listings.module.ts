/**
 * Listings API Module
 *
 * NestJS module for listings/offer mapping read API endpoints. Imports core
 * listings module and registers the listings controller.
 *
 * @module apps/api/src/listings
 */
import { Module } from '@nestjs/common';
import { ListingsModule as CoreListingsModule } from '@openlinker/core/listings/services';
import { SyncModule as CoreSyncModule } from '@openlinker/core/sync';
import { ListingsController } from './http/listings.controller';

@Module({
  imports: [CoreListingsModule, CoreSyncModule],
  controllers: [ListingsController],
})
export class ListingsApiModule {}

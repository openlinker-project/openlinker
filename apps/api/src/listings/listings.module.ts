/**
 * Listings API Module
 *
 * NestJS module for listings/offer mapping read API endpoints. Imports core
 * listings module and registers the listings controller.
 *
 * @module apps/api/src/listings
 */
import { Module } from '@nestjs/common';
import { ListingsModule as CoreListingsModule } from '@openlinker/core/listings';
import { ListingsController } from './http/listings.controller';

@Module({
  imports: [CoreListingsModule],
  controllers: [ListingsController],
})
export class ListingsApiModule {}

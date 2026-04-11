/**
 * Categories Module
 *
 * NestJS module for Allegro category caching. Registers the cache
 * ORM entity and service for use by the mappings controller.
 *
 * @module apps/api/src/categories
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AllegroCategoryCacheOrmEntity } from './persistence/allegro-category-cache.orm-entity';
import { CategoriesCacheService } from './categories-cache.service';
import { CATEGORIES_CACHE_SERVICE_TOKEN } from './categories.tokens';
import { IntegrationsModule } from '@openlinker/core/integrations';

@Module({
  imports: [
    TypeOrmModule.forFeature([AllegroCategoryCacheOrmEntity]),
    IntegrationsModule,
  ],
  providers: [
    CategoriesCacheService,
    {
      provide: CATEGORIES_CACHE_SERVICE_TOKEN,
      useExisting: CategoriesCacheService,
    },
  ],
  exports: [CATEGORIES_CACHE_SERVICE_TOKEN],
})
export class CategoriesModule {}

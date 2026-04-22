/**
 * Categories Cache Service
 *
 * Fetches Allegro categories via the OfferManagerPort adapter and caches
 * them in the allegro_category_cache DB table with a 24-hour TTL.
 * Falls back to live API call when cache is stale or missing.
 *
 * @module apps/api/src/categories
 * @implements {ICategoriesCacheService}
 */

import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ICategoriesCacheService, PrestashopCategoryDto } from './categories-cache.service.interface';
import { AllegroCategoryCacheOrmEntity } from './persistence/allegro-category-cache.orm-entity';
import { OfferManagerPort } from '@openlinker/core/listings';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type { OfferCategory } from '@openlinker/core/listings';
import type { ProductMasterPort } from '@openlinker/core/products';
import { Logger } from '@openlinker/shared/logging';

const CACHE_TTL_HOURS = 24;

@Injectable()
export class CategoriesCacheService implements ICategoriesCacheService {
  private readonly logger = new Logger(CategoriesCacheService.name);

  constructor(
    @InjectRepository(AllegroCategoryCacheOrmEntity)
    private readonly cacheRepo: Repository<AllegroCategoryCacheOrmEntity>,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
  ) {}

  async getAllegroCategories(connectionId: string, parentId?: string): Promise<OfferCategory[]> {
    // Check cache for this parent level
    const cached = await this.findCached(connectionId, parentId);
    if (cached.length > 0) {
      return cached.map((e) => this.toDomain(e));
    }

    // Cache miss or stale — fetch from Allegro API
    this.logger.debug(
      `Cache miss for Allegro categories (connection: ${connectionId}, parentId: ${parentId ?? 'root'}), fetching from API`,
    );

    const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      connectionId,
      'OfferManager',
    );

    if (!adapter.fetchCategories) {
      this.logger.warn(`Marketplace adapter for connection ${connectionId} does not support fetchCategories`);
      return [];
    }

    const categories = await adapter.fetchCategories(parentId);

    // Store in cache
    await this.storeInCache(connectionId, categories);

    return categories;
  }

  async getPrestashopCategories(connectionId: string): Promise<PrestashopCategoryDto[]> {
    this.logger.debug(`Fetching PrestaShop categories (connection: ${connectionId})`);

    const adapter = await this.integrationsService.getCapabilityAdapter<ProductMasterPort>(
      connectionId,
      'ProductMaster',
    );

    if (!adapter.getCategories) {
      this.logger.warn(`ProductMaster adapter for connection ${connectionId} does not support getCategories`);
      return [];
    }

    const categories = await adapter.getCategories();

    return categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      parentId: cat.parentId ?? null,
      depth: cat.depth ?? 0,
      active: cat.active !== false,
    }));
  }

  async invalidateCache(connectionId: string): Promise<void> {
    await this.cacheRepo.delete({ connectionId });
    this.logger.debug(`Invalidated Allegro category cache for connection: ${connectionId}`);
  }

  private async findCached(
    connectionId: string,
    parentId?: string,
  ): Promise<AllegroCategoryCacheOrmEntity[]> {
    const staleThreshold = new Date();
    staleThreshold.setHours(staleThreshold.getHours() - CACHE_TTL_HOURS);

    // Query for cached entries that are not stale
    const where: Record<string, unknown> = {
      connectionId,
      parentId: parentId ?? null,
    };

    const entities = await this.cacheRepo.find({ where: where });

    // If any entry is stale, treat entire set as stale
    if (entities.length > 0 && entities.some((e) => e.fetchedAt < staleThreshold)) {
      // Clean up stale entries for this parent level
      await this.cacheRepo.delete(where);
      return [];
    }

    return entities;
  }

  private async storeInCache(
    connectionId: string,
    categories: OfferCategory[],
  ): Promise<void> {
    if (categories.length === 0) {
      return;
    }

    const now = new Date();
    const entities = categories.map((cat) => {
      const entity = new AllegroCategoryCacheOrmEntity();
      entity.connectionId = connectionId;
      entity.allegroCategoryId = cat.id;
      entity.name = cat.name;
      entity.parentId = cat.parentId;
      entity.leaf = cat.leaf;
      entity.fetchedAt = now;
      return entity;
    });

    // Upsert to handle re-fetches without duplicates
    await this.cacheRepo.upsert(entities, ['connectionId', 'allegroCategoryId']);
  }

  private toDomain(entity: AllegroCategoryCacheOrmEntity): OfferCategory {
    return {
      id: entity.allegroCategoryId,
      name: entity.name,
      parentId: entity.parentId,
      leaf: entity.leaf,
    };
  }
}

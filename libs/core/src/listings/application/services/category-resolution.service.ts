/**
 * Category Resolution Service
 *
 * Resolves the marketplace category for an offer using a 3-step fallback chain:
 * 1. Auto-detect via GTIN/EAN barcode (marketplace catalog lookup)
 * 2. Category mapping fallback (configured source → marketplace mappings)
 * 3. Manual pick (returns null for the merchant to choose)
 *
 * @module libs/core/src/listings/application/services
 * @implements {ICategoryResolutionService}
 */

import { Injectable, Inject } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import type { OfferManagerPort } from '@openlinker/core/listings';
import { isCategoryBarcodeMatcher } from '@openlinker/core/listings';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { IMappingConfigService, MAPPING_CONFIG_SERVICE_TOKEN } from '@openlinker/core/mappings';
import type { ICategoryResolutionService } from '../interfaces/category-resolution.service.interface';
import type {
  CategoryResolutionInput,
  CategoryResolutionResult,
} from '../types/category-resolution.types';

@Injectable()
export class CategoryResolutionService implements ICategoryResolutionService {
  private readonly logger = new Logger(CategoryResolutionService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(MAPPING_CONFIG_SERVICE_TOKEN)
    private readonly mappingConfig: IMappingConfigService
  ) {}

  async resolveCategory(input: CategoryResolutionInput): Promise<CategoryResolutionResult> {
    const { connectionId, barcode, sourceCategoryIds } = input;

    // Step 1: Auto-detect via barcode
    if (barcode) {
      const autoDetected = await this.tryAutoDetect(connectionId, barcode);
      if (autoDetected) {
        this.logger.debug(
          `Category resolved via auto_detect (connection=${connectionId}, barcode=${barcode}, categoryId=${autoDetected})`
        );
        return { allegroCategoryId: autoDetected, method: 'auto_detect' };
      }
    }

    // Step 2: Category mapping fallback
    if (sourceCategoryIds && sourceCategoryIds.length > 0) {
      const mapped = await this.tryCategoryMapping(connectionId, sourceCategoryIds);
      if (mapped) {
        this.logger.debug(
          `Category resolved via category_mapping (connection=${connectionId}, categoryId=${mapped})`
        );
        return { allegroCategoryId: mapped, method: 'category_mapping' };
      }
    }

    // Step 3: Manual pick
    this.logger.debug(`Category unresolved, manual pick required (connection=${connectionId})`);
    return { allegroCategoryId: null, method: 'manual' };
  }

  private async tryAutoDetect(connectionId: string, barcode: string): Promise<string | null> {
    try {
      const marketplace = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
        connectionId,
        'OfferManager'
      );
      if (!isCategoryBarcodeMatcher(marketplace)) {
        this.logger.debug(
          `Marketplace adapter does not support matchCategoryByBarcode (connection=${connectionId})`
        );
        return null;
      }
      return await marketplace.matchCategoryByBarcode(barcode);
    } catch (error) {
      this.logger.warn(
        `Auto-detect category failed (connection=${connectionId}): ${(error as Error).message}`
      );
      return null;
    }
  }

  private async tryCategoryMapping(
    connectionId: string,
    sourceCategoryIds: string[]
  ): Promise<string | null> {
    for (const categoryId of sourceCategoryIds) {
      const resolved = await this.mappingConfig.resolveAllegroCategory(connectionId, categoryId);
      if (resolved) {
        return resolved;
      }
    }
    return null;
  }
}

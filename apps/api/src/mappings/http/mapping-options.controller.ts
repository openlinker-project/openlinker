/**
 * Mapping Options Controller (#472 / #473 / #474)
 *
 * Capability-scoped routes for the carrier-mapping UI dropdowns. Each handler
 * resolves the platform adapter via `IIntegrationsService.getCapabilityAdapter`,
 * narrows it through the appropriate type guard
 * (`isDestinationOptionsReader` / `isSourceOptionsReader`), and returns the
 * live `MappingOption[]` list. Adapters that don't implement the relevant
 * sub-capability cause a `501 Not Implemented`; FE renders an empty dropdown
 * with a clear message.
 *
 * Replaces the eight legacy platform-prefixed routes (`allegro/*`,
 * `prestashop/*`) and the seven hardcoded option constants. The routes drop
 * the platform prefix from the URL because `connectionId` already
 * disambiguates the platform via `ConnectionService`.
 *
 * Categories endpoints continue to use `categoriesCacheService` directly —
 * they're already live-data and the cache is the right architecture for
 * tree-structured taxonomies; only the URL changed.
 *
 * @module apps/api/src/mappings/http
 */

import { Controller, Get, Param, Query, Inject, NotImplementedException } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import {
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
} from '@openlinker/core/integrations';
import {
  isDestinationOptionsReader,
  isSourceOptionsReader,
  type DestinationOptionsReader,
  type OrderProcessorManagerPort,
  type OrderSourcePort,
  type SourceOptionsReader,
} from '@openlinker/core/orders';

import { Roles } from '../../auth/decorators/roles.decorator';
import { MappingOptionResponseDto } from './dto/mapping-option-response.dto';
import { AllegroCategoryResponseDto } from './dto/allegro-category-response.dto';
import { ICategoriesCacheService } from '../../categories/categories-cache.service.interface';
import { CATEGORIES_CACHE_SERVICE_TOKEN } from '../../categories/categories.tokens';

@Roles('admin')
@ApiBearerAuth()
@ApiTags('mappings')
@Controller('connections/:connectionId/mappings/options')
export class MappingOptionsController {
  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(CATEGORIES_CACHE_SERVICE_TOKEN)
    private readonly categoriesCacheService: ICategoriesCacheService,
  ) {}

  // ── Destination side (e.g. PrestaShop OrderProcessorManager) ────────────

  @Get('destination/carriers')
  @ApiOperation({ summary: 'List destination-platform carriers (live)' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [MappingOptionResponseDto] })
  @ApiResponse({ status: 501, description: 'Adapter does not implement DestinationOptionsReader' })
  async getDestinationCarriers(
    @Param('connectionId') connectionId: string,
  ): Promise<MappingOptionResponseDto[]> {
    return this.resolveDestinationOptions(connectionId, 'listCarriers');
  }

  @Get('destination/order-statuses')
  @ApiOperation({ summary: 'List destination-platform order statuses (live)' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [MappingOptionResponseDto] })
  @ApiResponse({ status: 501, description: 'Adapter does not implement DestinationOptionsReader' })
  async getDestinationOrderStatuses(
    @Param('connectionId') connectionId: string,
  ): Promise<MappingOptionResponseDto[]> {
    return this.resolveDestinationOptions(connectionId, 'listOrderStatuses');
  }

  @Get('destination/payment-methods')
  @ApiOperation({ summary: 'List destination-platform payment methods (live)' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [MappingOptionResponseDto] })
  @ApiResponse({ status: 501, description: 'Adapter does not implement DestinationOptionsReader' })
  async getDestinationPaymentMethods(
    @Param('connectionId') connectionId: string,
  ): Promise<MappingOptionResponseDto[]> {
    return this.resolveDestinationOptions(connectionId, 'listPaymentMethods');
  }

  // ── Source side (e.g. Allegro OrderSource) ──────────────────────────────

  @Get('source/order-statuses')
  @ApiOperation({ summary: 'List source-platform order statuses' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [MappingOptionResponseDto] })
  @ApiResponse({ status: 501, description: 'Adapter does not implement SourceOptionsReader' })
  async getSourceOrderStatuses(
    @Param('connectionId') connectionId: string,
  ): Promise<MappingOptionResponseDto[]> {
    return this.resolveSourceOptions(connectionId, 'listOrderStatuses');
  }

  @Get('source/delivery-methods')
  @ApiOperation({ summary: 'List source-platform delivery methods (carriers, with human labels)' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [MappingOptionResponseDto] })
  @ApiResponse({ status: 501, description: 'Adapter does not implement SourceOptionsReader' })
  async getSourceDeliveryMethods(
    @Param('connectionId') connectionId: string,
  ): Promise<MappingOptionResponseDto[]> {
    return this.resolveSourceOptions(connectionId, 'listDeliveryMethods');
  }

  @Get('source/payment-methods')
  @ApiOperation({ summary: 'List source-platform payment methods' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [MappingOptionResponseDto] })
  @ApiResponse({ status: 501, description: 'Adapter does not implement SourceOptionsReader' })
  async getSourcePaymentMethods(
    @Param('connectionId') connectionId: string,
  ): Promise<MappingOptionResponseDto[]> {
    return this.resolveSourceOptions(connectionId, 'listPaymentMethods');
  }

  // ── Categories (live, cached — different architecture from option lists) ─

  @Get('destination/categories')
  @ApiOperation({ summary: 'List destination-platform categories (live, cached)' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, description: 'Array of platform categories' })
  async getDestinationCategories(
    @Param('connectionId') connectionId: string,
  ): Promise<unknown[]> {
    return this.categoriesCacheService.getPrestashopCategories(connectionId);
  }

  @Get('source/categories')
  @ApiOperation({ summary: 'Browse source-platform category tree (cached, 24h TTL)' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiQuery({ name: 'parentId', required: false, type: String, description: 'Parent category ID (omit for root)' })
  @ApiResponse({ status: 200, type: [AllegroCategoryResponseDto] })
  async getSourceCategories(
    @Param('connectionId') connectionId: string,
    @Query('parentId') parentId?: string,
  ): Promise<AllegroCategoryResponseDto[]> {
    const categories = await this.categoriesCacheService.getAllegroCategories(connectionId, parentId);
    return categories.map((c) => AllegroCategoryResponseDto.fromDomain(c));
  }

  // ── Private helpers (#472 §5.5) ─────────────────────────────────────────

  /**
   * Resolves the destination adapter, narrows via `isDestinationOptionsReader`,
   * and invokes the named method. Centralises the resolve+narrow+invoke
   * pattern that would otherwise repeat across three near-identical handlers.
   */
  private async resolveDestinationOptions<K extends keyof DestinationOptionsReader>(
    connectionId: string,
    method: K,
  ): Promise<MappingOptionResponseDto[]> {
    const adapter = await this.integrationsService.getCapabilityAdapter<OrderProcessorManagerPort>(
      connectionId,
      'OrderProcessorManager',
    );
    if (!isDestinationOptionsReader(adapter)) {
      throw new NotImplementedException(
        `Adapter for connection ${connectionId} does not implement DestinationOptionsReader`,
      );
    }
    return adapter[method]();
  }

  /**
   * Source-side counterpart to `resolveDestinationOptions`. Same shape, but
   * resolves `OrderSourcePort` and narrows via `isSourceOptionsReader`.
   */
  private async resolveSourceOptions<K extends keyof SourceOptionsReader>(
    connectionId: string,
    method: K,
  ): Promise<MappingOptionResponseDto[]> {
    const adapter = await this.integrationsService.getCapabilityAdapter<OrderSourcePort>(
      connectionId,
      'OrderSource',
    );
    if (!isSourceOptionsReader(adapter)) {
      throw new NotImplementedException(
        `Adapter for connection ${connectionId} does not implement SourceOptionsReader`,
      );
    }
    return adapter[method]();
  }
}

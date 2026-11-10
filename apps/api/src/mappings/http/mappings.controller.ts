/**
 * Mappings Controller
 *
 * HTTP REST API endpoints for connection-scoped mapping configuration.
 * Supports CRUD for status, carrier, and payment mapping types.
 * Read (GET) endpoints allow admin/operator/viewer (#1652) so demo viewers
 * can inspect mapping configuration without a 403. Write endpoints
 * (PUT/DELETE) allow admin/operator (#1653) — mapping configuration is
 * routine operator work, matching operator's write access in sibling
 * controllers (listings, orders). The class-level @Roles('admin') stays as a
 * deny-by-default safety net for any future endpoint added without a
 * per-method override.
 *
 * @module apps/api/src/mappings/http
 */

import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { codedHttpError } from '../../common/errors/coded-http.exception';
import {
  CategoryMappingReassignSameConnectionException,
  IMappingConfigService,
  MAPPING_CONFIG_SERVICE_TOKEN,
} from '@openlinker/core/mappings';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { Logger } from '@openlinker/shared/logging';
import { UpsertStatusMappingsDto } from './dto/upsert-status-mappings.dto';
import { UpsertCarrierMappingsDto } from './dto/upsert-carrier-mappings.dto';
import { UpsertPaymentMappingsDto } from './dto/upsert-payment-mappings.dto';
import { UpsertOrderStateMappingsDto } from './dto/upsert-order-state-mappings.dto';
import { StatusMappingResponseDto } from './dto/status-mapping-response.dto';
import { CarrierMappingResponseDto } from './dto/carrier-mapping-response.dto';
import { PaymentMappingResponseDto } from './dto/payment-mapping-response.dto';
import { OrderStateMappingResponseDto } from './dto/order-state-mapping-response.dto';
import { CategoryMappingInputDto } from './dto/category-mapping-input.dto';
import { CategoryMappingResponseDto } from './dto/category-mapping-response.dto';
import { CategoryMappingQueryDto } from './dto/category-mapping-query.dto';
import {
  CategoryMappingReassignInputDto,
  CategoryMappingReassignResponseDto,
} from './dto/category-mapping-reassign.dto';

@Roles('admin')
@ApiBearerAuth()
@ApiTags('mappings')
@Controller('connections/:connectionId/mappings')
export class MappingsController {
  private readonly logger = new Logger(MappingsController.name);

  constructor(
    @Inject(MAPPING_CONFIG_SERVICE_TOKEN)
    private readonly mappingConfigService: IMappingConfigService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService
  ) {}

  // ── Status mappings ──────────────────────────────────────────────────────

  @Get('status')
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({ summary: 'Get status mappings for a connection' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [StatusMappingResponseDto] })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getStatusMappings(
    @Param('connectionId') connectionId: string
  ): Promise<StatusMappingResponseDto[]> {
    const mappings = await this.mappingConfigService.getStatusMappings(connectionId);
    return mappings.map((m) => StatusMappingResponseDto.fromDomain(m));
  }

  @Put('status')
  @Roles('admin', 'operator')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Replace all status mappings for a connection' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [StatusMappingResponseDto] })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async upsertStatusMappings(
    @Param('connectionId') connectionId: string,
    @Body() dto: UpsertStatusMappingsDto
  ): Promise<StatusMappingResponseDto[]> {
    const mappings = await this.mappingConfigService.upsertStatusMappings(connectionId, dto.items);
    return mappings.map((m) => StatusMappingResponseDto.fromDomain(m));
  }

  // ── Carrier mappings ─────────────────────────────────────────────────────

  @Get('carriers')
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({ summary: 'Get carrier mappings for a connection' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [CarrierMappingResponseDto] })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getCarrierMappings(
    @Param('connectionId') connectionId: string
  ): Promise<CarrierMappingResponseDto[]> {
    const mappings = await this.mappingConfigService.getCarrierMappings(connectionId);
    return mappings.map((m) => CarrierMappingResponseDto.fromDomain(m));
  }

  @Put('carriers')
  @Roles('admin', 'operator')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Replace all carrier mappings for a connection' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [CarrierMappingResponseDto] })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async upsertCarrierMappings(
    @Param('connectionId') connectionId: string,
    @Body() dto: UpsertCarrierMappingsDto
  ): Promise<CarrierMappingResponseDto[]> {
    const mappings = await this.mappingConfigService.upsertCarrierMappings(connectionId, dto.items);
    return mappings.map((m) => CarrierMappingResponseDto.fromDomain(m));
  }

  // ── Order-state mappings (outbound OL→destination, #862) ──────────────────

  @Get('order-states')
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({ summary: 'Get OL→destination order-state mappings for a connection' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [OrderStateMappingResponseDto] })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getOrderStateMappings(
    @Param('connectionId') connectionId: string
  ): Promise<OrderStateMappingResponseDto[]> {
    const mappings = await this.mappingConfigService.getOrderStateMappings(connectionId);
    return mappings.map((m) => OrderStateMappingResponseDto.fromDomain(m));
  }

  @Put('order-states')
  @Roles('admin', 'operator')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Replace all OL→destination order-state mappings for a connection' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [OrderStateMappingResponseDto] })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async upsertOrderStateMappings(
    @Param('connectionId') connectionId: string,
    @Body() dto: UpsertOrderStateMappingsDto
  ): Promise<OrderStateMappingResponseDto[]> {
    const mappings = await this.mappingConfigService.upsertOrderStateMappings(
      connectionId,
      dto.items
    );
    return mappings.map((m) => OrderStateMappingResponseDto.fromDomain(m));
  }

  // ── Payment mappings ─────────────────────────────────────────────────────

  @Get('payments')
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({ summary: 'Get payment mappings for a connection' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [PaymentMappingResponseDto] })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getPaymentMappings(
    @Param('connectionId') connectionId: string
  ): Promise<PaymentMappingResponseDto[]> {
    const mappings = await this.mappingConfigService.getPaymentMappings(connectionId);
    return mappings.map((m) => PaymentMappingResponseDto.fromDomain(m));
  }

  @Put('payments')
  @Roles('admin', 'operator')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Replace all payment mappings for a connection' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [PaymentMappingResponseDto] })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async upsertPaymentMappings(
    @Param('connectionId') connectionId: string,
    @Body() dto: UpsertPaymentMappingsDto
  ): Promise<PaymentMappingResponseDto[]> {
    const mappings = await this.mappingConfigService.upsertPaymentMappings(connectionId, dto.items);
    return mappings.map((m) => PaymentMappingResponseDto.fromDomain(m));
  }

  // ── Category mappings ───────────────────────────────────────────────────

  // The route connection is the MARKETPLACE a mapping is for, which is the key
  // offer creation resolves by. The master that owns the source category is
  // `sourceConnectionId` (#3993).

  @Get('categories')
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({ summary: 'Get category mappings for a marketplace connection' })
  @ApiParam({ name: 'connectionId', type: String, description: 'Marketplace connection ID' })
  @ApiResponse({ status: 200, type: [CategoryMappingResponseDto] })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getCategoryMappings(
    @Param('connectionId') connectionId: string,
    @Query() query: CategoryMappingQueryDto
  ): Promise<CategoryMappingResponseDto[]> {
    const mappings = await this.mappingConfigService.getCategoryMappings(
      connectionId,
      query.sourceConnectionId
    );
    return mappings.map((m) => CategoryMappingResponseDto.fromDomain(m));
  }

  @Post('categories/reassign')
  @Roles('admin', 'operator')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Move category mappings saved under another connection onto this marketplace',
    description:
      'Adopts mappings the Category Mappings page saved under the master connection before ' +
      '#3993, which offer creation never read. A category already mapped on this marketplace ' +
      'keeps its mapping.',
  })
  @ApiParam({ name: 'connectionId', type: String, description: 'Marketplace connection ID' })
  @ApiResponse({ status: 200, type: CategoryMappingReassignResponseDto })
  @ApiResponse({
    status: 400,
    description:
      'Invalid input, the same connection on both sides, or a route connection that is not a ' +
      'marketplace with its own category tree',
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async reassignCategoryMappings(
    @Param('connectionId') connectionId: string,
    @Body() dto: CategoryMappingReassignInputDto
  ): Promise<CategoryMappingReassignResponseDto> {
    await this.assertMappableMarketplace(connectionId);
    try {
      const result = await this.mappingConfigService.reassignCategoryMappings(
        dto.fromConnectionId,
        connectionId
      );
      return CategoryMappingReassignResponseDto.fromDomain(result);
    } catch (error) {
      if (error instanceof CategoryMappingReassignSameConnectionException) {
        throw codedHttpError(
          HttpStatus.BAD_REQUEST,
          'CATEGORY_MAPPING_REASSIGN_SAME_CONNECTION',
          error.message
        );
      }
      throw error;
    }
  }

  /**
   * Mappings are only read for a marketplace that lists offers and browses
   * its own category tree (the connections the Category Mappings page offers).
   * Moving rows onto anything else - a shop, a master - would store them where
   * nothing reads them, so it is refused with a reason rather than accepted.
   */
  private async assertMappableMarketplace(connectionId: string): Promise<void> {
    const { connection, metadata } = await this.integrationsService.getAdapter(connectionId);
    const listsOffers = connection.enabledCapabilities.includes('OfferManager');
    const hasCategoryTree = metadata.supportedCapabilities.includes('CategoryBrowser');
    if (!listsOffers || !hasCategoryTree) {
      throw codedHttpError(
        HttpStatus.BAD_REQUEST,
        'CATEGORY_MAPPING_TARGET_NOT_MARKETPLACE',
        `Connection '${connection.name}' is not a marketplace with its own category tree, so category mappings moved onto it would never be used. Choose a marketplace connection such as Allegro.`,
        { connectionId: connection.id, connectionName: connection.name }
      );
    }
  }

  @Put('categories/:prestashopCategoryId')
  @Roles('admin', 'operator')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create or update the mapping of one source category' })
  @ApiParam({ name: 'connectionId', type: String, description: 'Marketplace connection ID' })
  @ApiParam({ name: 'prestashopCategoryId', type: String, description: 'Source category ID' })
  @ApiResponse({ status: 200, type: CategoryMappingResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async upsertCategoryMapping(
    @Param('connectionId') connectionId: string,
    @Param('prestashopCategoryId') prestashopCategoryId: string,
    @Body() dto: CategoryMappingInputDto
  ): Promise<CategoryMappingResponseDto> {
    // #1036: the wire DTO keeps its Allegro/PS field names; the core input is neutral.
    if (dto.sourceConnectionId === undefined) {
      this.logger.warn(
        `Deprecated: category mapping written for connection ${connectionId} without sourceConnectionId. ` +
          'It is stored as a source-agnostic row; send sourceConnectionId (the master connection), ' +
          'which becomes required in the next release (#3993).'
      );
    }
    const mapping = await this.mappingConfigService.upsertCategoryMapping(connectionId, {
      sourceConnectionId: dto.sourceConnectionId,
      sourceCategoryId: prestashopCategoryId,
      destinationCategoryId: dto.allegroCategoryId,
      destinationCategoryName: dto.allegroCategoryName,
      destinationCategoryPath: dto.allegroCategoryPath,
    });
    return CategoryMappingResponseDto.fromDomain(mapping);
  }

  @Delete('categories/:prestashopCategoryId')
  @Roles('admin', 'operator')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete the mapping of one source category' })
  @ApiParam({ name: 'connectionId', type: String, description: 'Marketplace connection ID' })
  @ApiParam({ name: 'prestashopCategoryId', type: String, description: 'Source category ID' })
  @ApiResponse({ status: 204, description: 'Mapping deleted' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async deleteCategoryMapping(
    @Param('connectionId') connectionId: string,
    @Param('prestashopCategoryId') prestashopCategoryId: string,
    @Query() query: CategoryMappingQueryDto
  ): Promise<void> {
    await this.mappingConfigService.deleteCategoryMapping(
      connectionId,
      prestashopCategoryId,
      query.sourceConnectionId
    );
  }
}

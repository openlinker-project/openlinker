/**
 * Mappings Controller
 *
 * HTTP REST API endpoints for connection-scoped mapping configuration.
 * Supports CRUD for status, carrier, and payment mapping types.
 * All endpoints require admin role and JWT authentication.
 *
 * @module apps/api/src/mappings/http
 */

import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { IMappingConfigService, MAPPING_CONFIG_SERVICE_TOKEN } from '@openlinker/core/mappings';
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

@Roles('admin')
@ApiBearerAuth()
@ApiTags('mappings')
@Controller('connections/:connectionId/mappings')
export class MappingsController {
  constructor(
    @Inject(MAPPING_CONFIG_SERVICE_TOKEN)
    private readonly mappingConfigService: IMappingConfigService
  ) {}

  // ── Status mappings ──────────────────────────────────────────────────────

  @Get('status')
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

  @Get('categories')
  @ApiOperation({ summary: 'Get category mappings for a connection' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiResponse({ status: 200, type: [CategoryMappingResponseDto] })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getCategoryMappings(
    @Param('connectionId') connectionId: string
  ): Promise<CategoryMappingResponseDto[]> {
    const mappings = await this.mappingConfigService.getCategoryMappings(connectionId);
    return mappings.map((m) => CategoryMappingResponseDto.fromDomain(m));
  }

  @Put('categories/:prestashopCategoryId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create or update a category mapping for a PrestaShop category' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiParam({ name: 'prestashopCategoryId', type: String })
  @ApiResponse({ status: 200, type: CategoryMappingResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async upsertCategoryMapping(
    @Param('connectionId') connectionId: string,
    @Param('prestashopCategoryId') prestashopCategoryId: string,
    @Body() dto: CategoryMappingInputDto
  ): Promise<CategoryMappingResponseDto> {
    const mapping = await this.mappingConfigService.upsertCategoryMapping(connectionId, {
      prestashopCategoryId,
      allegroCategoryId: dto.allegroCategoryId,
      allegroCategoryName: dto.allegroCategoryName,
      allegroCategoryPath: dto.allegroCategoryPath,
    });
    return CategoryMappingResponseDto.fromDomain(mapping);
  }

  @Delete('categories/:prestashopCategoryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a category mapping for a PrestaShop category' })
  @ApiParam({ name: 'connectionId', type: String })
  @ApiParam({ name: 'prestashopCategoryId', type: String })
  @ApiResponse({ status: 204, description: 'Mapping deleted' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async deleteCategoryMapping(
    @Param('connectionId') connectionId: string,
    @Param('prestashopCategoryId') prestashopCategoryId: string
  ): Promise<void> {
    await this.mappingConfigService.deleteCategoryMapping(connectionId, prestashopCategoryId);
  }
}

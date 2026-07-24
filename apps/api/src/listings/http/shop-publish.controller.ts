/**
 * Shop Publish Controller (#1044)
 *
 * HTTP endpoints for single shop-product publish + per-record status polling.
 * Thin wrapper over `IProductPublishEnqueueService` (validate → enqueue → 202 +
 * ids) and `IListingCreationQueryService` (status read). The shop-side sibling
 * of the single-offer-create endpoint on `ListingsController`. Orchestration
 * lives in the core services per architecture-overview.md §7.
 *
 * @module apps/api/src/listings/http
 */
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import {
  IListingCreationQueryService,
  IProductPublishEnqueueService,
  IShopCategoryBrowseService,
  LISTING_CREATION_QUERY_SERVICE_TOKEN,
  PRODUCT_PUBLISH_ENQUEUE_SERVICE_TOKEN,
  SHOP_CATEGORY_BROWSE_SERVICE_TOKEN,
} from '@openlinker/core/listings';
import type { ListingCreationRecord } from '@openlinker/core/listings';

import { Roles } from '../../auth/decorators/roles.decorator';
import { PublishProductRequestDto } from './dto/publish-product.dto';
import {
  ListingCreationRecordResponseDto,
  ShopCategoryResponseDto,
  ShopPublishResponseDto,
} from './dto/shop-publish-response.dto';

@ApiBearerAuth()
@ApiTags('listings')
@Controller('listings/connections/:connectionId/shop-publish')
export class ShopPublishController {
  constructor(
    @Inject(PRODUCT_PUBLISH_ENQUEUE_SERVICE_TOKEN)
    private readonly enqueue: IProductPublishEnqueueService,
    @Inject(LISTING_CREATION_QUERY_SERVICE_TOKEN)
    private readonly query: IListingCreationQueryService,
    @Inject(SHOP_CATEGORY_BROWSE_SERVICE_TOKEN)
    private readonly categoryBrowse: IShopCategoryBrowseService,
  ) {}

  @Roles('admin', 'operator')
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Publish a product to a shop connection',
    description:
      'Validates the connection ProductPublisher capability, pre-creates a listing-creation record, and enqueues a shop.product.publish job. Returns the jobId + record id to poll.',
  })
  @ApiResponse({ status: 202, description: 'Publish enqueued', type: ShopPublishResponseDto })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  @ApiResponse({ status: 409, description: 'Connection disabled' })
  @ApiResponse({ status: 422, description: 'Adapter does not support ProductPublisher' })
  async publish(
    @Param('connectionId') connectionId: string,
    @Body() dto: PublishProductRequestDto,
    @Headers('x-idempotency-key') idempotencyKey?: string,
  ): Promise<ShopPublishResponseDto> {
    const { jobId, listingCreationRecord } = await this.enqueue.enqueuePublish({
      connectionId,
      internalVariantId: dto.internalVariantId,
      status: dto.status,
      stock: dto.stock,
      ...(dto.price !== undefined && { price: dto.price }),
      ...(dto.content !== undefined && { content: dto.content }),
      ...(dto.commerce !== undefined && { commerce: dto.commerce }),
      ...(idempotencyKey !== undefined && { idempotencyKey }),
    });
    return { jobId, listingCreationRecordId: listingCreationRecord.id };
  }

  @Get('categories')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Browse a shop connection\'s existing category tree',
    description:
      'Resolves the connection ProductPublisher adapter, narrows it to the ShopCategoryBrowser sub-capability, and returns the direct child categories under parentId (root level when omitted). Backs the publish edit flow category picker.',
  })
  @ApiQuery({
    name: 'parentId',
    required: false,
    description: 'Parent category id; omit for root-level categories.',
  })
  @ApiResponse({ status: 200, description: 'Category nodes', type: [ShopCategoryResponseDto] })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  @ApiResponse({ status: 409, description: 'Connection disabled' })
  @ApiResponse({ status: 422, description: 'Adapter does not support shop category browsing' })
  async browseCategories(
    @Param('connectionId') connectionId: string,
    @Query('parentId') parentId?: string,
  ): Promise<ShopCategoryResponseDto[]> {
    const categories = await this.categoryBrowse.browseCategories(connectionId, parentId);
    return categories.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId }));
  }

  @Get(':recordId')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'recordId', format: 'uuid' })
  @ApiOperation({ summary: 'Get a shop publish record by id (status polling)' })
  @ApiResponse({
    status: 200,
    description: 'Publish record',
    type: ListingCreationRecordResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Record not found' })
  async getRecord(@Param('recordId') recordId: string): Promise<ListingCreationRecordResponseDto> {
    const record = await this.query.getById(recordId);
    if (!record) {
      throw new NotFoundException(`Listing creation record not found: ${recordId}`);
    }
    return this.toRecordDto(record);
  }

  private toRecordDto(record: ListingCreationRecord): ListingCreationRecordResponseDto {
    return {
      id: record.id,
      internalVariantId: record.internalVariantId,
      connectionId: record.connectionId,
      status: record.status,
      externalProductId: record.externalProductId,
      bulkBatchId: record.bulkBatchId,
      errors: record.errors,
      warnings: record.warnings,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}

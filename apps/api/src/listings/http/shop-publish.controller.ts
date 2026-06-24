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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import {
  IListingCreationQueryService,
  IProductPublishEnqueueService,
  LISTING_CREATION_QUERY_SERVICE_TOKEN,
  PRODUCT_PUBLISH_ENQUEUE_SERVICE_TOKEN,
} from '@openlinker/core/listings';
import type { ListingCreationRecord } from '@openlinker/core/listings';

import { Roles } from '../../auth/decorators/roles.decorator';
import { PublishProductRequestDto } from './dto/publish-product.dto';
import {
  ListingCreationRecordResponseDto,
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
  ) {}

  @Roles('admin')
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
      ...(idempotencyKey !== undefined && { idempotencyKey }),
    });
    return { jobId, listingCreationRecordId: listingCreationRecord.id };
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
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}

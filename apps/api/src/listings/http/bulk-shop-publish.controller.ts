/**
 * Bulk Shop Publish Controller (#1044)
 *
 * HTTP endpoints for operator-driven bulk shop publish. Thin wrapper over
 * `IBulkShopPublishSubmitService`: validates the request DTO, stamps
 * `initiatedBy` from the session, submits, and exposes a batch-summary read for
 * the FE tracker. The shop-side sibling of `BulkListingController`. Reuses the
 * child-type-agnostic `BulkListingBatch` aggregate.
 *
 * @module apps/api/src/listings/http
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import {
  BULK_SHOP_PUBLISH_SUBMIT_SERVICE_TOKEN,
  EmptyBulkSubmissionException,
  IBulkShopPublishSubmitService,
} from '@openlinker/core/listings';
import type { BulkShopPublishBatchSummary } from '@openlinker/core/listings';

import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/auth.types';
import { BulkPublishProductRequestDto } from './dto/publish-product.dto';
import {
  BulkShopPublishBatchSummaryDto,
  BulkShopPublishResponseDto,
} from './dto/shop-publish-response.dto';

@ApiBearerAuth()
@ApiTags('listings')
@Controller('listings/bulk-shop-publish')
export class BulkShopPublishController {
  constructor(
    @Inject(BULK_SHOP_PUBLISH_SUBMIT_SERVICE_TOKEN)
    private readonly bulkSubmit: IBulkShopPublishSubmitService,
  ) {}

  @Roles('admin', 'operator')
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Submit a bulk shop-publish batch (1..100 variants)',
    description:
      'Validates the connection + ProductPublisher capability, persists a BulkListingBatch, enqueues one shop.product.publish job per variant (carrying bulkBatchId), and returns the batchId + per-variant ids.',
  })
  @ApiResponse({
    status: 202,
    description: 'Batch persisted + jobs dispatched',
    type: BulkShopPublishResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Validation error or empty variant list' })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  @ApiResponse({ status: 409, description: 'Connection disabled' })
  @ApiResponse({ status: 422, description: 'Adapter does not support ProductPublisher' })
  async submit(
    @Body() dto: BulkPublishProductRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BulkShopPublishResponseDto> {
    try {
      const { batchId, items } = await this.bulkSubmit.submit({
        connectionId: dto.connectionId,
        initiatedBy: user.id,
        internalVariantIds: dto.internalVariantIds,
        status: dto.status,
        stock: dto.stock,
        ...(dto.price !== undefined && { price: dto.price }),
        ...(dto.content !== undefined && { content: dto.content }),
      });
      return { batchId, items };
    } catch (error) {
      if (error instanceof EmptyBulkSubmissionException) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Get(':batchId')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'batchId', format: 'uuid' })
  @ApiOperation({ summary: 'Get a bulk shop-publish batch + its per-variant records' })
  @ApiResponse({ status: 200, description: 'Batch summary', type: BulkShopPublishBatchSummaryDto })
  @ApiResponse({ status: 404, description: 'Batch not found' })
  async getBatch(
    @Param('batchId', new ParseUUIDPipe()) batchId: string,
  ): Promise<BulkShopPublishBatchSummaryDto> {
    const summary = await this.bulkSubmit.getBatch(batchId);
    if (!summary) {
      throw new NotFoundException(`Bulk shop-publish batch not found: ${batchId}`);
    }
    return this.toSummaryDto(summary);
  }

  private toSummaryDto(summary: BulkShopPublishBatchSummary): BulkShopPublishBatchSummaryDto {
    return {
      id: summary.batch.id,
      connectionId: summary.batch.connectionId,
      status: summary.batch.status,
      totalCount: summary.batch.totalCount,
      succeededCount: summary.batch.succeededCount,
      failedCount: summary.batch.failedCount,
      createdAt: summary.batch.createdAt.toISOString(),
      updatedAt: summary.batch.updatedAt.toISOString(),
      records: summary.records.map((record) => ({
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
      })),
    };
  }
}

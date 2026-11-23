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
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  InternalServerErrorException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import {
  AdapterCapabilityNotSupportedException,
  BULK_SHOP_PUBLISH_RETRY_SERVICE_TOKEN,
  BULK_SHOP_PUBLISH_SUBMIT_SERVICE_TOKEN,
  BulkListingBatchNotFoundException,
  BulkRetryMissingSnapshotException,
  EmptyBulkSubmissionException,
  IBulkShopPublishRetryService,
  IBulkShopPublishSubmitService,
  NoFailedChildrenToRetryException,
} from '@openlinker/core/listings';
import type { BulkShopPublishBatchSummary } from '@openlinker/core/listings';

import { Roles } from '../../auth/decorators/roles.decorator';
import { codedErrorBody, codedHttpError } from '../../common/errors/coded-http.exception';
import {
  adapterCapabilityNotSupported,
  bulkSubmissionEmpty,
  shopPublishMasterPublisherConflict,
} from './listings-errors';
import { AnyRole } from '../../auth/decorators/any-role.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/auth.types';
import { BulkListingRetryResponseDto } from './dto/bulk-listing-retry-response.dto';
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
    @Inject(BULK_SHOP_PUBLISH_RETRY_SERVICE_TOKEN)
    private readonly bulkRetry: IBulkShopPublishRetryService,
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
  @ApiResponse({ status: 409, description: 'Connection disabled, or it is both a ProductMaster and a ProductPublisher (SHOP_PUBLISH_MASTER_PUBLISHER_CONFLICT)' })
  @ApiResponse({ status: 422, description: 'Adapter does not support ProductPublisher' })
  async submit(
    @Body() dto: BulkPublishProductRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BulkShopPublishResponseDto> {
    try {
      const { batchId, items } = await this.bulkSubmit.submit({
        connectionId: dto.connectionId,
        initiatedBy: user.id,
        items: dto.items.map((item) => ({
          internalVariantId: item.internalVariantId,
          stock: item.stock,
          ...(item.price !== undefined && { price: item.price }),
          ...(item.content !== undefined && { content: item.content }),
          ...(item.destinationCategoryIds !== undefined && {
            destinationCategoryIds: item.destinationCategoryIds,
          }),
          ...(item.parameters !== undefined && { parameters: item.parameters }),
        })),
        status: dto.status,
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.commerce !== undefined && { commerce: dto.commerce }),
        ...(dto.generateDescription !== undefined && {
          generateDescription: dto.generateDescription,
        }),
        ...(dto.descriptionTone !== undefined && { descriptionTone: dto.descriptionTone }),
      });
      return { batchId, items };
    } catch (error) {
      if (error instanceof EmptyBulkSubmissionException) {
        throw bulkSubmissionEmpty(error);
      }
      throw shopPublishMasterPublisherConflict(error) ?? error;
    }
  }

  @AnyRole()
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
      throw codedHttpError(
        HttpStatus.NOT_FOUND,
        'BULK_SHOP_PUBLISH_BATCH_NOT_FOUND',
        `Bulk shop-publish batch not found: ${batchId}`,
        { batchId }
      );
    }
    return this.toSummaryDto(summary);
  }

  @Roles('admin', 'operator')
  @Post(':batchId/retry-failed')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiParam({ name: 'batchId', format: 'uuid' })
  @ApiOperation({
    summary: 'Re-enqueue the failed children of a bulk shop-publish batch',
    description:
      'Shop-publish sibling of the bulk-create retry: resets each failed record to `pending`, reopens the batch counters and enqueues `shop.product.publish` again under a wave-distinct idempotency key. Succeeded / pending children are skipped.',
  })
  @ApiResponse({ status: 202, description: 'Retry wave dispatched', type: BulkListingRetryResponseDto })
  @ApiResponse({ status: 404, description: 'Batch not found' })
  @ApiResponse({ status: 409, description: 'Batch has no failed children to retry' })
  @ApiResponse({ status: 422, description: 'Adapter no longer supports shop publishing' })
  @ApiResponse({ status: 500, description: 'Documented invariant violation (snapshot missing)' })
  async retryFailed(
    @Param('batchId', new ParseUUIDPipe()) batchId: string,
  ): Promise<BulkListingRetryResponseDto> {
    try {
      const result = await this.bulkRetry.retryFailed(batchId);
      return {
        retriedRecordIds: result.retriedRecordIds,
        retriedCount: result.retriedCount,
        batchStatus: result.batchStatus,
      };
    } catch (error) {
      if (error instanceof BulkListingBatchNotFoundException) {
        throw codedHttpError(
          HttpStatus.NOT_FOUND,
          'BULK_SHOP_PUBLISH_BATCH_NOT_FOUND',
          error.message,
          { batchId },
        );
      }
      if (error instanceof NoFailedChildrenToRetryException) {
        throw codedHttpError(HttpStatus.CONFLICT, 'BULK_RETRY_NOTHING_FAILED', error.message, {
          batchId: error.batchId,
        });
      }
      if (error instanceof AdapterCapabilityNotSupportedException) {
        throw adapterCapabilityNotSupported(error, HttpStatus.UNPROCESSABLE_ENTITY);
      }
      if (error instanceof BulkRetryMissingSnapshotException) {
        throw new InternalServerErrorException(
          codedErrorBody(
            HttpStatus.INTERNAL_SERVER_ERROR,
            'BULK_RETRY_SNAPSHOT_MISSING',
            error.message,
            { recordId: error.recordId, batchId: error.batchId },
          ),
        );
      }
      throw error;
    }
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

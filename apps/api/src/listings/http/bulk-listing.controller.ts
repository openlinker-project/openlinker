/**
 * Bulk Offer Creation Controller (#736)
 *
 * HTTP endpoints for operator-driven bulk offer creation. Thin wrapper
 * over `IBulkListingSubmitService`: validates the request DTO, maps
 * to the service input (stamping `initiatedBy` from the authenticated
 * session), and serialises the typed result back through the response
 * DTOs.
 *
 * Per-product worker handling (consuming the V2 payload, incrementing
 * batch counters, derivation of terminal status) lands in **#737**.
 *
 * @module apps/api/src/listings/http
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import {
  AdapterCapabilityNotSupportedException,
  BULK_LISTING_RETRY_SERVICE_TOKEN,
  BULK_LISTING_SUBMIT_SERVICE_TOKEN,
  BulkListingBatchNotFoundException,
  BulkRetryMissingSnapshotException,
  CurrencyMismatchException,
  DuplicateBatchEanException,
  EmptyBulkSubmissionException,
  ExpandedOfferCeilingExceededException,
  IBulkListingRetryService,
  IBulkListingSubmitService,
  InvalidEanException,
  InvalidOverrideKeyException,
  NoFailedChildrenToRetryException,
} from '@openlinker/core/listings';
import type {
  BulkBatchSummary,
  BulkListingSubmitInput,
} from '@openlinker/core/listings';

import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/auth.types';
import { BulkOfferCreateRequestDto } from './dto/bulk-offer-create.dto';
import type {
  BulkBatchRecordSummaryDto} from './dto/bulk-offer-create-response.dto';
import {
  BulkBatchSummaryDto,
  BulkOfferCreateResponseDto,
} from './dto/bulk-offer-create-response.dto';
import { BulkListingRetryResponseDto } from './dto/bulk-listing-retry-response.dto';

@ApiBearerAuth()
@ApiTags('listings')
@Controller('listings/bulk-create')
export class BulkListingController {
  constructor(
    @Inject(BULK_LISTING_SUBMIT_SERVICE_TOKEN)
    private readonly bulkSubmit: IBulkListingSubmitService,
    @Inject(BULK_LISTING_RETRY_SERVICE_TOKEN)
    private readonly bulkRetry: IBulkListingRetryService
  ) {}

  @Roles('admin', 'operator')
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Submit a bulk offer-creation batch (1..100 products)',
    description:
      'Validates the connection + adapter capability, persists a BulkListingBatch, enqueues one marketplace.offer.create job per product, and returns the batchId + per-job message ids. The worker handler change consuming the V2 payload lands in #737; this endpoint is the submit + read seam for the wizard.',
  })
  @ApiResponse({
    status: 202,
    description: 'Batch persisted + jobs dispatched',
    type: BulkOfferCreateResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Validation error or empty productIds' })
  @ApiResponse({ status: 404, description: 'Connection not found' })
  @ApiResponse({ status: 409, description: 'Connection disabled' })
  @ApiResponse({ status: 422, description: 'Adapter does not support offer creation' })
  async submit(
    @Body() dto: BulkOfferCreateRequestDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<BulkOfferCreateResponseDto> {
    const input: BulkListingSubmitInput = {
      connectionId: dto.connectionId,
      initiatedBy: user.id,
      productIds: dto.productIds,
      sharedConfig: {
        stock: dto.sharedConfig.stock,
        publishImmediately: dto.sharedConfig.publishImmediately,
        ...(dto.sharedConfig.price !== undefined && { price: dto.sharedConfig.price }),
        ...(dto.sharedConfig.overrides !== undefined && {
          overrides: dto.sharedConfig.overrides,
        }),
        ...(dto.sharedConfig.generateDescription !== undefined && {
          generateDescription: dto.sharedConfig.generateDescription,
        }),
        ...(dto.sharedConfig.descriptionTone !== undefined && {
          descriptionTone: dto.sharedConfig.descriptionTone,
        }),
      },
      ...(dto.perProductOverrides !== undefined && {
        perProductOverrides: dto.perProductOverrides,
      }),
      ...(dto.perVariantOverrides !== undefined && {
        perVariantOverrides: dto.perVariantOverrides,
      }),
      ...(dto.excludedVariantIds !== undefined && {
        excludedVariantIds: dto.excludedVariantIds,
      }),
    };

    try {
      const { batchId, jobIds } = await this.bulkSubmit.submit(input);
      return { batchId, jobIds };
    } catch (error) {
      // Invalid-input identifier / override enforcement (#1741) → 400, the same
      // mapping shape as the empty-submission guard.
      if (
        error instanceof EmptyBulkSubmissionException ||
        error instanceof InvalidEanException ||
        error instanceof DuplicateBatchEanException ||
        error instanceof CurrencyMismatchException ||
        error instanceof InvalidOverrideKeyException
      ) {
        throw new BadRequestException(error.message);
      }
      // Post-#824 fan-out exceeds the hard ceiling → 422 (preserves the status
      // the previous inline UnprocessableEntityException returned).
      if (error instanceof ExpandedOfferCeilingExceededException) {
        throw new UnprocessableEntityException(error.message);
      }
      // Remaining domain exceptions are mapped by global filters:
      // `CapabilityNotSupportedException` → 400 (`CapabilityNotSupportedFilter`),
      // `ConnectionNotFoundException` → 404 / `ConnectionDisabledException` → 409
      // (`ConnectionExceptionFilter`, #1087). Re-throw so they reach those filters.
      throw error;
    }
  }

  @Get(':batchId')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'batchId', format: 'uuid' })
  @ApiOperation({ summary: 'Get a bulk batch and its per-product summaries' })
  @ApiResponse({ status: 200, description: 'Batch summary', type: BulkBatchSummaryDto })
  @ApiResponse({ status: 404, description: 'Batch not found' })
  async getBatch(
    @Param('batchId', new ParseUUIDPipe()) batchId: string
  ): Promise<BulkBatchSummaryDto> {
    const summary = await this.bulkSubmit.getBatch(batchId);
    if (!summary) {
      throw new NotFoundException(`Bulk offer creation batch not found: ${batchId}`);
    }
    return this.toSummaryDto(summary);
  }

  @Roles('admin', 'operator')
  @Post(':batchId/retry-failed')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiParam({ name: 'batchId', format: 'uuid' })
  @ApiOperation({
    summary: 'Re-enqueue the failed children of a bulk batch',
    description:
      'Reopens the batch by decrementing failedCount per record (lock-stepped to the per-record reset), deleting per-record advancement rows, and flipping terminal-state batches back to `running`. Each retried record is reset to `pending` and its `marketplace.offer.create` job is enqueued with a wave-distinct idempotency key. Succeeded / pending children are skipped.',
  })
  @ApiResponse({
    status: 202,
    description: 'Retry wave dispatched',
    type: BulkListingRetryResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Batch not found' })
  @ApiResponse({ status: 409, description: 'Batch has no failed children to retry' })
  @ApiResponse({ status: 422, description: 'Adapter no longer supports offer creation' })
  @ApiResponse({ status: 500, description: 'Documented invariant violation (snapshot missing)' })
  async retryFailed(
    @Param('batchId', new ParseUUIDPipe()) batchId: string
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
        throw new NotFoundException(error.message);
      }
      if (error instanceof NoFailedChildrenToRetryException) {
        throw new ConflictException(error.message);
      }
      if (error instanceof AdapterCapabilityNotSupportedException) {
        throw new UnprocessableEntityException(error.message);
      }
      if (error instanceof BulkRetryMissingSnapshotException) {
        // Documented invariant violation: every record on a bulk batch
        // carries a `request` snapshot. Map to 500 explicitly with the
        // typed message so the operator sees `recordId` + `batchId` in
        // the response body (Nest's default 500 filter swallows it).
        throw new InternalServerErrorException(error.message);
      }
      throw error;
    }
  }

  private toSummaryDto(summary: BulkBatchSummary): BulkBatchSummaryDto {
    const recordDtos: BulkBatchRecordSummaryDto[] = summary.records.map((record) => ({
      id: record.id,
      internalVariantId: record.internalVariantId,
      status: record.status,
      externalOfferId: record.externalOfferId,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      errors: record.errors,
    }));
    return {
      id: summary.batch.id,
      connectionId: summary.batch.connectionId,
      status: summary.batch.status,
      totalCount: summary.batch.totalCount,
      succeededCount: summary.batch.succeededCount,
      failedCount: summary.batch.failedCount,
      createdAt: summary.batch.createdAt.toISOString(),
      updatedAt: summary.batch.updatedAt.toISOString(),
      records: recordDtos,
    };
  }
}

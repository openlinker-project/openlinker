/**
 * Sync Controller
 *
 * HTTP REST API endpoints for sync job management. Provides endpoints for
 * enqueuing sync jobs manually and querying job status.
 *
 * @module apps/api/src/sync/http
 */
import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Param,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Inject,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  JobEnqueuePort,
  JOB_ENQUEUE_TOKEN,
  SyncJobRepositoryPort,
  SYNC_JOB_REPOSITORY_TOKEN,
  SYNC_JOB_RETRY_SERVICE_TOKEN,
  SYNC_JOB_BULK_RETRY_SERVICE_TOKEN,
  InvalidSyncJobStateError,
  SyncJobNotFoundError,
} from '@openlinker/core/sync';
import type { SyncJob, SyncJobRequest } from '@openlinker/core/sync';
import { ISyncJobRetryService, ISyncJobBulkRetryService } from '@openlinker/core/sync';
import { buildInboundJobIdempotencyKey } from '@openlinker/core/sync';
import { EnqueueSyncJobDto } from './dto/enqueue-sync-job.dto';
import { EnqueueSyncJobResponseDto } from './dto/enqueue-sync-job-response.dto';
import { ListSyncJobsQueryDto } from './dto/list-sync-jobs-query.dto';
import { SyncJobResponseDto } from './dto/sync-job-response.dto';
import { PaginatedSyncJobsResponseDto } from './dto/paginated-sync-jobs-response.dto';
import { ListGroupedSyncJobsQueryDto } from './dto/list-grouped-sync-jobs-query.dto';
import { GroupedSyncJobsResponseDto } from './dto/grouped-sync-jobs-response.dto';
import { RetryGroupedSyncJobsDto } from './dto/retry-grouped-sync-jobs.dto';
import { RetryGroupedSyncJobsResponseDto } from './dto/retry-grouped-sync-jobs-response.dto';
import { Logger } from '@openlinker/shared/logging';

@ApiBearerAuth()
@ApiTags('sync')
@Controller('sync')
export class SyncController {
  private readonly logger = new Logger(SyncController.name);

  constructor(
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort,
    @Inject(SYNC_JOB_REPOSITORY_TOKEN)
    private readonly syncJobRepository: SyncJobRepositoryPort,
    @Inject(SYNC_JOB_RETRY_SERVICE_TOKEN)
    private readonly retryService: ISyncJobRetryService,
    @Inject(SYNC_JOB_BULK_RETRY_SERVICE_TOKEN)
    private readonly bulkRetryService: ISyncJobBulkRetryService
  ) {}

  @Roles('admin')
  @Post('jobs')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Enqueue a sync job',
    description:
      'Enqueues a sync job request to Redis Streams. The job will be consumed by workers and executed asynchronously. Idempotency is enforced using the idempotencyKey.',
  })
  @ApiResponse({
    status: 200,
    description: 'Job enqueued successfully',
    type: EnqueueSyncJobResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request (validation failed)',
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async enqueueJob(@Body() dto: EnqueueSyncJobDto): Promise<EnqueueSyncJobResponseDto> {
    this.logger.log(
      `Enqueuing sync job: ${dto.jobType} for connection ${dto.connectionId} (idempotencyKey: ${dto.idempotencyKey})`
    );

    try {
      // Build sync job request
      const jobRequest: SyncJobRequest = {
        jobType: dto.jobType as SyncJobRequest['jobType'],
        connectionId: dto.connectionId,
        payload: dto.payload,
        idempotencyKey: dto.idempotencyKey,
      };

      const { jobId, isExisting } = await this.jobEnqueue.enqueueJob(jobRequest);

      this.logger.log(
        `Job enqueued successfully: ${jobId} (type: ${dto.jobType}, connection: ${dto.connectionId})`
      );

      return {
        jobId,
        jobType: dto.jobType,
        connectionId: dto.connectionId,
        isExisting,
      };
    } catch (error) {
      this.logger.error(
        `Failed to enqueue job: ${dto.jobType} for connection ${dto.connectionId}`,
        error instanceof Error ? error.stack : String(error)
      );

      if (error instanceof Error) {
        throw new BadRequestException(`Failed to enqueue job: ${error.message}`);
      }

      throw new BadRequestException('Failed to enqueue job: Unknown error');
    }
  }

  @Get('jobs')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List sync jobs',
    description:
      'Returns a paginated list of sync jobs. Supports filtering by status, outcome, connectionId, and jobType.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated job list',
    type: PaginatedSyncJobsResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async listJobs(@Query() query: ListSyncJobsQueryDto): Promise<PaginatedSyncJobsResponseDto> {
    const { status, connectionId, jobType, outcome, limit = 20, offset = 0 } = query;

    const { items, total } = await this.syncJobRepository.findMany(
      { status, connectionId, jobType, outcome },
      { limit, offset }
    );

    return {
      items: items.map((j) => this.toDto(j)),
      total,
      limit,
      offset,
    };
  }

  @Get('jobs/grouped')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List sync jobs grouped by (connectionId, jobType)',
    description:
      "Aggregates jobs matching the status filter into one row per (connectionId, jobType) signature. Returns count, latest updatedAt, a representative job ID, and the group's lastError. Sorted by count DESC, then latestUpdatedAt DESC.",
  })
  @ApiResponse({
    status: 200,
    description: 'Aggregated group list',
    type: GroupedSyncJobsResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async listGroupedJobs(
    @Query() query: ListGroupedSyncJobsQueryDto
  ): Promise<GroupedSyncJobsResponseDto> {
    const { status, connectionId, limit = 100 } = query;

    const { groups, totalGroups, totalJobs } = await this.syncJobRepository.findGroupedByStatus(
      { status, connectionId },
      limit
    );

    return {
      groups: groups.map((g) => ({
        connectionId: g.connectionId,
        jobType: g.jobType,
        count: g.count,
        latestUpdatedAt:
          g.latestUpdatedAt instanceof Date ? g.latestUpdatedAt.toISOString() : g.latestUpdatedAt,
        representativeJobId: g.representativeJobId,
        lastError: g.lastError,
      })),
      totalGroups,
      totalJobs,
    };
  }

  @Roles('admin')
  @Get('jobs/lookup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Look up the sync job an inbound webhook event enqueued',
    description:
      'Resolves the persisted SyncJob for a webhook trigger, keyed by the inbound-job idempotency key the server assembles from (platformType, connectionId, eventId) — the same key InboundRoutingPolicy stamps on the enqueued job (#1366). Callers pass the raw components (a webhook delivery holds all three) rather than re-encoding the key format. Returns 404 if no job with that key exists yet — the enqueue and the worker-side row creation happen at different times.',
  })
  @ApiResponse({ status: 200, description: 'Job detail', type: SyncJobResponseDto })
  @ApiResponse({ status: 400, description: 'Missing platformType, connectionId, or eventId' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async lookupJobForWebhookEvent(
    @Query('platformType') platformType?: string,
    @Query('connectionId') connectionId?: string,
    @Query('eventId') eventId?: string
  ): Promise<SyncJobResponseDto> {
    if (
      !platformType?.trim() ||
      !connectionId?.trim() ||
      !eventId?.trim()
    ) {
      throw new BadRequestException(
        'platformType, connectionId, and eventId query parameters are required'
      );
    }
    const idempotencyKey = buildInboundJobIdempotencyKey(platformType, connectionId, eventId);
    const job = await this.syncJobRepository.findByIdempotencyKey(idempotencyKey);
    if (!job) {
      throw new NotFoundException(`Sync job not found for idempotency key: ${idempotencyKey}`);
    }
    return this.toDto(job);
  }

  @Roles('admin')
  @Post('jobs/retry-grouped')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Re-queue every dead job in a (connectionId, jobType) group',
    description:
      'Re-queues every dead sync job matching the group selector, capped at a server-side batch size. Jobs that flipped out of dead between our selection and the update are counted as skipped. Emits one sync.job.bulk-retry-requested event when at least one job is re-queued.',
  })
  @ApiResponse({
    status: 200,
    description: 'Bulk retry result',
    type: RetryGroupedSyncJobsResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async retryGroupedJobs(
    @Body() dto: RetryGroupedSyncJobsDto
  ): Promise<RetryGroupedSyncJobsResponseDto> {
    const result = await this.bulkRetryService.retryGroup(dto.connectionId, dto.jobType);
    return {
      requeuedJobIds: result.requeuedJobIds,
      count: result.count,
      skipped: result.skipped,
    };
  }

  @Get('jobs/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get sync job by ID' })
  @ApiResponse({ status: 200, description: 'Job detail', type: SyncJobResponseDto })
  @ApiResponse({ status: 404, description: 'Job not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getJob(@Param('id', ParseUUIDPipe) id: string): Promise<SyncJobResponseDto> {
    const job = await this.syncJobRepository.findById(id);
    if (!job) {
      throw new NotFoundException(`Sync job not found: ${id}`);
    }
    return this.toDto(job);
  }

  @Roles('admin')
  @Post('jobs/:id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retry a dead sync job',
    description:
      'Requeues a dead sync job for retry. Resets the job to queued status with zero attempts. Only jobs in dead status can be retried.',
  })
  @ApiResponse({ status: 200, description: 'Job requeued for retry', type: SyncJobResponseDto })
  @ApiResponse({ status: 404, description: 'Job not found' })
  @ApiResponse({ status: 409, description: 'Job is not in dead status' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async retryJob(@Param('id', ParseUUIDPipe) id: string): Promise<SyncJobResponseDto> {
    try {
      const job = await this.retryService.retryJob(id);
      return this.toDto(job);
    } catch (error) {
      if (error instanceof SyncJobNotFoundError) {
        throw new NotFoundException(`Sync job not found: ${id}`);
      }
      if (error instanceof InvalidSyncJobStateError) {
        throw new ConflictException(`Job cannot be retried: ${error.message}`);
      }
      throw error;
    }
  }

  private toDto(job: SyncJob): SyncJobResponseDto {
    return {
      id: job.id,
      jobType: job.jobType,
      connectionId: job.connectionId,
      status: job.status,
      outcome: job.outcome ?? null,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      nextRunAt: job.nextRunAt instanceof Date ? job.nextRunAt.toISOString() : job.nextRunAt,
      lastError: job.lastError ?? null,
      createdAt: job.createdAt instanceof Date ? job.createdAt.toISOString() : job.createdAt,
      updatedAt: job.updatedAt instanceof Date ? job.updatedAt.toISOString() : job.updatedAt,
      payloadJson: job.payload ?? null,
      idempotencyKey: job.idempotencyKey ?? null,
      lockedAt: job.lockedAt instanceof Date ? job.lockedAt.toISOString() : job.lockedAt ?? null,
      lockedBy: job.lockedBy ?? null,
    };
  }
}

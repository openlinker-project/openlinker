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
  NotFoundException,
  Inject,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  JobEnqueuePort,
  JOB_ENQUEUE_TOKEN,
  SyncJobRequest,
  SyncJobRepositoryPort,
  SYNC_JOB_REPOSITORY_TOKEN,
} from '@openlinker/core/sync';
import type { SyncJob } from '@openlinker/core/sync';
import { EnqueueSyncJobDto } from './dto/enqueue-sync-job.dto';
import { EnqueueSyncJobResponseDto } from './dto/enqueue-sync-job-response.dto';
import { ListSyncJobsQueryDto } from './dto/list-sync-jobs-query.dto';
import { SyncJobResponseDto } from './dto/sync-job-response.dto';
import { PaginatedSyncJobsResponseDto } from './dto/paginated-sync-jobs-response.dto';
import { Logger } from '@openlinker/shared/logging';

@Roles('admin')
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
  ) {}

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
      `Enqueuing sync job: ${dto.jobType} for connection ${dto.connectionId} (idempotencyKey: ${dto.idempotencyKey})`,
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
        `Job enqueued successfully: ${jobId} (type: ${dto.jobType}, connection: ${dto.connectionId})`,
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
        error instanceof Error ? error.stack : String(error),
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
    description: 'Returns a paginated list of sync jobs. Supports filtering by status, connectionId, and jobType.',
  })
  @ApiResponse({ status: 200, description: 'Paginated job list', type: PaginatedSyncJobsResponseDto })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async listJobs(@Query() query: ListSyncJobsQueryDto): Promise<PaginatedSyncJobsResponseDto> {
    const { status, connectionId, jobType, limit = 20, offset = 0 } = query;

    const { items, total } = await this.syncJobRepository.findMany(
      { status, connectionId, jobType },
      { limit, offset },
    );

    return {
      items: items.map((j) => this.toDto(j)),
      total,
      limit,
      offset,
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

  private toDto(job: SyncJob): SyncJobResponseDto {
    return {
      id: job.id,
      jobType: job.jobType,
      connectionId: job.connectionId,
      status: job.status,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      nextRunAt: job.nextRunAt instanceof Date ? job.nextRunAt.toISOString() : job.nextRunAt,
      lastError: job.lastError ?? null,
      createdAt: job.createdAt instanceof Date ? job.createdAt.toISOString() : job.createdAt,
      updatedAt: job.updatedAt instanceof Date ? job.updatedAt.toISOString() : job.updatedAt,
      payloadJson: job.payload ?? null,
      idempotencyKey: job.idempotencyKey ?? null,
      lockedAt: job.lockedAt instanceof Date ? job.lockedAt.toISOString() : (job.lockedAt ?? null),
      lockedBy: job.lockedBy ?? null,
    };
  }
}


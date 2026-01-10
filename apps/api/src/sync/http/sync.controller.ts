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
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JobEnqueuePort, JOB_ENQUEUE_TOKEN, SyncJobRequest } from '@openlinker/core/sync';
import { EnqueueSyncJobDto } from './dto/enqueue-sync-job.dto';
import { EnqueueSyncJobResponseDto } from './dto/enqueue-sync-job-response.dto';
import { Logger } from '@openlinker/shared/logging';

@ApiTags('sync')
@Controller('sync')
export class SyncController {
  private readonly logger = new Logger(SyncController.name);

  constructor(
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort,
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

      // Enqueue job
      const jobId = await this.jobEnqueue.enqueueJob(jobRequest);

      // Check if this is an existing job (idempotent)
      const isExisting = jobId.startsWith('existing:');

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
}


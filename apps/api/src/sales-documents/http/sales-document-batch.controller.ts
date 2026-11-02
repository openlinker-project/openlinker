/**
 * Sales-document batch controller (#3583, epic #3515)
 *
 * The batch-issuing surface behind mockup M15: a connection's schedules and next
 * slots, its queue, its run history with per-order outcomes, and "Run now".
 *
 * Schedules are edited through the connection's config like the trigger model
 * (#3582); this controller only READS them, resolved by the same pure rules the
 * worker's tick uses (`readBatchSchedule` / `findNextBatchSlots`), so the next
 * slot shown is the slot that will run.
 *
 * "Run now" enqueues the SAME `salesDocument.batch.run` job a scheduled slot
 * does, under a one-off key, so the operator's run and the scheduled run issue
 * documents through one path. Refusals answer with stable codes:
 * `CONNECTION_NOT_BATCHED`, `CONNECTION_NEEDS_REAUTH`, `CONNECTION_NOT_ACTIVE`,
 * `BATCH_RUN_IN_PROGRESS`.
 *
 * Reads are open to admin, operator and viewer (a viewer can see what is
 * waiting); starting a run is admin and operator, because it issues fiscal
 * documents.
 *
 * @module apps/api/src/sales-documents/http
 */
import { randomUUID } from 'crypto';
import {
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  CONNECTION_PORT_TOKEN,
  ConnectionNotFoundException,
  type Connection,
  type ConnectionPort,
} from '@openlinker/core/identifier-mapping';
import { resolveTriggerModelForKind } from '@openlinker/core/invoicing';
import {
  SALES_DOCUMENT_BATCH_SERVICE_TOKEN,
  buildManualBatchRunKey,
  type ISalesDocumentBatchService,
  type SalesDocumentBatchRun,
} from '@openlinker/core/orders';
import {
  findNextBatchSlots,
  readBatchSchedule,
  type SalesDocumentKind,
} from '@openlinker/core/sales-documents';
import {
  JOB_ENQUEUE_TOKEN,
  type JobEnqueuePort,
  type SalesDocumentBatchRunPayloadV1,
} from '@openlinker/core/sync';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/auth.types';
import {
  SalesDocumentBatchOverviewDto,
  SalesDocumentBatchQueueDto,
  SalesDocumentBatchQueueQueryDto,
  SalesDocumentBatchRunDetailDto,
  SalesDocumentBatchRunListDto,
  SalesDocumentBatchRunListQueryDto,
  StartSalesDocumentBatchRunResponseDto,
} from './dto/sales-document-batch.dto';
import type { BatchScheduleDto, SalesDocumentBatchRunDto } from './dto/sales-document-batch.dto';

const BATCH_KINDS: readonly SalesDocumentKind[] = ['invoice', 'fiscal-receipt'];

function toRunDto(run: SalesDocumentBatchRun): SalesDocumentBatchRunDto {
  return {
    id: run.id,
    connectionId: run.connectionId,
    trigger: run.trigger,
    documentKinds: [...run.documentKinds],
    segment: run.segment,
    slotAt: run.slotAt?.toISOString() ?? null,
    status: run.status,
    failureReason: run.failureReason,
    eligibleCount: run.eligibleCount,
    enqueuedCount: run.enqueuedCount,
    blockedCount: run.blockedCount,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

function batchedKinds(connection: Connection): SalesDocumentKind[] {
  return BATCH_KINDS.filter(
    (kind) => resolveTriggerModelForKind(connection.config, kind).model === 'batched',
  );
}

@ApiBearerAuth()
@ApiTags('sales-documents')
@Controller('sales-documents/batches')
export class SalesDocumentBatchController {
  constructor(
    @Inject(SALES_DOCUMENT_BATCH_SERVICE_TOKEN)
    private readonly batches: ISalesDocumentBatchService,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connections: ConnectionPort,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort,
  ) {}

  @Get(':connectionId')
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({ summary: "A connection's batch schedules, next slots, queue counts and running run" })
  @ApiResponse({ status: 200, type: SalesDocumentBatchOverviewDto })
  async getOverview(
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
  ): Promise<SalesDocumentBatchOverviewDto> {
    const connection = await this.getConnection(connectionId);
    const now = new Date();
    const schedules: BatchScheduleDto[] = BATCH_KINDS.map((kind) => {
      const schedule = readBatchSchedule(connection.config, kind);
      return {
        documentKind: kind,
        batched: resolveTriggerModelForKind(connection.config, kind).model === 'batched',
        frequency: schedule?.frequency ?? null,
        time: schedule?.time ?? null,
        everyHours: schedule?.everyHours ?? null,
        timeZone: schedule?.timeZone ?? null,
        nextSlots:
          schedule === null
            ? []
            : findNextBatchSlots(schedule, now).map((slot) => ({
                segment: slot.segment,
                slotAt: slot.slotAt.toISOString(),
              })),
      };
    });
    const [queueCounts, running] = await Promise.all([
      this.batches.countQueue(connectionId),
      this.batches.findRunning(connectionId),
    ]);
    return {
      connectionId,
      schedules,
      queueCounts,
      runningRun: running === null ? null : toRunDto(running),
    };
  }

  @Get(':connectionId/queue')
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({ summary: 'Orders waiting for the next batch run, oldest id first' })
  @ApiResponse({ status: 200, type: SalesDocumentBatchQueueDto })
  async getQueue(
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Query() query: SalesDocumentBatchQueueQueryDto,
  ): Promise<SalesDocumentBatchQueueDto> {
    const limit = query.limit ?? 50;
    const entries = await this.batches.listQueue(connectionId, {
      documentKind: query.documentKind,
      afterOrderId: query.after,
      limit,
    });
    return {
      items: entries.map((entry) => ({
        orderId: entry.orderId,
        sourceConnectionId: entry.sourceConnectionId,
        documentKind: entry.documentKind,
        placedAt: entry.placedAt?.toISOString() ?? null,
        totalAmount: entry.totalAmount,
        currency: entry.currency,
        isB2b: entry.isB2b,
      })),
      nextCursor: entries.length === limit ? entries[entries.length - 1].orderId : null,
    };
  }

  @Get(':connectionId/runs')
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({ summary: 'Run history, newest first' })
  @ApiResponse({ status: 200, type: SalesDocumentBatchRunListDto })
  async listRuns(
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Query() query: SalesDocumentBatchRunListQueryDto,
  ): Promise<SalesDocumentBatchRunListDto> {
    const result = await this.batches.listRuns(connectionId, {
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
    });
    return { runs: result.runs.map(toRunDto), total: result.total };
  }

  @Get(':connectionId/runs/:runId')
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({ summary: "One run with each order's outcome, read from its documents now" })
  @ApiResponse({ status: 200, type: SalesDocumentBatchRunDetailDto })
  @ApiResponse({ status: 404, description: 'No such run on this connection' })
  async getRun(
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Param('runId') runId: string,
  ): Promise<SalesDocumentBatchRunDetailDto> {
    const detail = await this.batches.getRun(runId);
    // A run of another connection answers 404, never its contents.
    if (detail === null || detail.run.connectionId !== connectionId) {
      throw new NotFoundException('Batch run not found');
    }
    return {
      run: toRunDto(detail.run),
      items: detail.items.map(({ item, outcome }) => ({
        orderId: item.orderId,
        documentKind: item.documentKind,
        result: item.result,
        outcome,
        blockReason: item.blockReason,
      })),
    };
  }

  @Post(':connectionId/runs')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles('admin', 'operator')
  @ApiOperation({
    summary: 'Run now: issue everything in the queue',
    description:
      'Enqueues the same run job a scheduled slot does, for every batched kind of the connection ' +
      'and the whole queue (B2B and B2C). 409 with a code when the connection is not batched, ' +
      'needs reconnecting, is not active, or a run is already in progress.',
  })
  @ApiResponse({ status: 202, type: StartSalesDocumentBatchRunResponseDto })
  @ApiResponse({ status: 409, description: 'Refused, with a `code`' })
  async startRun(
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StartSalesDocumentBatchRunResponseDto> {
    const connection = await this.getConnection(connectionId);
    const kinds = batchedKinds(connection);
    if (kinds.length === 0) {
      throw new ConflictException({
        code: 'CONNECTION_NOT_BATCHED',
        message: 'This connection does not issue any document in batches.',
      });
    }
    if (connection.status === 'needs_reauth') {
      throw new ConflictException({
        code: 'CONNECTION_NEEDS_REAUTH',
        message: 'Reconnect this connection before running a batch.',
      });
    }
    if (connection.status !== 'active') {
      throw new ConflictException({
        code: 'CONNECTION_NOT_ACTIVE',
        message: 'This connection is not active.',
      });
    }
    if ((await this.batches.findRunning(connectionId)) !== null) {
      throw new ConflictException({
        code: 'BATCH_RUN_IN_PROGRESS',
        message: 'A batch run is already in progress for this connection.',
      });
    }

    const payload: SalesDocumentBatchRunPayloadV1 = {
      schemaVersion: 1,
      trigger: 'manual',
      documentKinds: kinds,
      segment: 'all',
      startedByUserId: user.id,
    };
    const result = await this.jobEnqueue.enqueueJob({
      jobType: 'salesDocument.batch.run',
      connectionId,
      payload: payload as unknown as Record<string, unknown>,
      idempotencyKey: buildManualBatchRunKey(connectionId, randomUUID()),
    });
    return { jobId: result.jobId };
  }

  private async getConnection(connectionId: string): Promise<Connection> {
    try {
      return await this.connections.get(connectionId);
    } catch (error) {
      if (error instanceof ConnectionNotFoundException) {
        throw new NotFoundException('Connection not found');
      }
      throw error;
    }
  }
}

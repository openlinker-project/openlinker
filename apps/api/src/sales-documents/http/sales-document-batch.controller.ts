/**
 * Sales-document batch controller (#3583, epic #3515)
 *
 * The batch-issuing surface behind mockup M15: a connection's schedules and next
 * slots, its queue, its run history with per-order outcomes, and "Run now".
 *
 * A thin HTTP layer over `ISalesDocumentBatchService`: the overview (schedules
 * resolved by the same pure rules the worker's tick uses, so the next slot
 * shown is the slot that will run) and the "Run now" policy (which kinds a
 * manual run covers, and when it is refused) both live in that service, so the
 * run, the tick and this surface share one rule. Schedules are edited through
 * the connection's config like the trigger model (#3582).
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
  SALES_DOCUMENT_BATCH_SERVICE_TOKEN,
  type ISalesDocumentBatchService,
  type SalesDocumentBatchRun,
  type SalesDocumentBatchRunRefusal,
} from '@openlinker/core/orders';
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
import type { SalesDocumentBatchRunDto } from './dto/sales-document-batch.dto';

/**
 * Stable 409 codes for a refused "Run now". A missing connection is a 404 and
 * is handled apart. The record is total over the refusal union, so a new
 * refusal is a compile error here rather than an unmapped 500.
 */
const RUN_REFUSAL_RESPONSE: Record<
  Exclude<SalesDocumentBatchRunRefusal, 'connection-not-found'>,
  { code: string; message: string }
> = {
  'not-batched': {
    code: 'CONNECTION_NOT_BATCHED',
    message: 'This connection does not issue any document in batches.',
  },
  'connection-needs-reauth': {
    code: 'CONNECTION_NEEDS_REAUTH',
    message: 'Reconnect this connection before running a batch.',
  },
  'connection-not-active': {
    code: 'CONNECTION_NOT_ACTIVE',
    message: 'This connection is not active.',
  },
  'run-in-progress': {
    code: 'BATCH_RUN_IN_PROGRESS',
    message: 'A batch run is already in progress for this connection.',
  },
};

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

@ApiBearerAuth()
@ApiTags('sales-documents')
@Controller('sales-documents/batches')
export class SalesDocumentBatchController {
  constructor(
    @Inject(SALES_DOCUMENT_BATCH_SERVICE_TOKEN)
    private readonly batches: ISalesDocumentBatchService,
  ) {}

  @Get(':connectionId')
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({ summary: "A connection's batch schedules, next slots, queue counts and running run" })
  @ApiResponse({ status: 200, type: SalesDocumentBatchOverviewDto })
  async getOverview(
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
  ): Promise<SalesDocumentBatchOverviewDto> {
    const overview = await this.batches.getOverview(connectionId, new Date());
    if (overview === null) {
      throw new NotFoundException('Connection not found');
    }
    return {
      connectionId,
      schedules: overview.kinds.map(({ documentKind, batched, schedule, nextSlots }) => ({
        documentKind,
        batched,
        frequency: schedule?.frequency ?? null,
        time: schedule?.time ?? null,
        everyHours: schedule?.everyHours ?? null,
        timeZone: schedule?.timeZone ?? null,
        nextSlots: nextSlots.map((slot) => ({
          segment: slot.segment,
          slotAt: slot.slotAt.toISOString(),
        })),
      })),
      queueCounts: overview.queueCounts,
      runningRun: overview.runningRun === null ? null : toRunDto(overview.runningRun),
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
        orderNumber: entry.orderNumber,
        buyerName: entry.buyerName,
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
      items: detail.items.map(({ item, outcome, orderNumber, buyerName, documentNumber }) => ({
        orderId: item.orderId,
        documentKind: item.documentKind,
        result: item.result,
        outcome,
        blockReason: item.blockReason,
        orderNumber,
        buyerName,
        documentNumber,
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
    const result = await this.batches.requestRun({ connectionId, startedByUserId: user.id });
    if (result.status === 'enqueued') {
      return { jobId: result.jobId };
    }
    if (result.reason === 'connection-not-found') {
      throw new NotFoundException('Connection not found');
    }
    throw new ConflictException(RUN_REFUSAL_RESPONSE[result.reason]);
  }
}

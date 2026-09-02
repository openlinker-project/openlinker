/**
 * Analytics Remediation Controller
 *
 * HTTP surface for the Data Coverage panel's one genuinely-async remediation:
 * the currency restatement (#2468, epic #2452 Phase 5).
 *
 * Endpoints:
 *
 *   POST /analytics/coverage/currency/recalculate — `@Roles('admin')`. Opens an
 *        `analytics_remediation_runs` row and enqueues ONE driver job. Does no
 *        data repair itself.
 *   GET  /analytics/coverage/currency/status/:runId — poll one run's lifecycle.
 *   GET  /analytics/coverage/currency/orders — the paginated affected-order list
 *        behind the mockup's `detail-currency` modal.
 *   POST /analytics/coverage/currency/cancel - `@Roles('admin')`. Recovery path
 *        for a run stranded at `'in-progress'` because its driver job died
 *        before it could terminalise itself (#2816) - see that method's own
 *        doc comment for why this is an explicit operator action rather than a
 *        staleness heuristic.
 *
 * THE REQUEST THREAD NEVER REPAIRS ANYTHING. The repair clears an ADR-040 FX
 * stamp on every affected order and enqueues a stamp job for each; that is
 * unbounded, provider-touching, per-order work whose failure modes are
 * per-order too. Doing it inline would give the operator a request that either
 * times out or lies about having finished, and would leave a half-repaired
 * population with no record of it. The mini-epic states this as an acceptance
 * criterion, and it is also why the ledger row exists.
 *
 * A SIBLING CONTROLLER, NOT A METHOD ON `AnalyticsCoverageController`. That one
 * is a pure aggregate read with no `@Roles`; this one writes, needs `admin`, and
 * composes three tokens the read has no use for. The task issue permits either;
 * keeping the write surface separate is the same split
 * `AnalyticsSettingsController` already draws between its open `GET` and its
 * admin `PUT`, one level up.
 *
 * `IReportingCurrencySettingsService` is resolved once per request and threaded
 * into the count, mirroring `AnalyticsCoverageController`'s own reasoning: the
 * count an operator authorises and the population the run repairs must be
 * measured against the same currency.
 *
 * @module apps/api/src/analytics/http
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ANALYTICS_REMEDIATION_RUN_SERVICE_TOKEN,
  CURRENCY_REMEDIATION_CATEGORY,
  OpenRemediationRunExistsError,
  type IAnalyticsRemediationRunService,
} from '@openlinker/core/analytics';
import {
  REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN,
  type IReportingCurrencySettingsService,
} from '@openlinker/core/currency';
import { ORDER_RECORD_SERVICE_TOKEN, type IOrderRecordService } from '@openlinker/core/orders';
import {
  JOB_ENQUEUE_TOKEN,
  buildAnalyticsCurrencyRecalculateIdempotencyKey,
  type AnalyticsCurrencyRecalculatePayloadV1,
  type JobEnqueuePort,
} from '@openlinker/core/sync';
import { AuthenticatedUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { AnalyticsRemediationRunResponseDto } from './dto/analytics-remediation-run-response.dto';
import { CurrencyRecalculateRequestDto } from './dto/currency-recalculate-request.dto';
import { CurrencyMismatchOrdersQueryDto } from './dto/currency-mismatch-orders-query.dto';
import {
  CurrencyMismatchOrderDto,
  CurrencyMismatchOrdersResponseDto,
} from './dto/currency-mismatch-orders-response.dto';

/** Mirrors `AnalyticsCoverageController`'s bound — see that controller. */
const MAX_COVERAGE_RANGE_DAYS = 400;

const DEFAULT_ORDERS_PAGE_SIZE = 25;

/**
 * The first driver job's step number. Kept as a named constant because the
 * handler's self-reschedule continues the same monotonic sequence, and an
 * off-by-one here would make the API and the first reschedule collide on one
 * TTL-less idempotency key.
 */
const FIRST_DRIVER_STEP = 0;

@ApiBearerAuth()
@ApiTags('analytics')
@Controller('analytics/coverage/currency')
export class AnalyticsRemediationController {
  constructor(
    @Inject(ANALYTICS_REMEDIATION_RUN_SERVICE_TOKEN)
    private readonly runs: IAnalyticsRemediationRunService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecordService: IOrderRecordService,
    @Inject(REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN)
    private readonly reportingCurrencySettings: IReportingCurrencySettingsService,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort
  ) {}

  @Post('recalculate')
  @Roles('admin')
  @ApiOperation({
    summary:
      'Restate every currency-mismatched order in the given window against the current reporting currency',
  })
  @ApiResponse({ status: 201, type: AnalyticsRemediationRunResponseDto })
  async recalculate(
    @Body() body: CurrencyRecalculateRequestDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<AnalyticsRemediationRunResponseDto> {
    const { from, to } = this.parseRange(body.from, body.to);
    const filters = { from, to, sourceConnectionId: body.sourceConnectionId };

    const currentReportingCurrency = await this.reportingCurrencySettings.resolve();
    // One-row page: only `total` is used. The affected list itself is served by
    // the sibling `GET .../orders` route, and enumerating it here would read a
    // page the repair immediately re-reads under its own keyset walk.
    const affected = await this.orderRecordService.getCurrencyMismatchOrders(
      filters,
      currentReportingCurrency,
      { limit: 1, offset: 0 }
    );

    if (affected.total === 0) {
      // Refused rather than resolved-immediately: a run row asserting a repair
      // happened when nothing needed repairing is a false audit record, and the
      // panel's `all-clear` state already covers "nothing to do".
      throw new BadRequestException(
        'No currency-mismatched orders in the requested range; nothing to recalculate'
      );
    }

    let run;
    try {
      run = await this.runs.openRun({
        category: CURRENCY_REMEDIATION_CATEGORY,
        affectedCount: affected.total,
        triggeredByUserId: user.id,
      });
    } catch (error) {
      if (error instanceof OpenRemediationRunExistsError) {
        // 409 rather than returning the existing run: two overlapping
        // restatements would clear and re-enqueue the same orders under two run
        // ids, and the second's completion poll could resolve while the first
        // still had work in flight.
        throw new ConflictException(
          'A currency recalculation is already in progress; wait for it to finish before starting another'
        );
      }
      throw error;
    }

    const payload: AnalyticsCurrencyRecalculatePayloadV1 = {
      schemaVersion: 1,
      runId: run.id,
      from: from.toISOString(),
      to: to.toISOString(),
      sourceConnectionId: body.sourceConnectionId,
      afterOrderId: null,
      pollCount: 0,
      step: FIRST_DRIVER_STEP,
    };

    await this.jobEnqueue.enqueueJob({
      jobType: 'analytics.currency.recalculate',
      // `SyncJob.connectionId` is non-nullable while this run is deliberately
      // cross-connection when the operator did not narrow the panel. The
      // narrowed connection is used when there is one; otherwise the run's real
      // subject is the payload's window and this column is diagnostic, the same
      // interim scaffold `destination.taxonomy.sync` documents (#1943). The
      // nil UUID is honest here in a way that picking one real connection would
      // not be — the column has no FK to `connections` and the handler never
      // reads it except to file its own reschedules under the same value.
      connectionId: body.sourceConnectionId ?? CROSS_CONNECTION_JOB_ID,
      payload: { ...payload },
      idempotencyKey: buildAnalyticsCurrencyRecalculateIdempotencyKey(
        run.id,
        FIRST_DRIVER_STEP
      ),
    });

    return AnalyticsRemediationRunResponseDto.fromView(run);
  }

  @Post('cancel')
  @Roles('admin')
  @ApiOperation({
    summary:
      'Cancel a currency recalculation stranded at in-progress (its driver job died without terminalising it)',
  })
  @ApiResponse({ status: 200, type: AnalyticsRemediationRunResponseDto })
  async cancel(): Promise<AnalyticsRemediationRunResponseDto> {
    const openRun = await this.runs.getOpenRun(CURRENCY_REMEDIATION_CATEGORY);
    if (!openRun) {
      throw new NotFoundException(
        'No currency recalculation is currently in progress; nothing to cancel'
      );
    }

    const cancelled = await this.runs.cancelOpenRun(
      CURRENCY_REMEDIATION_CATEGORY,
      'Cancelled by operator - previous attempt did not resolve'
    );
    if (!cancelled) {
      // Raced with the run resolving/failing on its own between the read
      // above and the conditional transition - nothing is left to cancel.
      throw new NotFoundException(
        'No currency recalculation is currently in progress; nothing to cancel'
      );
    }

    const run = await this.runs.getRun(openRun.id);
    if (!run) {
      throw new NotFoundException(`Remediation run '${openRun.id}' not found`);
    }
    return AnalyticsRemediationRunResponseDto.fromView(run);
  }

  @Get('status/:runId')
  @ApiOperation({ summary: 'Poll one currency remediation run’s lifecycle state' })
  @ApiResponse({ status: 200, type: AnalyticsRemediationRunResponseDto })
  async getStatus(@Param('runId') runId: string): Promise<AnalyticsRemediationRunResponseDto> {
    const run = await this.runs.getRun(runId);
    if (!run) {
      throw new NotFoundException(`Remediation run '${runId}' not found`);
    }
    return AnalyticsRemediationRunResponseDto.fromView(run);
  }

  @Get('orders')
  @ApiOperation({ summary: 'Paginated list of currency-mismatched orders (detail-currency modal)' })
  @ApiResponse({ status: 200, type: CurrencyMismatchOrdersResponseDto })
  async getAffectedOrders(
    @Query() query: CurrencyMismatchOrdersQueryDto
  ): Promise<CurrencyMismatchOrdersResponseDto> {
    const { from, to } = this.parseRange(query.from, query.to);
    const currentReportingCurrency = await this.reportingCurrencySettings.resolve();

    const page = await this.orderRecordService.getCurrencyMismatchOrders(
      { from, to, sourceConnectionId: query.sourceConnectionId },
      currentReportingCurrency,
      { limit: query.limit ?? DEFAULT_ORDERS_PAGE_SIZE, offset: query.offset ?? 0 }
    );

    const response = new CurrencyMismatchOrdersResponseDto();
    response.items = page.items.map((row) => CurrencyMismatchOrderDto.fromRow(row));
    response.total = page.total;
    return response;
  }

  /**
   * Shared range validation. Duplicated from `AnalyticsCoverageController`
   * rather than extracted: both are three lines of DTO-adjacent guard, and a
   * shared helper module for them would be a file whose only reason to exist is
   * that two controllers validate the same two query params.
   */
  private parseRange(fromRaw: string, toRaw: string): { from: Date; to: Date } {
    const from = new Date(fromRaw);
    const to = new Date(toRaw);
    if (to.getTime() <= from.getTime()) {
      throw new BadRequestException('to must be after from');
    }
    const rangeDays = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
    if (rangeDays > MAX_COVERAGE_RANGE_DAYS) {
      throw new BadRequestException(
        `Range too wide: ${Math.ceil(rangeDays)} days exceeds the ${MAX_COVERAGE_RANGE_DAYS}-day limit`
      );
    }
    return { from, to };
  }
}

/**
 * Connection filed against a driver job whose run spans every channel.
 *
 * See the enqueue site for why this is honest rather than a placeholder hack;
 * removable once #1943 makes `SyncJob.connectionId` nullable.
 */
const CROSS_CONNECTION_JOB_ID = '00000000-0000-0000-0000-000000000000';

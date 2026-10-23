/**
 * Order Exports Controller (#3534, D35, mockup M5)
 *
 * `POST /orders/export` opens an `order_exports` run (scoped to the
 * requesting operator and the CURRENT list filters — the same
 * `toOrderRecordFilters` + `enrichCrossContextFilters` pair `GET /orders`
 * uses, so "current view" means exactly the URL filters and sort) and
 * enqueues ONE `orders.export` driver job. `GET /orders/export/:runId`
 * reports the run's own status — `pending | ready | failed`, the direct
 * counterpart of `sync_jobs.status`/`outcome` (ADR-007) for this one-shot
 * job — and `GET /orders/export/:runId/download` serves the file ONLY to
 * the run's own requester or an admin (D35: this is buyer data leaving the
 * system).
 *
 * `@Roles('admin', 'operator')` on every route — a viewer never reaches
 * this controller at all (D35), which is stronger than merely hiding the
 * frontend's Export button.
 *
 * @module apps/api/src/orders/http
 */
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/auth.types';
import {
  ORDER_EXPORT_SERVICE_TOKEN,
  narrowOrderExportColumns,
  type IOrderExportService,
  type OrderExportRun,
} from '@openlinker/core/orders';
import { SHIPMENT_QUERY_SERVICE_TOKEN, type IShipmentQueryService } from '@openlinker/core/shipping';
import { RETURNS_SERVICE_TOKEN, type IReturnsService } from '@openlinker/core/returns';
import { JOB_ENQUEUE_TOKEN, type JobEnqueuePort } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';
import { CreateOrderExportDto } from './dto/create-order-export.dto';
import { OrderExportRunResponseDto } from './dto/order-export-run-response.dto';
import { toOrderRecordFilters, enrichCrossContextFilters } from './orders.controller';

/** Every `orders.export` job runs under this connection scope — it spans every connection a filter set may admit, so there is no single owning connection (the `analytics.currency.recalculate` precedent, #2745). */
const CROSS_CONNECTION_JOB_ID = '00000000-0000-0000-0000-000000000000';

@ApiBearerAuth()
@ApiTags('orders')
@Controller('orders/export')
export class OrderExportsController {
  private readonly logger = new Logger(OrderExportsController.name);

  constructor(
    @Inject(ORDER_EXPORT_SERVICE_TOKEN)
    private readonly exports: IOrderExportService,
    @Inject(SHIPMENT_QUERY_SERVICE_TOKEN)
    private readonly shipmentQuery: IShipmentQueryService,
    @Inject(RETURNS_SERVICE_TOKEN)
    private readonly returnsService: IReturnsService,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort
  ) {}

  @Roles('admin', 'operator')
  @Post()
  @ApiOperation({
    summary:
      'Export the current filtered view (or an explicit order selection) to CSV/XLSX. Enqueues an orders.export job.',
  })
  @ApiResponse({ status: 201, type: OrderExportRunResponseDto })
  async requestExport(
    @Body() dto: CreateOrderExportDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<OrderExportRunResponseDto> {
    const scope = dto.scope ?? 'filtered';
    const baseFilters = toOrderRecordFilters(dto);
    if (dto.placedFrom) baseFilters.placedFrom = new Date(dto.placedFrom);
    if (dto.placedTo) baseFilters.placedTo = new Date(dto.placedTo);

    const filters = await enrichCrossContextFilters(
      baseFilters,
      { search: dto.search, openReturn: dto.openReturn },
      this.shipmentQuery,
      this.returnsService,
      this.logger
    );

    const run = await this.exports.requestExport({
      requestedByUserId: user.id,
      format: dto.format ?? 'csv',
      scope,
      // Serialized for storage — dates become ISO strings so the run's
      // `filters` jsonb round-trips without a custom (de)serializer.
      filters: JSON.parse(JSON.stringify(filters)) as Record<string, unknown>,
      selectedOrderIds: scope === 'selected' ? (dto.selectedOrderIds ?? []) : [],
      columns: narrowOrderExportColumns(dto.columns ?? []),
    });

    await this.jobEnqueue.enqueueJob({
      jobType: 'orders.export',
      connectionId: CROSS_CONNECTION_JOB_ID,
      payload: { schemaVersion: 1, runId: run.id },
      idempotencyKey: `orders.export:${run.id}`,
    });

    return OrderExportRunResponseDto.fromDomain(run);
  }

  @Roles('admin', 'operator')
  @Get(':runId')
  @ApiOperation({ summary: "One export run's status. Only the requester or an admin may read it." })
  @ApiResponse({ status: 200, type: OrderExportRunResponseDto })
  async getRun(
    @Param('runId') runId: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<OrderExportRunResponseDto> {
    const run = await this.loadAuthorized(runId, user);
    return OrderExportRunResponseDto.fromDomain(run);
  }

  @Roles('admin', 'operator')
  @Get(':runId/download')
  @ApiOperation({
    summary: 'Download the generated file. Refuses a run that is not ready, expired, or not one\'s own.',
  })
  async download(
    @Param('runId') runId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response
  ): Promise<void> {
    const run = await this.loadAuthorized(runId, user);
    if (run.status !== 'ready' || !run.file) {
      throw new NotFoundException('This export is not ready yet.');
    }
    if (run.isExpired()) {
      throw new NotFoundException('This export has expired. Request a new one.');
    }
    const buffer = Buffer.from(run.file.contentBase64, 'base64');
    res.setHeader('Content-Type', run.file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${run.file.filename}"`);
    res.send(buffer);
  }

  /** Shared 404-vs-403 resolution: the requester or an admin, else refused. */
  private async loadAuthorized(runId: string, user: AuthenticatedUser): Promise<OrderExportRun> {
    const run = await this.exports.getRun(runId);
    if (!run) {
      throw new NotFoundException(`Export run not found: ${runId}`);
    }
    if (run.requestedByUserId !== user.id && user.role !== 'admin') {
      throw new ForbiddenException('Only the requester or an admin may access this export.');
    }
    return run;
  }
}

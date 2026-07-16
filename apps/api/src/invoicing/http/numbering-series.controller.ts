/**
 * Numbering Series Controller (#9 / #10 / #8)
 *
 * HTTP REST surface for the invoice numbering module: series CRUD (with neutral
 * document-type + optional register scope), per-document-type routing
 * (VAT/KOR/ZAL/ROZ -> series, replacing the pre-v2 main/correction assignment),
 * the orphaned-series list, and the gap-audit read model. Thin interface layer —
 * it injects the core application services (`INumberingSeriesService` +
 * `INumberingAuditService`), NOT the repository port, so the cross-context
 * contract stays on an `I*Service` seam. Pattern validation and periodKey seeding
 * live in the service; the controller only maps domain exceptions to HTTP
 * responses at the boundary.
 *
 * Guards are GLOBAL (auth.module APP_GUARD = JwtAuthGuard then RolesGuard), so we
 * never declare a redundant `@UseGuards(JwtAuthGuard)`. Reads carry no `@Roles`
 * (open to any authenticated role); writes carry `@Roles('admin')` — mirroring
 * the invoicing controller's read-open/write-gated pattern (#1357).
 *
 * Route ordering: the fixed `numbering-series/unassigned` route is declared before
 * the parameterised `numbering-series/:seriesId` so it always matches first.
 *
 * @module apps/api/src/invoicing/http
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  DocumentNumberTooLongException,
  DuplicateDocumentNumberException,
  InvalidNumberingPatternException,
  InvoiceNumberingSeriesNotFoundException,
  MissingNumberingSeriesException,
  NUMBERING_AUDIT_SERVICE_TOKEN,
  NUMBERING_SERIES_SERVICE_TOKEN,
  NumberingGapNoteReasonRequiredException,
  renderInvoiceNumber,
} from '@openlinker/core/invoicing';
// Value imports (not `import type`): the injected service types feed decorator metadata.
import { INumberingAuditService, INumberingSeriesService } from '@openlinker/core/invoicing';
import type {
  InvoiceNumberingSeries,
  ListNumberingSeriesFilter,
  NumberingGapNoteData,
  SeriesAudit,
  SeriesAuditEntry,
  SeriesRouteData,
} from '@openlinker/core/invoicing';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
// Value import (not `import type`): the @CurrentUser() param type feeds decorator metadata.
import { AuthenticatedUser } from '../../auth/auth.types';
import { CreateNumberingSeriesRequestDto } from './dto/create-numbering-series-request.dto';
import { UpdateNumberingSeriesRequestDto } from './dto/update-numbering-series-request.dto';
import {
  NumberingSeriesResponseDto,
  UnassignedNumberingSeriesResponseDto,
} from './dto/numbering-series-response.dto';
import { NumberingRouteResponseDto } from './dto/numbering-route-response.dto';
import { UpsertNumberingRouteRequestDto } from './dto/upsert-numbering-route-request.dto';
import { DeleteNumberingRouteRequestDto } from './dto/delete-numbering-route-request.dto';
import { RecordGapNoteRequestDto } from './dto/record-gap-note-request.dto';
import {
  NumberingGapNoteResponseDto,
  SeriesAuditResponseDto,
} from './dto/numbering-audit-response.dto';
// Type-only: referenced only as a mapper return annotation, never as a decorator value.
import type { SeriesAuditEntryResponseDto } from './dto/numbering-audit-response.dto';

function seriesIdPipe(): ParseUUIDPipe {
  return new ParseUUIDPipe({ version: '4', errorHttpStatusCode: 404 });
}

function connectionIdPipe(): ParseUUIDPipe {
  return new ParseUUIDPipe({ version: '4' });
}

@ApiTags('invoicing')
@ApiBearerAuth()
@Controller('invoicing')
export class NumberingSeriesController {
  constructor(
    @Inject(NUMBERING_SERIES_SERVICE_TOKEN)
    private readonly seriesService: INumberingSeriesService,
    @Inject(NUMBERING_AUDIT_SERVICE_TOKEN)
    private readonly auditService: INumberingAuditService,
  ) {}

  // --- Series CRUD -----------------------------------------------------------

  @Roles('admin')
  @Post('numbering-series')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a numbering series (#9/#10)' })
  @ApiResponse({ status: 201, type: NumberingSeriesResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid pattern / reset-policy coverage' })
  async createSeries(
    @Body() dto: CreateNumberingSeriesRequestDto,
  ): Promise<NumberingSeriesResponseDto> {
    try {
      const created = await this.seriesService.createSeries({
        name: dto.name,
        pattern: dto.pattern,
        nextSeq: dto.nextSeq,
        seqPadding: dto.seqPadding,
        resetPolicy: dto.resetPolicy,
        documentType: dto.documentType,
        register: dto.register ?? null,
      });
      return this.toSeriesResponse(created);
    } catch (error) {
      throw this.mapDomainError(error);
    }
  }

  @Get('numbering-series')
  @ApiOperation({ summary: 'List numbering series (newest first), optionally filtered (#9/#10)' })
  @ApiQuery({ name: 'documentType', required: false, description: 'Filter by neutral document type' })
  @ApiQuery({ name: 'register', required: false, description: 'Filter by register/entity scope' })
  @ApiResponse({ status: 200, type: [NumberingSeriesResponseDto] })
  async listSeries(
    @Query('documentType') documentType?: string,
    @Query('register') register?: string,
  ): Promise<NumberingSeriesResponseDto[]> {
    const filter: ListNumberingSeriesFilter = {};
    if (documentType !== undefined) filter.documentType = documentType;
    if (register !== undefined) filter.register = register;
    const series = await this.seriesService.listSeries(
      Object.keys(filter).length > 0 ? filter : undefined,
    );
    return series.map((s) => this.toSeriesResponse(s));
  }

  @Get('numbering-series/unassigned')
  @ApiOperation({
    summary: 'List orphaned (unrouted) numbering series with their last-issued number (#9/#10)',
  })
  @ApiResponse({ status: 200, type: [UnassignedNumberingSeriesResponseDto] })
  async listUnassignedSeries(): Promise<UnassignedNumberingSeriesResponseDto[]> {
    const series = await this.seriesService.listUnassignedSeries();
    return series.map((s) => this.toUnassignedSeriesResponse(s));
  }

  @Get('numbering-series/:seriesId')
  @ApiOperation({ summary: 'Read a numbering series by id (#9/#10)' })
  @ApiResponse({ status: 200, type: NumberingSeriesResponseDto })
  @ApiResponse({ status: 404, description: 'Series not found' })
  async getSeries(
    @Param('seriesId', seriesIdPipe()) seriesId: string,
  ): Promise<NumberingSeriesResponseDto> {
    const series = await this.seriesService.getSeries(seriesId);
    if (!series) {
      throw new NotFoundException(`Invoice numbering series not found: ${seriesId}`);
    }
    return this.toSeriesResponse(series);
  }

  @Roles('admin')
  @Patch('numbering-series/:seriesId')
  @ApiOperation({ summary: 'Update a numbering series (#9/#10)' })
  @ApiResponse({ status: 200, type: NumberingSeriesResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid pattern / reset-policy coverage' })
  @ApiResponse({ status: 404, description: 'Series not found' })
  async updateSeries(
    @Param('seriesId', seriesIdPipe()) seriesId: string,
    @Body() dto: UpdateNumberingSeriesRequestDto,
  ): Promise<NumberingSeriesResponseDto> {
    try {
      const updated = await this.seriesService.updateSeries(seriesId, {
        name: dto.name,
        pattern: dto.pattern,
        nextSeq: dto.nextSeq,
        seqPadding: dto.seqPadding,
        resetPolicy: dto.resetPolicy,
        documentType: dto.documentType,
        register: dto.register,
      });
      return this.toSeriesResponse(updated);
    } catch (error) {
      throw this.mapDomainError(error);
    }
  }

  // --- Gap-audit (#8) --------------------------------------------------------

  @Get('numbering-series/:seriesId/audit')
  @ApiOperation({ summary: 'Numbering gap-audit read model for a series (#8)' })
  @ApiQuery({ name: 'onlyGaps', required: false, description: 'Return only gap entries when true' })
  @ApiResponse({ status: 200, type: SeriesAuditResponseDto })
  @ApiResponse({ status: 404, description: 'Series not found' })
  async getSeriesAudit(
    @Param('seriesId', seriesIdPipe()) seriesId: string,
    @Query('onlyGaps') onlyGaps?: string,
  ): Promise<SeriesAuditResponseDto> {
    try {
      const audit = await this.auditService.getSeriesAudit(seriesId, {
        onlyGaps: onlyGaps === 'true',
      });
      return this.toAuditResponse(audit);
    } catch (error) {
      throw this.mapDomainError(error);
    }
  }

  @Roles('admin')
  @Post('numbering-series/:seriesId/gap-notes')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record a neutral explanation for a numbering gap (#8)' })
  @ApiResponse({ status: 201, type: NumberingGapNoteResponseDto })
  @ApiResponse({ status: 400, description: 'Empty reason' })
  async recordGapNote(
    @Param('seriesId', seriesIdPipe()) seriesId: string,
    @Body() dto: RecordGapNoteRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NumberingGapNoteResponseDto> {
    try {
      const note = await this.auditService.recordGapNote({
        seriesId,
        seq: dto.seq,
        documentNumber: dto.documentNumber ?? null,
        reason: dto.reason,
        actorUserId: user.id,
      });
      return this.toGapNoteResponse(note);
    } catch (error) {
      throw this.mapDomainError(error);
    }
  }

  // --- Routing (#9 / #10) ----------------------------------------------------

  @Get('connections/:connectionId/numbering-routes')
  @ApiOperation({ summary: "List a connection's document-type numbering routes (#9/#10)" })
  @ApiResponse({ status: 200, type: [NumberingRouteResponseDto] })
  async listRoutes(
    @Param('connectionId', connectionIdPipe()) connectionId: string,
  ): Promise<NumberingRouteResponseDto[]> {
    const routes = await this.seriesService.findRoutesByConnectionId(connectionId);
    return routes.map((r) => this.toRouteResponse(r));
  }

  @Roles('admin')
  @Put('connections/:connectionId/numbering-routes')
  @ApiOperation({ summary: 'Create or replace a document-type numbering route (#9/#10)' })
  @ApiResponse({ status: 200, type: NumberingRouteResponseDto })
  @ApiResponse({ status: 400, description: 'Unknown series or invalid document type' })
  async upsertRoute(
    @Param('connectionId', connectionIdPipe()) connectionId: string,
    @Body() dto: UpsertNumberingRouteRequestDto,
  ): Promise<NumberingRouteResponseDto> {
    if (!(await this.seriesService.seriesExists(dto.seriesId))) {
      throw new BadRequestException(
        `seriesId references an unknown numbering series: ${dto.seriesId}`,
      );
    }
    const route = await this.seriesService.upsertRoute({
      connectionId,
      documentType: dto.documentType,
      register: dto.register ?? null,
      seriesId: dto.seriesId,
    });
    return this.toRouteResponse(route);
  }

  @Roles('admin')
  @Delete('connections/:connectionId/numbering-routes')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Detach a document-type numbering route (the series survives) (#9/#10)' })
  @ApiResponse({ status: 204, description: 'Route detached (no-op when none existed)' })
  async deleteRoute(
    @Param('connectionId', connectionIdPipe()) connectionId: string,
    @Body() dto: DeleteNumberingRouteRequestDto,
  ): Promise<void> {
    await this.seriesService.deleteRoute(connectionId, dto.documentType, dto.register ?? null);
  }

  // --- Mapping helpers -------------------------------------------------------

  /** Map invoicing numbering domain exceptions to HTTP responses at the boundary. */
  private mapDomainError(error: unknown): Error {
    if (error instanceof InvalidNumberingPatternException) {
      return new BadRequestException({ message: error.message, errors: error.issues });
    }
    if (error instanceof InvoiceNumberingSeriesNotFoundException) {
      return new NotFoundException(error.message);
    }
    if (error instanceof MissingNumberingSeriesException) {
      return new BadRequestException(error.message);
    }
    if (error instanceof NumberingGapNoteReasonRequiredException) {
      return new BadRequestException(error.message);
    }
    if (error instanceof DocumentNumberTooLongException) {
      return new BadRequestException(error.message);
    }
    if (error instanceof DuplicateDocumentNumberException) {
      return new ConflictException(error.message);
    }
    return error instanceof Error ? error : new Error(String(error));
  }

  private toSeriesResponse(series: InvoiceNumberingSeries): NumberingSeriesResponseDto {
    return {
      id: series.id,
      name: series.name,
      pattern: series.pattern,
      nextSeq: series.nextSeq,
      seqPadding: series.seqPadding,
      resetPolicy: series.resetPolicy,
      documentType: series.documentType,
      register: series.register,
      periodKey: series.periodKey,
      createdAt: series.createdAt.toISOString(),
      updatedAt: series.updatedAt.toISOString(),
    };
  }

  private toUnassignedSeriesResponse(
    series: InvoiceNumberingSeries,
  ): UnassignedNumberingSeriesResponseDto {
    const lastIssuedSeq = series.nextSeq > 1 ? series.nextSeq - 1 : null;
    const lastIssuedNumberPreview =
      lastIssuedSeq === null
        ? null
        : renderInvoiceNumber(series.pattern, {
            seq: lastIssuedSeq,
            seqPadding: series.seqPadding,
            issueDate: series.updatedAt,
          });
    return {
      ...this.toSeriesResponse(series),
      lastIssuedSeq,
      lastIssuedNumberPreview,
    };
  }

  private toRouteResponse(route: SeriesRouteData): NumberingRouteResponseDto {
    return {
      connectionId: route.connectionId,
      documentType: route.documentType,
      register: route.register,
      seriesId: route.seriesId,
      createdAt: route.createdAt.toISOString(),
      updatedAt: route.updatedAt.toISOString(),
    };
  }

  private toAuditResponse(audit: SeriesAudit): SeriesAuditResponseDto {
    return {
      seriesId: audit.seriesId,
      seriesName: audit.seriesName,
      skippedInferenceApplied: audit.skippedInferenceApplied,
      summary: { ...audit.summary },
      entries: audit.entries.map((e) => this.toAuditEntryResponse(e)),
    };
  }

  private toAuditEntryResponse(entry: SeriesAuditEntry): SeriesAuditEntryResponseDto {
    return {
      seq: entry.seq,
      status: entry.status,
      isGap: entry.isGap,
      documentNumber: entry.documentNumber,
      recordId: entry.recordId,
      orderId: entry.orderId,
      issuedAt: entry.issuedAt?.toISOString() ?? null,
      createdAt: entry.createdAt?.toISOString() ?? null,
      updatedAt: entry.updatedAt?.toISOString() ?? null,
      note: entry.note ? this.toGapNoteResponse(entry.note) : null,
    };
  }

  private toGapNoteResponse(note: NumberingGapNoteData): NumberingGapNoteResponseDto {
    return {
      id: note.id,
      seriesId: note.seriesId,
      seq: note.seq,
      documentNumber: note.documentNumber,
      reason: note.reason,
      actorUserId: note.actorUserId,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
    };
  }
}

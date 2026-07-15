/**
 * Numbering Series Controller (#1576, C2)
 *
 * HTTP REST surface for the invoice numbering-series module: series CRUD,
 * connection assignment (attach / detach / read), and the orphaned-series list
 * that backs the C3 re-attach flow. Thin interface layer — delegates to the C1
 * `InvoiceNumberingSeriesRepositoryPort` and the pure C1 domain helpers
 * (`assertValidNumberingPattern`, `computePeriodKey`, `renderInvoiceNumber`).
 * NO numbering/allocation domain logic lives here (that shipped in C1); the
 * controller only maps C1 domain exceptions to HTTP responses at the boundary.
 *
 * Guards are GLOBAL (auth.module APP_GUARD = JwtAuthGuard then RolesGuard), so we
 * never declare a redundant `@UseGuards(JwtAuthGuard)`. Reads carry no `@Roles`
 * (open to any authenticated role); writes carry `@Roles('admin')` — mirroring
 * the invoicing controller's read-open/write-gated pattern (#1357).
 *
 * Route ordering: the fixed `numbering-series/unassigned` route is declared
 * before the parameterised `numbering-series/:seriesId` so it always matches
 * first.
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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  assertValidNumberingPattern,
  computePeriodKey,
  CORRECTION_NUMBERING_DOCUMENT_TYPE,
  DEFAULT_NUMBERING_DOCUMENT_TYPE,
  DuplicateDocumentNumberException,
  INVOICE_NUMBERING_SERIES_REPOSITORY_TOKEN,
  InvalidNumberingPatternException,
  InvoiceNumberingSeriesNotFoundException,
  MissingNumberingSeriesException,
  renderInvoiceNumber,
} from '@openlinker/core/invoicing';
// Value import (not `import type`): the injected port type feeds decorator metadata.
import { InvoiceNumberingSeriesRepositoryPort } from '@openlinker/core/invoicing';
import type {
  InvoiceNumberingSeries,
  SeriesRouteData,
  UpdateInvoiceNumberingSeriesInput,
} from '@openlinker/core/invoicing';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CreateNumberingSeriesRequestDto } from './dto/create-numbering-series-request.dto';
import { UpdateNumberingSeriesRequestDto } from './dto/update-numbering-series-request.dto';
import {
  NumberingSeriesResponseDto,
  UnassignedNumberingSeriesResponseDto,
} from './dto/numbering-series-response.dto';
import { SetNumberingAssignmentRequestDto } from './dto/set-numbering-assignment-request.dto';
import { NumberingAssignmentResponseDto } from './dto/numbering-assignment-response.dto';

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
    @Inject(INVOICE_NUMBERING_SERIES_REPOSITORY_TOKEN)
    private readonly repository: InvoiceNumberingSeriesRepositoryPort,
  ) {}

  @Roles('admin')
  @Post('numbering-series')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a numbering series (#1576)' })
  @ApiResponse({ status: 201, type: NumberingSeriesResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid pattern / reset-policy coverage' })
  async createSeries(
    @Body() dto: CreateNumberingSeriesRequestDto,
  ): Promise<NumberingSeriesResponseDto> {
    this.assertPattern(dto.pattern, dto.resetPolicy);
    // Seed periodKey so the first allocation honours the configured nextSeq under
    // the chosen reset cadence (C1 contract).
    const periodKey = computePeriodKey(dto.resetPolicy, new Date());
    // COMPAT SHIM (core-numbering-v2): the C2 create DTO has no documentType /
    // register field yet (the API wave adds them). Default to the neutral base
    // type + register-less scope so the pre-v2 behaviour is preserved.
    const created = await this.repository.createSeries({
      name: dto.name,
      pattern: dto.pattern,
      nextSeq: dto.nextSeq,
      seqPadding: dto.seqPadding,
      resetPolicy: dto.resetPolicy,
      periodKey,
      documentType: DEFAULT_NUMBERING_DOCUMENT_TYPE,
      register: null,
    });
    return this.toSeriesResponse(created);
  }

  @Get('numbering-series')
  @ApiOperation({ summary: 'List all numbering series (newest first) (#1576)' })
  @ApiResponse({ status: 200, type: [NumberingSeriesResponseDto] })
  async listSeries(): Promise<NumberingSeriesResponseDto[]> {
    const series = await this.repository.listSeries();
    return series.map((s) => this.toSeriesResponse(s));
  }

  @Get('numbering-series/unassigned')
  @ApiOperation({
    summary: 'List orphaned (unassigned) numbering series with their last-issued number (#1576)',
  })
  @ApiResponse({ status: 200, type: [UnassignedNumberingSeriesResponseDto] })
  async listUnassignedSeries(): Promise<UnassignedNumberingSeriesResponseDto[]> {
    const series = await this.repository.listUnassignedSeries();
    return series.map((s) => this.toUnassignedSeriesResponse(s));
  }

  @Get('numbering-series/:seriesId')
  @ApiOperation({ summary: 'Read a numbering series by id (#1576)' })
  @ApiResponse({ status: 200, type: NumberingSeriesResponseDto })
  @ApiResponse({ status: 404, description: 'Series not found' })
  async getSeries(
    @Param('seriesId', seriesIdPipe()) seriesId: string,
  ): Promise<NumberingSeriesResponseDto> {
    const series = await this.repository.findSeriesById(seriesId);
    if (!series) {
      throw new NotFoundException(`Invoice numbering series not found: ${seriesId}`);
    }
    return this.toSeriesResponse(series);
  }

  @Roles('admin')
  @Patch('numbering-series/:seriesId')
  @ApiOperation({ summary: 'Update a numbering series (#1576)' })
  @ApiResponse({ status: 200, type: NumberingSeriesResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid pattern / reset-policy coverage' })
  @ApiResponse({ status: 404, description: 'Series not found' })
  async updateSeries(
    @Param('seriesId', seriesIdPipe()) seriesId: string,
    @Body() dto: UpdateNumberingSeriesRequestDto,
  ): Promise<NumberingSeriesResponseDto> {
    const existing = await this.repository.findSeriesById(seriesId);
    if (!existing) {
      throw new NotFoundException(`Invoice numbering series not found: ${seriesId}`);
    }

    const patch: UpdateInvoiceNumberingSeriesInput = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.pattern !== undefined) patch.pattern = dto.pattern;
    if (dto.nextSeq !== undefined) patch.nextSeq = dto.nextSeq;
    if (dto.seqPadding !== undefined) patch.seqPadding = dto.seqPadding;
    if (dto.resetPolicy !== undefined) patch.resetPolicy = dto.resetPolicy;

    // Re-validate the EFFECTIVE (merged) pattern + reset policy whenever either
    // changes — otherwise a valid pattern could be paired with an incompatible
    // reset cadence and re-render an already-issued number.
    if (patch.pattern !== undefined || patch.resetPolicy !== undefined) {
      const effectivePattern = patch.pattern ?? existing.pattern;
      const effectivePolicy = patch.resetPolicy ?? existing.resetPolicy;
      this.assertPattern(effectivePattern, effectivePolicy);
      // Reset policy changed → re-seed periodKey to the new cadence's current
      // period so the next allocation's rollover detection stays coherent.
      if (patch.resetPolicy !== undefined && patch.resetPolicy !== existing.resetPolicy) {
        patch.periodKey = computePeriodKey(patch.resetPolicy, new Date());
      }
    }

    try {
      const updated = await this.repository.updateSeries(seriesId, patch);
      return this.toSeriesResponse(updated);
    } catch (error) {
      throw this.mapDomainError(error);
    }
  }

  @Get('connections/:connectionId/numbering-assignment')
  @ApiOperation({ summary: "Read a connection's current numbering assignment (#1576)" })
  @ApiResponse({ status: 200, type: NumberingAssignmentResponseDto })
  @ApiResponse({ status: 404, description: 'No assignment configured for the connection' })
  async getAssignment(
    @Param('connectionId', connectionIdPipe()) connectionId: string,
  ): Promise<NumberingAssignmentResponseDto> {
    // COMPAT SHIM (core-numbering-v2): project the register-less `invoice` +
    // `corrected` routes back onto the pre-v2 main/correction assignment shape.
    const routes = await this.repository.findRoutesByConnectionId(connectionId);
    const main = this.findDefaultRoute(routes, DEFAULT_NUMBERING_DOCUMENT_TYPE);
    if (!main) {
      throw new NotFoundException(
        `No numbering assignment configured for connection ${connectionId}`,
      );
    }
    const correction = this.findDefaultRoute(routes, CORRECTION_NUMBERING_DOCUMENT_TYPE);
    return this.toAssignmentResponse(connectionId, main, correction?.seriesId ?? null);
  }

  @Roles('admin')
  @Put('connections/:connectionId/numbering-assignment')
  @ApiOperation({
    summary: 'Attach / replace a connection numbering assignment (main + optional correction) (#1576)',
  })
  @ApiResponse({ status: 200, type: NumberingAssignmentResponseDto })
  @ApiResponse({ status: 400, description: 'Referenced series does not exist' })
  async setAssignment(
    @Param('connectionId', connectionIdPipe()) connectionId: string,
    @Body() dto: SetNumberingAssignmentRequestDto,
  ): Promise<NumberingAssignmentResponseDto> {
    await this.assertSeriesExists(dto.mainSeriesId, 'mainSeriesId');
    const correctionSeriesId = dto.correctionSeriesId ?? null;
    if (correctionSeriesId !== null) {
      await this.assertSeriesExists(correctionSeriesId, 'correctionSeriesId');
    }

    // COMPAT SHIM (core-numbering-v2): the main series → register-less `invoice`
    // route, the correction series → register-less `corrected` route (detached
    // when none is supplied), preserving the pre-v2 attach/replace semantics.
    const main = await this.repository.upsertRoute({
      connectionId,
      documentType: DEFAULT_NUMBERING_DOCUMENT_TYPE,
      register: null,
      seriesId: dto.mainSeriesId,
    });
    if (correctionSeriesId !== null) {
      await this.repository.upsertRoute({
        connectionId,
        documentType: CORRECTION_NUMBERING_DOCUMENT_TYPE,
        register: null,
        seriesId: correctionSeriesId,
      });
    } else {
      await this.repository.deleteRoute(connectionId, CORRECTION_NUMBERING_DOCUMENT_TYPE, null);
    }
    return this.toAssignmentResponse(connectionId, main, correctionSeriesId);
  }

  @Roles('admin')
  @Delete('connections/:connectionId/numbering-assignment')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Detach a connection's numbering assignment (the series survive) (#1576)",
  })
  @ApiResponse({ status: 204, description: 'Assignment detached (no-op when none existed)' })
  async detachAssignment(
    @Param('connectionId', connectionIdPipe()) connectionId: string,
  ): Promise<void> {
    // COMPAT SHIM (core-numbering-v2): detach both register-less default routes
    // the pre-v2 assignment mapped to. Each delete is a no-op when absent.
    await this.repository.deleteRoute(connectionId, DEFAULT_NUMBERING_DOCUMENT_TYPE, null);
    await this.repository.deleteRoute(connectionId, CORRECTION_NUMBERING_DOCUMENT_TYPE, null);
  }

  /** Register-less default route for a document type (the pre-v2 assignment target). */
  private findDefaultRoute(
    routes: SeriesRouteData[],
    documentType: string,
  ): SeriesRouteData | undefined {
    return routes.find((r) => r.documentType === documentType && r.register === null);
  }

  private assertPattern(pattern: string, resetPolicy: Parameters<typeof assertValidNumberingPattern>[1]): void {
    try {
      assertValidNumberingPattern(pattern, resetPolicy);
    } catch (error) {
      throw this.mapDomainError(error);
    }
  }

  private async assertSeriesExists(seriesId: string, field: string): Promise<void> {
    const series = await this.repository.findSeriesById(seriesId);
    if (!series) {
      throw new BadRequestException(`${field} references an unknown numbering series: ${seriesId}`);
    }
  }

  /** Map C1 numbering domain exceptions to HTTP responses at the boundary. */
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

  private toAssignmentResponse(
    connectionId: string,
    mainRoute: SeriesRouteData,
    correctionSeriesId: string | null,
  ): NumberingAssignmentResponseDto {
    // Timestamps come from the main (`invoice`) route — the pre-v2 assignment
    // aggregate had a single created/updated pair keyed by connection.
    return {
      connectionId,
      mainSeriesId: mainRoute.seriesId,
      correctionSeriesId,
      createdAt: mainRoute.createdAt.toISOString(),
      updatedAt: mainRoute.updatedAt.toISOString(),
    };
  }
}

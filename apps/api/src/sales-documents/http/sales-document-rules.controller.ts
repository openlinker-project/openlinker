/**
 * Sales-Document Rules Controller (#2170)
 *
 * HTTP surface for the country-agnostic rule engine's CRUD: rules,
 * country defaults, and a read-only threshold list (thresholds are seeded by
 * migration for the Poland template today — no write endpoint yet since no
 * FE flow authors a new one this issue). Admin + JWT (global guard), mirrors
 * `FulfillmentRoutingController`.
 *
 * The connection-capability check happens HERE, via
 * `SalesDocumentCapabilityGuardService`, BEFORE delegating to the core
 * `ISalesDocumentRulesService` — see that guard's own doc comment for why it
 * is not injected into `libs/core/src/sales-documents` instead.
 *
 * @module apps/api/src/sales-documents/http
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
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  type ISalesDocumentRulesService,
  SALES_DOCUMENT_RULES_SERVICE_TOKEN,
  SalesDocumentCountryDefaultNotFoundException,
  SalesDocumentRuleConflictException,
  SalesDocumentRuleNotFoundException,
  SalesDocumentThresholdNotFoundException,
} from '@openlinker/core/sales-documents';
import { CreateSalesDocumentRuleDto } from './dto/create-sales-document-rule.dto';
import { SalesDocumentConditionDto } from './dto/sales-document-condition.dto';
import { SalesDocumentRuleResponseDto } from './dto/sales-document-rule-response.dto';
import { UpsertSalesDocumentCountryDefaultDto } from './dto/upsert-sales-document-country-default.dto';
import { SalesDocumentCountryDefaultResponseDto } from './dto/sales-document-country-default-response.dto';
import { SalesDocumentThresholdResponseDto } from './dto/sales-document-threshold-response.dto';
import { SalesDocumentCapabilityGuardService } from '../sales-document-capability-guard.service';

@Roles('admin')
@ApiBearerAuth()
@ApiTags('sales-documents')
@Controller('sales-documents')
export class SalesDocumentRulesController {
  constructor(
    @Inject(SALES_DOCUMENT_RULES_SERVICE_TOKEN)
    private readonly service: ISalesDocumentRulesService,
    private readonly capabilityGuard: SalesDocumentCapabilityGuardService,
  ) {}

  @Get('rules')
  @ApiOperation({ summary: 'List sales-document rules for one country (or Rest of world, "*")' })
  @ApiQuery({ name: 'country', required: true })
  @ApiResponse({ status: 200, type: [SalesDocumentRuleResponseDto] })
  async listRules(@Query('country') country: string): Promise<SalesDocumentRuleResponseDto[]> {
    const rules = await this.service.listRules(country);
    return rules.map((rule) => SalesDocumentRuleResponseDto.fromDomain(rule));
  }

  @Post('rules')
  @ApiOperation({ summary: 'Create a sales-document rule' })
  @ApiResponse({ status: 201, type: SalesDocumentRuleResponseDto })
  @ApiResponse({ status: 400, description: 'Unknown threshold ref, or connection lacks the required capability' })
  @ApiResponse({ status: 409, description: 'Conflicts with an existing rule (same conditions, different connection, overlapping period)' })
  async createRule(@Body() dto: CreateSalesDocumentRuleDto): Promise<SalesDocumentRuleResponseDto> {
    await this.capabilityGuard.assertConnectionSupportsKind(dto.connectionId, dto.documentKind);
    try {
      const rule = await this.service.createRule({
        country: dto.country,
        conditions: dto.conditions.map((c) => SalesDocumentConditionDto.toDomain(c)),
        documentKind: dto.documentKind,
        connectionId: dto.connectionId,
        effectiveFrom: new Date(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
        provenance: dto.provenance ?? null,
      });
      return SalesDocumentRuleResponseDto.fromDomain(rule);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  @Delete('rules/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a sales-document rule' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  async deleteRule(@Param('id') id: string): Promise<void> {
    try {
      await this.service.deleteRule(id);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  @Get('country-defaults')
  @ApiOperation({ summary: 'List sales-document country defaults for one country (or "*")' })
  @ApiQuery({ name: 'country', required: true })
  @ApiResponse({ status: 200, type: [SalesDocumentCountryDefaultResponseDto] })
  async listCountryDefaults(
    @Query('country') country: string,
  ): Promise<SalesDocumentCountryDefaultResponseDto[]> {
    const defaults = await this.service.listCountryDefaults(country);
    return defaults.map((d) => SalesDocumentCountryDefaultResponseDto.fromDomain(d));
  }

  @Post('country-defaults')
  @ApiOperation({ summary: 'Set (insert or replace) a country default for one document kind' })
  @ApiResponse({ status: 201, type: SalesDocumentCountryDefaultResponseDto })
  @ApiResponse({ status: 400, description: 'Connection lacks the required capability' })
  async upsertCountryDefault(
    @Body() dto: UpsertSalesDocumentCountryDefaultDto,
  ): Promise<SalesDocumentCountryDefaultResponseDto> {
    await this.capabilityGuard.assertConnectionSupportsKind(dto.connectionId, dto.documentKind);
    const countryDefault = await this.service.upsertCountryDefault({
      country: dto.country,
      documentKind: dto.documentKind,
      connectionId: dto.connectionId,
    });
    return SalesDocumentCountryDefaultResponseDto.fromDomain(countryDefault);
  }

  @Delete('country-defaults/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a sales-document country default' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, description: 'Default not found' })
  async deleteCountryDefault(@Param('id') id: string): Promise<void> {
    try {
      await this.service.deleteCountryDefault(id);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  @Get('thresholds')
  @ApiOperation({ summary: 'List every sales-document threshold ("regime pack") — read-only' })
  @ApiResponse({ status: 200, type: [SalesDocumentThresholdResponseDto] })
  async listThresholds(): Promise<SalesDocumentThresholdResponseDto[]> {
    const thresholds = await this.service.listThresholds();
    return thresholds.map((t) => SalesDocumentThresholdResponseDto.fromDomain(t));
  }

  private toHttpException(error: unknown): Error {
    if (error instanceof SalesDocumentRuleConflictException) {
      return new ConflictException(error.message);
    }
    if (error instanceof SalesDocumentThresholdNotFoundException) {
      return new BadRequestException(error.message);
    }
    if (
      error instanceof SalesDocumentRuleNotFoundException ||
      error instanceof SalesDocumentCountryDefaultNotFoundException
    ) {
      return new NotFoundException(error.message);
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}

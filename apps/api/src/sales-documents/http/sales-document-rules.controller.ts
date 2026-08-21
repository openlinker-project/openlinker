/**
 * Sales-Document Rules Controller (#2170, #2186)
 *
 * HTTP surface for the country-agnostic rule engine's CRUD: rules,
 * country defaults, and a read-only threshold list (thresholds are seeded by
 * migration for the Poland template today — no write endpoint yet since no
 * FE flow authors a new one this issue). Admin + JWT (global guard), mirrors
 * `FulfillmentRoutingController`. Also the countries-listing read + the
 * per-country "no document, by design" acknowledgment lifecycle (#2186).
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
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  type ISalesDocumentRulesService,
  SALES_DOCUMENT_RULES_SERVICE_TOKEN,
  SalesDocumentCountryAlreadyConfiguredException,
  SalesDocumentCountryDefaultNotFoundException,
  SalesDocumentInvalidConditionException,
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
import { SalesDocumentCountrySummaryResponseDto } from './dto/sales-document-country-summary-response.dto';
import { SalesDocumentCountryAcknowledgmentResponseDto } from './dto/sales-document-country-acknowledgment-response.dto';
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
    this.assertValidCountryParam(country);
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
    this.assertValidCountryParam(country);
    const defaults = await this.service.listCountryDefaults(country);
    return defaults.map((d) => SalesDocumentCountryDefaultResponseDto.fromDomain(d));
  }

  // PUT, not POST (review, optional improvements): this is an idempotent
  // insert-or-replace keyed on `(country, documentKind)`, exactly like the
  // structurally identical `acknowledgeNoDocument` a few lines below, which
  // already uses PUT.
  @Put('country-defaults')
  @ApiOperation({ summary: 'Set (insert or replace) a country default for one document kind' })
  @ApiResponse({ status: 200, type: SalesDocumentCountryDefaultResponseDto })
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

  @Get('countries')
  @ApiOperation({
    summary:
      'List every country carrying any rule, country default, or no-document acknowledgment (#2186)',
  })
  @ApiResponse({ status: 200, type: [SalesDocumentCountrySummaryResponseDto] })
  async listConfiguredCountries(): Promise<SalesDocumentCountrySummaryResponseDto[]> {
    const summaries = await this.service.listConfiguredCountries();
    return summaries.map((summary) => SalesDocumentCountrySummaryResponseDto.fromDomain(summary));
  }

  @Put('countries/:country/acknowledgment')
  @ApiOperation({
    summary: 'Acknowledge that a country intentionally has no sales document configured (#2186)',
  })
  @ApiParam({ name: 'country', type: String })
  @ApiResponse({ status: 200, type: SalesDocumentCountryAcknowledgmentResponseDto })
  @ApiResponse({ status: 409, description: 'Country already has an active rule or country default' })
  async acknowledgeNoDocument(
    @Param('country') country: string,
  ): Promise<SalesDocumentCountryAcknowledgmentResponseDto> {
    this.assertValidCountryParam(country);
    try {
      const acknowledgment = await this.service.acknowledgeNoDocument(country);
      return SalesDocumentCountryAcknowledgmentResponseDto.fromDomain(acknowledgment);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  @Delete('countries/:country/acknowledgment')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Clear a country no-document acknowledgment (#2186)' })
  @ApiParam({ name: 'country', type: String })
  @ApiResponse({ status: 204 })
  async clearAcknowledgment(@Param('country') country: string): Promise<void> {
    this.assertValidCountryParam(country);
    await this.service.clearAcknowledgment(country);
  }

  /**
   * `sales_document_country_acknowledgments.country` (and its sibling rule /
   * default tables) is `varchar(8)` — a bare, unvalidated path param would
   * otherwise surface an oversized value as a raw DB error (500) rather than
   * a clean 400.
   */
  private assertValidCountryParam(country: string): void {
    if (country.length < 1 || country.length > 8) {
      throw new BadRequestException(
        `'country' must be between 1 and 8 characters (ISO 3166-1 alpha-2, or '*' for Rest of world).`,
      );
    }
  }

  private toHttpException(error: unknown): Error {
    if (error instanceof SalesDocumentRuleConflictException) {
      return new ConflictException(error.message);
    }
    if (error instanceof SalesDocumentCountryAlreadyConfiguredException) {
      return new ConflictException(error.message);
    }
    if (
      error instanceof SalesDocumentThresholdNotFoundException ||
      error instanceof SalesDocumentInvalidConditionException
    ) {
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

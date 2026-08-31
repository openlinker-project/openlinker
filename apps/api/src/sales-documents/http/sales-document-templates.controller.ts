/**
 * Sales-Document Templates Controller (#2170)
 *
 * The Poland-only "Review & adopt" flow. `GET .../templates/:country`
 * previews the curated starter template (404 when the country has none —
 * every country but Poland, today); `POST .../templates/:country/adopt`
 * resolves the operator's per-slot connection picks into real rule rows via
 * the SAME `createRule` path every other rule takes (full conflict guard +
 * capability check included), tagged with the template's provenance string
 * so the adopted rows carry the quiet "from: PL starter template" audit tag
 * the mockup describes — never a "managed by OpenLinker" lock.
 *
 * @module apps/api/src/sales-documents/http
 */
import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  type ISalesDocumentRulesService,
  SALES_DOCUMENT_RULES_SERVICE_TOKEN,
} from '@openlinker/core/sales-documents';
import {
  getSalesDocumentStarterTemplate,
  listSalesDocumentTemplateCountries,
  SALES_DOCUMENT_TEMPLATE_PROVENANCE_BY_COUNTRY,
  type SalesDocumentTemplateSummary,
} from '../data/sales-document-template-catalogue';
import { AdoptSalesDocumentTemplateDto } from './dto/adopt-sales-document-template.dto';
import { SalesDocumentRuleResponseDto } from './dto/sales-document-rule-response.dto';
import { SalesDocumentCapabilityGuardService } from '../sales-document-capability-guard.service';

@Roles('admin')
@ApiBearerAuth()
@ApiTags('sales-documents')
@Controller('sales-documents/templates')
export class SalesDocumentTemplatesController {
  constructor(
    @Inject(SALES_DOCUMENT_RULES_SERVICE_TOKEN)
    private readonly service: ISalesDocumentRulesService,
    private readonly capabilityGuard: SalesDocumentCapabilityGuardService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List every market a curated starter template exists for',
    description:
      'The catalogue, as data. A country missing from this list has no researched guidance, which a ' +
      'surface may state as such rather than offering a recommendation it cannot back. Poland is the ' +
      'only entry today. Read-only: listing the catalogue creates no rule and no routing, and nothing ' +
      'is applied until the operator adopts a template explicitly.',
  })
  @ApiResponse({ status: 200 })
  listTemplates(): { countries: SalesDocumentTemplateSummary[] } {
    return { countries: listSalesDocumentTemplateCountries() };
  }

  @Get(':country')
  @ApiOperation({ summary: 'Preview the curated starter template for one country, if any exists' })
  @ApiParam({ name: 'country', type: String })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: 'No curated template for this country' })
  getTemplate(@Param('country') country: string): {
    country: string;
    sourceLabel: string;
    sourceUrl: string;
    disclaimer: string;
    rules: readonly {
      slot: string;
      label: string;
      documentKind: string;
      requiredCapability: string;
      effectiveFrom: string;
      effectiveTo: string | null;
      /**
       * Whether this rule's conditions reference `buyerHasTaxId` — the FE
       * "Review & adopt" screen uses it to warn that the rule cannot match a
       * real order yet (review finding 4: `Order` carries no buyer-tax-id
       * field). Computed here rather than exposing raw `conditions` to the
       * FE, which has no other use for that shape.
       */
      usesBuyerHasTaxId: boolean;
    }[];
  } {
    const template = getSalesDocumentStarterTemplate(country);
    if (template === null) {
      throw new NotFoundException(`No curated sales-document starter template for '${country}'.`);
    }
    return {
      country: template.country,
      sourceLabel: template.sourceLabel,
      sourceUrl: template.sourceUrl,
      disclaimer: template.disclaimer,
      rules: template.rules.map((rule) => ({
        slot: rule.slot,
        label: rule.label,
        documentKind: rule.documentKind,
        requiredCapability: rule.requiredCapability,
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        usesBuyerHasTaxId: rule.conditions.some((condition) => condition.field === 'buyerHasTaxId'),
      })),
    };
  }

  @Post(':country/adopt')
  @ApiOperation({ summary: 'Adopt the starter template, writing ordinary editable rule rows' })
  @ApiParam({ name: 'country', type: String })
  @ApiResponse({ status: 201, type: [SalesDocumentRuleResponseDto] })
  @ApiResponse({ status: 400, description: 'Unknown slot, missing selection, or capability mismatch' })
  @ApiResponse({ status: 404, description: 'No curated template for this country' })
  async adoptTemplate(
    @Param('country') country: string,
    @Body() dto: AdoptSalesDocumentTemplateDto,
  ): Promise<SalesDocumentRuleResponseDto[]> {
    const template = getSalesDocumentStarterTemplate(country);
    if (template === null) {
      throw new NotFoundException(`No curated sales-document starter template for '${country}'.`);
    }
    const provenance = SALES_DOCUMENT_TEMPLATE_PROVENANCE_BY_COUNTRY[template.country] ?? null;
    const selectionBySlot = new Map(dto.selections.map((s) => [s.slot, s.connectionId] as const));

    const created: SalesDocumentRuleResponseDto[] = [];
    for (const templateRule of template.rules) {
      const connectionId = selectionBySlot.get(templateRule.slot);
      if (connectionId === undefined) {
        throw new BadRequestException(`Missing a connection selection for slot '${templateRule.slot}'.`);
      }
      await this.capabilityGuard.assertConnectionSupportsKind(connectionId, templateRule.documentKind);
      const rule = await this.service.createRule({
        country: template.country,
        conditions: templateRule.conditions.map((condition) =>
          condition.field === 'orderTotalGross'
            ? {
                field: 'orderTotalGross' as const,
                op: condition.op as 'gte' | 'lt',
                thresholdRef: condition.thresholdRef ?? '',
              }
            : condition.field === 'buyerHasTaxId'
              ? { field: 'buyerHasTaxId' as const, op: 'eq' as const, value: Boolean(condition.value) }
              : { field: 'orderCountry' as const, op: 'eq' as const, value: String(condition.value ?? '') },
        ),
        documentKind: templateRule.documentKind,
        connectionId,
        effectiveFrom: new Date(templateRule.effectiveFrom),
        effectiveTo: templateRule.effectiveTo ? new Date(templateRule.effectiveTo) : null,
        provenance,
      });
      created.push(SalesDocumentRuleResponseDto.fromDomain(rule));
    }
    return created;
  }
}

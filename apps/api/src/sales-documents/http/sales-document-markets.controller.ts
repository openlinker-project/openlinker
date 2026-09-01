/**
 * Sales-Document Markets Controller (#2518, ADR-066)
 *
 * The market-discovery read: which countries the operator's orders arrive
 * from, with their order counts over a window, so an unconfigured market is
 * visible before somebody discovers it through missing documents.
 *
 * A READ, and only a read. It creates no rule, no country default and no
 * routing - auto-applying a template on detection would be a legal act taken
 * on the operator's behalf, which ADR-041 forbids and ADR-066 rejects
 * outright. Nothing on this controller writes.
 *
 * It is a separate controller from `SalesDocumentRulesController` despite
 * sharing the `sales-documents` prefix: that one is rule-engine CRUD against
 * the sales-document store, this is one derived read against the ORDERS store,
 * reached through `IOrderRecordService` (never a repository port across a
 * context boundary, per architecture-overview.md).
 *
 * Admin-guarded like its neighbour rather than merely authenticated: the only
 * consumer is `/settings/sales-documents`, which is admin-only in full, and a
 * looser guard here would publish the operator's market distribution to every
 * authenticated user for no gain.
 *
 * @module apps/api/src/sales-documents/http
 * @see docs/architecture/adrs/066-sales-document-market-discovery.md
 */
import { Controller, Get, HttpCode, HttpStatus, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IOrderRecordService, ORDER_RECORD_SERVICE_TOKEN } from '@openlinker/core/orders';
import {
  type ISalesDocumentRulesService,
  SALES_DOCUMENT_RULES_SERVICE_TOKEN,
  type SalesDocumentOrderFacts,
} from '@openlinker/core/sales-documents';
import { Roles } from '../../auth/decorators/roles.decorator';
import { hasSalesDocumentStarterTemplate } from '../data/sales-document-template-catalogue';
import { DetectedMarketsResponseDto } from './dto/detected-market-response.dto';
import {
  SalesDocumentMarketOutcomeDto,
  SalesDocumentMarketRowDto,
  SalesDocumentMarketsResponseDto,
} from './dto/sales-document-market-response.dto';

/**
 * Builds the REPRESENTATIVE order facts a market's row is evaluated against
 * (see the response DTO's own doc comment for why this is honest rather than
 * a guess): no buyer tax id asserted, no amount asserted. `★ Rest of world`
 * is not itself evaluated as a country here - its rules/defaults are read as
 * the FALLBACK scope for every other country, exactly as a real order's
 * evaluation would use them.
 */
function toRepresentativeOrderFacts(country: string): SalesDocumentOrderFacts {
  return {
    country,
    totalGross: 0,
    currency: '',
    buyerHasTaxId: undefined,
    taxTreatment: undefined,
  };
}

@Roles('admin')
@ApiBearerAuth()
@ApiTags('sales-documents')
@Controller('sales-documents')
export class SalesDocumentMarketsController {
  constructor(
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService,
    @Inject(SALES_DOCUMENT_RULES_SERVICE_TOKEN)
    private readonly rules: ISalesDocumentRulesService,
  ) {}

  @Get('markets/detected')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Markets detected from ingested orders',
    description:
      'Distinct countries the operator has orders from over a fixed window, each with its order count, ' +
      'most orders first. The country is the one routing evaluates on, so configuring a market listed ' +
      'here changes what those orders get. Countries WITH configured routing are returned too - ' +
      'classification is the caller\'s job, which is what keeps this read and the configured-countries ' +
      'read from becoming two sources of truth. Read-only: it never creates a rule, a default or any ' +
      'routing, and a detected unconfigured market is a neutral state rather than a fault.',
  })
  @ApiResponse({ status: 200, description: 'Detected markets', type: DetectedMarketsResponseDto })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async listDetectedMarkets(): Promise<DetectedMarketsResponseDto> {
    const discovery = await this.orderRecords.discoverSalesDocumentMarkets();
    return {
      windowDays: discovery.windowDays,
      since: discovery.since,
      markets: discovery.markets.map((market) => ({
        country: market.country,
        orderCount: market.orderCount,
      })),
    };
  }

  @Get('markets')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Configured and detected markets, merged, with each market\'s effective routing outcome',
    description:
      'One row per country that is either configured (carries a rule, a country default, or a ' +
      '"no document by choice" acknowledgment) or has orders in the discovery window - a country in ' +
      'both never appears twice. Each row carries its effective outcome, resolved through the SAME ' +
      'evaluator every real order resolves through, against a representative order for that country ' +
      '(no buyer tax id asserted, no amount asserted) - never a hand-written guess. Read-only: this ' +
      'never creates a rule, a default, or an acknowledgment.',
  })
  @ApiResponse({ status: 200, type: SalesDocumentMarketsResponseDto })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async listMarkets(): Promise<SalesDocumentMarketsResponseDto> {
    const [discovery, configured] = await Promise.all([
      this.orderRecords.discoverSalesDocumentMarkets(),
      this.rules.listConfiguredCountries(),
    ]);

    const orderCountByCountry = new Map(discovery.markets.map((m) => [m.country, m.orderCount] as const));
    const configuredByCountry = new Map(configured.map((c) => [c.country, c] as const));

    // `★ Rest of world` appears as its own row only when it is itself
    // CONFIGURED (carries a rule, a default, or an acknowledgment) —
    // `listConfiguredCountries` already includes it in that case. It is
    // never synthesized here: a real order's country is never literally
    // `'*'`, so it can never be "detected", and adding a phantom row for an
    // unconfigured Rest of world would assert a market exists that nobody
    // has set up and no order has ever needed.
    const countries = new Set<string>([...orderCountByCountry.keys(), ...configuredByCountry.keys()]);
    const countryList = [...countries];
    const orderFacts = countryList.map(toRepresentativeOrderFacts);
    const outcomes = await this.rules.resolveRoutingBatch(orderFacts);

    const markets: SalesDocumentMarketRowDto[] = countryList.map((country, index) => {
      const summary = configuredByCountry.get(country);
      const row = new SalesDocumentMarketRowDto();
      row.country = country;
      row.orderCount = orderCountByCountry.get(country) ?? null;
      row.hasTemplate = hasSalesDocumentStarterTemplate(country);
      row.ruleCount = summary?.ruleCount ?? 0;
      row.invoiceDefaultConnectionId = summary?.invoiceDefaultConnectionId ?? null;
      row.receiptDefaultConnectionId = summary?.receiptDefaultConnectionId ?? null;
      row.acknowledgedNoDocumentAt = summary?.acknowledgedNoDocumentAt ?? null;
      // An acknowledged market is never reported as unresolved (#2531) -
      // acknowledgment and configuration are mutually exclusive by
      // construction, so the evaluator's real answer here would always be
      // 'unresolved'/'no-configuration-for-country', which is exactly the
      // outstanding-problem reading #2186's acknowledgment exists to rule
      // out.
      row.outcome =
        row.acknowledgedNoDocumentAt !== null
          ? SalesDocumentMarketOutcomeDto.acknowledged()
          : SalesDocumentMarketOutcomeDto.fromDomain(outcomes[index]);
      return row;
    });

    return { windowDays: discovery.windowDays, since: discovery.since, markets };
  }
}

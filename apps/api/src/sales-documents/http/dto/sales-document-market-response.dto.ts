/**
 * Sales-Document Merged Market Response DTOs (#2530, ADR-066)
 *
 * The settings page's single read: configured markets and detected markets in
 * one shape, ordered so a market needing a decision comes first. Composing
 * this in the browser from three separate reads (configured countries,
 * detected markets, the template catalogue) would put the classification
 * logic - and the risk of drift between two implementations of the same
 * evaluator - in the client. This is a READ. It creates no rule, no country
 * default, and no acknowledgment.
 *
 * Every row carries every field: a country that is only detected reports
 * `ruleCount: 0` / null defaults rather than being a differently-shaped row,
 * and a country that is only configured reports `orderCount: null` rather
 * than `0` - `null` here means "not observed in the discovery window",
 * distinct from a genuine zero, which the discovery read can never produce
 * (`DetectedSalesDocumentMarket.orderCount` is always at least 1).
 *
 * `outcome` is the market's EFFECTIVE routing decision, resolved through the
 * same shipped evaluator every real order resolves through
 * (`ISalesDocumentRulesService.resolveRoutingBatch`) - never re-derived or
 * hand-written here, per the routing-first invariant (ADR-041 amendment
 * #2504). Because no single real order exists for this read, the evaluator is
 * given a REPRESENTATIVE order for the country: `buyerHasTaxId: undefined`
 * (the honest state - unless a caller collects and passes a real one, this is
 * what OpenLinker knows about every order in the country) and no amount
 * (`totalGross: 0`, `taxTreatment: undefined`), so an amount-conditioned rule
 * correctly reports the same `net-priced-order` signal it would for a real
 * order whose tax treatment isn't asserted. This is what surfaces the live
 * Poland defect honestly: three rules that all test `buyerHasTaxId` cannot
 * resolve against an order that carries no such fact, and this row says so
 * instead of asserting the routing "works" for a case the evaluator has never
 * actually been asked to decide.
 *
 * `outcome.kind === 'acknowledged'` is a FOURTH state the evaluator itself
 * cannot produce (#2531): an acknowledged market carries no rule and no
 * default by construction (`acknowledgeNoDocument` / `createRule` /
 * `upsertCountryDefault` mutually and automatically clear one another,
 * `sales-document-rules.service.ts`), so `resolveRoutingBatch` would
 * correctly-but-uselessly answer `unresolved`/`no-configuration-for-country`
 * for it. Reporting that here would be a real regression, not a cosmetic
 * one: it is exactly the state #2186's acknowledgment exists to distinguish
 * from an outstanding problem, and this merged list is the one place that
 * distinction has to survive into. The controller therefore overrides the
 * evaluator's real answer with `acknowledged` whenever the row carries a
 * `acknowledgedNoDocumentAt` - an acknowledged market is never reported as
 * `unresolved`.
 *
 * @module apps/api/src/sales-documents/http/dto
 * @see docs/architecture/adrs/066-sales-document-market-discovery.md
 */
import { ApiProperty } from '@nestjs/swagger';
import type { SalesDocumentDecision } from '@openlinker/core/sales-documents';

export class SalesDocumentMarketOutcomeDto {
  @ApiProperty({ enum: ['route', 'aggregate', 'unresolved', 'acknowledged'] })
  kind!: 'route' | 'aggregate' | 'unresolved' | 'acknowledged';

  @ApiProperty({ required: false, nullable: true, description: 'Set when kind is "route".' })
  documentKind?: string | null;

  @ApiProperty({
    required: false,
    description: 'The connection this market resolves to. Set when kind is "route" or "aggregate".',
  })
  connectionId?: string;

  @ApiProperty({ required: false, description: 'Set when kind is "unresolved".' })
  reason?: string;

  static fromDomain(decision: SalesDocumentDecision): SalesDocumentMarketOutcomeDto {
    const dto = new SalesDocumentMarketOutcomeDto();
    dto.kind = decision.kind;
    if (decision.kind === 'route') {
      dto.documentKind = decision.documentKind;
      dto.connectionId = decision.connectionId;
    } else if (decision.kind === 'aggregate') {
      dto.connectionId = decision.connectionId;
    } else {
      dto.reason = decision.reason;
    }
    return dto;
  }

  /** The market has been acknowledged as "no document, by design" (#2186 / #2531). */
  static acknowledged(): SalesDocumentMarketOutcomeDto {
    const dto = new SalesDocumentMarketOutcomeDto();
    dto.kind = 'acknowledged';
    return dto;
  }
}

export class SalesDocumentMarketRowDto {
  @ApiProperty({ description: "ISO 3166-1 alpha-2, or '*' for Rest of world." })
  country!: string;

  @ApiProperty({
    nullable: true,
    description:
      'Orders billed to this country in the discovery window, or null when the country was not ' +
      'detected at all (a configured-only market). Never 0 - a detected market always has at least ' +
      'one order.',
  })
  orderCount!: number | null;

  @ApiProperty({ description: 'Whether a curated starter template exists for this country.' })
  hasTemplate!: boolean;

  @ApiProperty({ description: 'How many sales_document_rules rows target this country.' })
  ruleCount!: number;

  @ApiProperty({ nullable: true })
  invoiceDefaultConnectionId!: string | null;

  @ApiProperty({ nullable: true })
  receiptDefaultConnectionId!: string | null;

  @ApiProperty({ nullable: true })
  acknowledgedNoDocumentAt!: string | null;

  @ApiProperty({ type: SalesDocumentMarketOutcomeDto })
  outcome!: SalesDocumentMarketOutcomeDto;
}

export class SalesDocumentMarketsResponseDto {
  @ApiProperty({ description: 'The discovery window actually applied, in days.' })
  windowDays!: number;

  @ApiProperty({ description: 'ISO-8601 lower bound the detected order counts were taken from.' })
  since!: string;

  @ApiProperty({
    type: [SalesDocumentMarketRowDto],
    description:
      'One row per country that is either configured or has orders in the discovery window. A ' +
      'country in both never appears twice.',
  })
  markets!: SalesDocumentMarketRowDto[];
}

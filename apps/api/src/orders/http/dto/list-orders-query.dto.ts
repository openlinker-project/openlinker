/**
 * List Orders Query DTO
 *
 * Query parameters for GET /orders. All fields are optional.
 *
 * @module apps/api/src/orders/http/dto
 */
import {
  IsOptional,
  IsString,
  IsUUID,
  IsEnum,
  IsInt,
  Min,
  Max,
  IsDateString,
  IsBoolean,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  OrderSyncStatusFilterValues,
  OrderRecordStatusValues,
  OrderHealthValues,
  OrderRecordSortValues,
  OrderRecordSortDirectionValues,
  SlaStateValues,
  FulfillmentRollupStateValues,
} from '@openlinker/core/orders';
import { HoldReasonValues, type HoldReason } from '@openlinker/core/order-lifecycle';
import {
  OrderSyncStatusFilter,
  OrderRecordStatus,
  OrderHealth,
  OrderRecordSort,
  OrderRecordSortDirection,
  SlaState,
  FulfillmentRollupState,
} from '@openlinker/core/orders';
import {
  OrderLifecyclePhaseValues,
  type OrderLifecyclePhase,
} from '@openlinker/core/order-lifecycle';
import { PaginatedReadQueryDto } from '../../../common/dto/paginated-read-query.dto';

export class ListOrdersQueryDto extends PaginatedReadQueryDto {
  @ApiPropertyOptional({ description: 'Filter by source connection ID (UUID)' })
  @IsOptional()
  @IsUUID()
  sourceConnectionId?: string;

  @ApiPropertyOptional({
    enum: OrderSyncStatusFilterValues,
    description: 'Filter by sync status (matches any destination with this status)',
  })
  @IsOptional()
  @IsEnum(OrderSyncStatusFilterValues)
  syncStatus?: OrderSyncStatusFilter;

  @ApiPropertyOptional({ description: 'Filter by internal customer ID' })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional({ description: 'Filter orders created on or after this date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @ApiPropertyOptional({ description: 'Filter orders created on or before this date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  createdTo?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100, description: 'Page size' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    enum: OrderRecordStatusValues,
    description:
      'Filter by record status (ready = fully resolved, awaiting_mapping = item refs unresolved (self-healing), source_deleted = permanently unresolvable (#1689))',
  })
  @IsOptional()
  @IsEnum(OrderRecordStatusValues)
  recordStatus?: OrderRecordStatus;

  @ApiPropertyOptional({
    enum: OrderHealthValues,
    description:
      'Filter by derived health bucket (#929) — partitions the set: source_deleted | awaiting_mapping | needs_attention | synced | awaiting_dispatch',
  })
  @IsOptional()
  @IsEnum(OrderHealthValues)
  health?: OrderHealth;

  @ApiPropertyOptional({
    enum: OrderRecordSortValues,
    description:
      'Result ordering (#927/#944). "dispatchBy" = ship-by deadline (triage default, NULLs last); "createdAt" = ingestion time; "customer"/"items"/"status"/"total" back the sortable table columns (derived from the order snapshot + health). Pair with `dir`.',
  })
  @IsOptional()
  @IsEnum(OrderRecordSortValues)
  sort?: OrderRecordSort;

  @ApiPropertyOptional({
    enum: OrderRecordSortDirectionValues,
    description:
      'Sort direction for `sort` (#944). Defaults per-column server-side when omitted; the UI sends an explicit direction once a header is clicked.',
  })
  @IsOptional()
  @IsEnum(OrderRecordSortDirectionValues)
  dir?: OrderRecordSortDirection;

  @ApiPropertyOptional({
    description:
      'Dispatch-SLA filter (#927): keep only orders with a known ship-by deadline at or before this instant (ISO 8601). Pass `now` for overdue, `now + window` for "breaching soon".',
  })
  @IsOptional()
  @IsDateString()
  dueBefore?: string;

  @ApiPropertyOptional({
    enum: SlaStateValues,
    description:
      'Ship-by SLA bucket filter (#1108): none | on_track | at_risk | overdue. Server-derived from the ship-by deadline + fulfillment (cleared once shipped); matches the badge the list renders.',
  })
  @IsOptional()
  @IsEnum(SlaStateValues)
  slaState?: SlaState;

  @ApiPropertyOptional({
    enum: FulfillmentRollupStateValues,
    description:
      'Fulfillment-rollup filter (#1108): not-shipped | dispatched | delivered | failed (not-shipped also matches orders with no shipments).',
  })
  @IsOptional()
  @IsEnum(FulfillmentRollupStateValues)
  fulfillmentState?: FulfillmentRollupState;

  @ApiPropertyOptional({
    enum: HoldReasonValues,
    description:
      'Hold-reason filter (#2342), sent as `?hold=`: keeps only orders whose OPEN hold carries ' +
      'this reason. Reason-scoped with no "any" value on purpose — `?phase=held` already answers ' +
      '"show me held orders" and carries a count, so this is the narrower axis that chip cannot ' +
      'express, and its result set is a strict subset of that one. Composes with `phase` and ' +
      '`health` rather than replacing either. An unrecognised reason is rejected with a 400 ' +
      'rather than silently returning the unfiltered list.',
  })
  @IsOptional()
  @IsEnum(HoldReasonValues)
  hold?: HoldReason;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Sales-document block filter (#2100): true keeps only orders carrying an ATTENTION-WORTHY ' +
      'block, false keeps only the rest, omitted does not filter. Attention-worthy excludes ' +
      '"trigger-model-manual" — a deliberate operator setting that is true of every uninvoiced ' +
      'order on a manual install — so true does not return manual-only orders and false does. ' +
      'This is the same subset the salesDocumentBlocked count reports, so the two always agree. ' +
      'An INDEPENDENT axis that composes with `health` rather than competing with it — ' +
      '"synced AND invoicing blocked" is the most common shape of the problem.',
  })
  @IsOptional()
  // Query params arrive as strings, so map the two literals and pass anything else
  // THROUGH unchanged for `@IsBoolean()` to reject with a 400 — mirroring
  // `list-shipments-query.dto.ts` and `list-offer-mappings-query.dto.ts`. Mapping a
  // stray value to `undefined` would make `?salesDocumentBlocked=yes` silently
  // return the UNFILTERED list while the chip renders as applied, which is a worse
  // failure for a filter than collapsing to `false`.
  @Transform(({ value }): unknown => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  salesDocumentBlocked?: boolean;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Cancellation filter (#1984, exposed on this route by #2306): true keeps only cancelled ' +
      'orders, false excludes them, omitted does not filter. Maps directly to ' +
      '`cancelledAt IS [NOT] NULL` — the repository already honoured this field, it simply had ' +
      'no query surface. The dispatch-risk page passes false so the rows it lists match the ' +
      'bucket counts GET /orders/sla-summary returns under the same scope. NOT orthogonal to ' +
      "`phase`: the lifecycle phase `cancelled` IS this filter's `true` set, so a " +
      'contradictory pair (`cancelled=false&phase=cancelled`, or `cancelled=true` with any ' +
      'other phase) is rejected with a 400 rather than returning a structurally empty list.',
  })
  @IsOptional()
  // Same string-literal mapping + pass-through-to-400 posture as
  // `salesDocumentBlocked` above; see that comment for why a stray value must not
  // collapse to `undefined`.
  @Transform(({ value }): unknown => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  cancelled?: boolean;

  @ApiPropertyOptional({
    enum: OrderLifecyclePhaseValues,
    description:
      'Derived lifecycle-phase filter (#2309, ADR-059): cancelled | vendor_authoritative | ' +
      'delivered | in_transit | fulfillment_failed | held | amending | blocked | ready. ' +
      "Server-derived from the order's own facts and clock-free, so it always matches the " +
      '`lifecyclePhase` the same order carries on its response. A SECOND ORTHOGONAL PARTITION ' +
      'beside `health`, not a sixth health bucket — it composes with `health` rather than ' +
      'competing with it (a held order is usually also synced). Three values ' +
      '(vendor_authoritative, held, amending) have no persisted source yet and match nothing ' +
      'until Waves 2 and 4 wire their facts. Orthogonal to `health`, but NOT to `cancelled`: ' +
      'the `cancelled` phase is derived from the same `cancelledAt IS NOT NULL` fact that ' +
      'filter reads, so a contradictory pair is rejected with a 400 — see `cancelled`.',
  })
  @IsOptional()
  @IsEnum(OrderLifecyclePhaseValues)
  phase?: OrderLifecyclePhase;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Tax-rate conflict filter (#2254): true keeps only orders where the shop and the channel ' +
      'named DIFFERENT rates, false keeps only the rest, omitted does not filter. A SEPARATE ' +
      'axis from salesDocumentBlocked, and it has to be — a conflict does not stop the invoice, ' +
      'so the rows it finds are usually already invoiced and are invisible in every other view.',
  })
  @IsOptional()
  @Transform(({ value }): unknown => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  taxRateConflict?: boolean;

  @ApiPropertyOptional({
    type: Boolean,
    name: 'attention',
    description:
      'THIS IS NOT `health=needs_attention`. That value is a member of the health PARTITION and ' +
      'means a sync failure; this is an orthogonal axis (#2352/#2353) meaning OpenLinker stopped ' +
      'deciding something about the order - two systems claiming one thing, a stock shortfall ' +
      'against what was promised, a line nothing can ship, an unaccepted job. An order is ' +
      'routinely one, the other, or both, so this composes with `health` rather than competing ' +
      'with it. true keeps only orders carrying at least one COUNTED inert state, false keeps ' +
      'only the rest, omitted does not filter. A reason this build does not recognise never ' +
      'matches and is never counted.',
  })
  @IsOptional()
  // Same string-literal mapping + pass-through-to-400 posture as
  // `salesDocumentBlocked` above; see that comment for why a stray value must not
  // collapse to `undefined`.
  @Transform(({ value }): unknown => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  attention?: boolean;

  @ApiPropertyOptional({ default: 0, minimum: 0, description: 'Number of items to skip' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      '"Is it packed" filter (#2997): true keeps only packed orders, false only ' +
      'unpacked ones, omitted does not filter. Maps to `packedAt IS [NOT] NULL`. ' +
      'ANDed with `health`, not a sixth health bucket.',
  })
  @IsOptional()
  @Transform(({ value }): unknown => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  packed?: boolean;

  @ApiPropertyOptional({
    description:
      'Free-text search (#3527/#3528): order number, buyer name, buyer email, any line SKU, ' +
      'or a shipment tracking number. Matched against a denormalized, diacritic-folded ' +
      '`searchText` column via a GIN trigram index; a valid tracking number additionally ' +
      'widens the match to the order(s) that shipment belongs to. A blank or ' +
      'diacritic/punctuation-only query behaves as "don\'t filter".',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      '"Has an open return" filter (#2998): true keeps only orders carrying at least one ' +
      'OPEN return (the `/returns` `all_open` segment predicate, reused verbatim), false ' +
      'keeps only the rest, omitted does not filter. ANDed with `health`, not a sixth ' +
      'health bucket — an order is routinely `synced` AND carrying an open return.',
  })
  @IsOptional()
  @Transform(({ value }): unknown => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  openReturn?: boolean;

  @ApiPropertyOptional({
    description:
      'Tag filter (#3532, D34): restricts to orders carrying this one tag id. Mutually ' +
      'exclusive with `untagged` by convention.',
  })
  @IsOptional()
  @IsString()
  tag?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description: '"No tags" filter (#3532): restricts to orders carrying NO tag at all.',
  })
  @IsOptional()
  @Transform(({ value }): unknown => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  untagged?: boolean;
}

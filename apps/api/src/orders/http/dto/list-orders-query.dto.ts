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
import {
  OrderSyncStatusFilter,
  OrderRecordStatus,
  OrderHealth,
  OrderRecordSort,
  OrderRecordSortDirection,
  SlaState,
  FulfillmentRollupState,
} from '@openlinker/core/orders';
import { OrderLifecyclePhaseValues, type OrderLifecyclePhase } from '@openlinker/core/order-lifecycle';

export class ListOrdersQueryDto {
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
      '`phase`: the lifecycle phase `cancelled` IS this filter\'s `true` set, so a ' +
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
      'Server-derived from the order\'s own facts and clock-free, so it always matches the ' +
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

  @ApiPropertyOptional({ default: 0, minimum: 0, description: 'Number of items to skip' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

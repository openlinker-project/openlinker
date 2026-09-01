/**
 * Order Record Response DTO
 *
 * Response shape for a single order record. Used in both list and detail responses.
 * Dates are serialised as ISO 8601 strings.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  OrderRecordStatusValues,
  SYNC_ATTEMPTS_PER_DESTINATION_CAP,
  SlaStateValues,
  FulfillmentRollupStateValues,
} from '@openlinker/core/orders';
import { OrderRecordStatus, SlaState, FulfillmentRollupState } from '@openlinker/core/orders';
import {
  OrderLifecyclePhaseValues,
  HoldReasonValues,
  type OrderLifecyclePhase,
  type HoldReason,
} from '@openlinker/core/order-lifecycle';
import { OrderHoldDto } from './order-hold-response.dto';
import {
  SalesDocumentGateBlockReasonValues,
  SalesDocumentUnresolvedReasonValues,
} from '@openlinker/core/sales-documents';
import type {
  SalesDocumentGateBlockReason,
  SalesDocumentUnresolvedReason,
} from '@openlinker/core/sales-documents';
import { OrderAmendmentChangeDto } from './order-amendment-change.dto';
import { OrderOmsAttentionEntryDto } from './order-oms-attention-entry.dto';
import { OrderSyncStatusResponseDto } from './order-sync-status-response.dto';
import { SyncAttemptResponseDto } from './sync-attempt-response.dto';
import type { OrderInvoiceProjectionDto } from './order-invoice-projection.dto';
import { OrderReservationShortfallDto } from './order-reservation-shortfall.dto';
import { OrderDeliveryResolutionDto } from './order-delivery-resolution.dto';
import { OrderDeliveryRiderDto } from './order-delivery-rider.dto';
import { SalesDocumentViewResponseDto } from './sales-document-view-response.dto';


export class OrderRecordResponseDto {
  @ApiProperty({ description: 'Internal order ID (e.g. ol_order_...)' })
  internalOrderId!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Internal customer ID' })
  customerId!: string | null;

  @ApiProperty({ description: 'Source connection ID' })
  sourceConnectionId!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Source event ID for tracking' })
  sourceEventId!: string | null;

  @ApiProperty({
    description:
      'Order snapshot (PII-aware). On the detail read only (#1224), it may carry an optional neutral ' +
      '`invoice` sub-tree (shape: OrderInvoiceProjectionDto) when a latest invoice record exists for the order; ' +
      'the list read never includes it.',
  })
  orderSnapshot!: Record<string, unknown> & { invoice?: OrderInvoiceProjectionDto };

  @ApiProperty({ type: [OrderSyncStatusResponseDto], description: 'Sync status per destination' })
  syncStatus!: OrderSyncStatusResponseDto[];

  @ApiProperty({
    type: [SyncAttemptResponseDto],
    description:
      `Per-destination attempt history (append-only, capped at ${SYNC_ATTEMPTS_PER_DESTINATION_CAP} ` +
      'most-recent entries per destination). Used by the activity timeline to preserve ' +
      'failure → retry → success narrative.',
  })
  syncAttempts!: SyncAttemptResponseDto[];

  @ApiProperty({ description: 'Order creation timestamp (ISO 8601)' })
  createdAt!: string;

  @ApiProperty({
    description:
      'Record resolution status. "ready" = all item refs resolved (orderSnapshot contains internal IDs). ' +
      '"awaiting_mapping" = item refs unresolved (orderSnapshot contains raw IncomingOrder with external offer refs); ' +
      'self-healing once the mapping lands. "source_deleted" (#1689) = at least one item ref is permanently ' +
      'unresolvable — the mapped variant was deleted at its master (#1599).',
    enum: OrderRecordStatusValues,
  })
  recordStatus!: OrderRecordStatus;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Operator-facing reason item resolution failed at ingestion (#1689), set alongside ' +
      'recordStatus = "awaiting_mapping" | "source_deleted". null for a "ready" record.',
  })
  mappingFailureReason!: string | null;

  @ApiPropertyOptional({
    enum: SalesDocumentGateBlockReasonValues,
    nullable: true,
    description:
      'Why OpenLinker issued no fiscal document for this order (#2100, ADR-041 decision 11). ' +
      'null when nothing is blocking it — including the ordinary cases of already invoiced, ' +
      'no invoicing connection, and waiting for the trigger condition. Independent of ' +
      'recordStatus: an order can be ready and synced while still carrying a block.',
  })
  salesDocumentBlockReason!: SalesDocumentGateBlockReason | null;

  @ApiPropertyOptional({
    enum: SalesDocumentUnresolvedReasonValues,
    nullable: true,
    description:
      'The routing reason paired with a "unresolved-routing" block (ADR-041 §107); null for ' +
      'every other reason. This is the value operator-facing copy keys on — "routing was ' +
      'unresolved" is not actionable, "no primary invoicing connection" is.',
  })
  salesDocumentUnresolvedReason!: SalesDocumentUnresolvedReason | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'PII-free elaboration of the block reason (ids and counts only, e.g. "3 invoicing ' +
      'connections, none marked primary"), rendered to the operator verbatim.',
  })
  salesDocumentBlockDetail!: string | null;

  @ApiProperty({
    type: [OrderOmsAttentionEntryDto],
    description:
      'Inert states this order carries (#2352/#2356) — what OpenLinker STOPPED deciding about it. ' +
      'Empty for an ordinary order, and empty on every install until a producer writes the column. ' +
      'This is NOT the `needs_attention` health bucket: that bucket is a member of a partition and ' +
      'means a sync failure, while this is an orthogonal axis, so an order is routinely one, the ' +
      'other, or both. Keyed by PRODUCER, so an order can carry several at once.',
  })
  omsAttention!: OrderOmsAttentionEntryDto[];

  @ApiPropertyOptional({
    nullable: true,
    description:
      'When the CURRENT sales-document hold started (ISO 8601), or null when the order is not ' +
      'held and never has been (#2248). The reason column is level-triggered and nulled the ' +
      'moment it clears, so this is the only clock an operator-facing age can run on. Stamped ' +
      'on the none-to-blocked transition only, so a change of reason inside one episode does ' +
      'not reset it.',
  })
  salesDocumentBlockedAt!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'When the current hold ended (ISO 8601), cleared whenever a new one starts, so the pair ' +
      'with salesDocumentBlockedAt always describes one episode. It is what lets the timeline ' +
      'say the order was held and then released — the reason itself is gone by then.',
  })
  salesDocumentBlockReleasedAt!: string | null;

  @ApiPropertyOptional({
    type: [OrderReservationShortfallDto],
    description:
      'Still-open reservation shortfall episodes for this order (#2349) — the ' +
      'master dropped below what OpenLinker already promised, and this order ' +
      'is one the shortfall lands on. Nothing was silently reduced. Carried by ' +
      'BOTH the detail read and the list read (#2350) — the list read batches ' +
      'one projection across the whole page rather than an N+1 of per-row ' +
      'lookups, so it costs no per-row cost either. Absent means nothing was ' +
      'reported for this order, never a positive assertion that it is fine: ' +
      'the projection is best-effort and degrades to absent on failure.',
  })
  reservationShortfalls?: OrderReservationShortfallDto[];

  @ApiProperty({ description: 'Order last-update timestamp (ISO 8601)' })
  updatedAt!: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Marketplace dispatch (ship-by) deadline (ISO 8601), derived from the source dispatch window (#927). ' +
      'null when the source exposes no dispatch SLA. Surfaced top-level so the list SLA column / sort / filter ' +
      'and the detail countdown read it without parsing the snapshot.',
  })
  dispatchByAt!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Instant the source reported this order cancelled (ISO 8601, #1984). null = never cancelled. ' +
      'Set once and never cleared — a later re-poll of a cancelled order cannot change this timestamp.',
  })
  cancelledAt!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Instant an operator marked this order packed (ISO 8601, #2287). null = not packed. ' +
      'A fact, not a state: independent of recordStatus / fulfillmentState / slaState, and it gates nothing. ' +
      'Set once — a repeat mark replays the original stamp rather than re-stamping.',
  })
  packedAt!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'OL user id of whoever marked this order packed (#2287). null when not packed. ' +
      'Moves as one group with packedAt, so the FIRST actor is never overwritten.',
  })
  packedByUserId!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Instant OpenLinker last observed the SOURCE amend this order after ingestion (ISO 8601, #2283) — ' +
      'a line removed, added or re-quantified, or the shipping address edited. null = never observed amended. ' +
      'An internal fact: it moves no status and gates nothing.',
  })
  lastAmendedAt!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: [OrderAmendmentChangeDto],
    description:
      'What changed at lastAmendedAt (#2283) — the most recent observation only, not a history. ' +
      'PII-free by construction: line ids, SKUs and quantities verbatim, and for an address change only ' +
      'the NAMES of the fields that moved, never their values.',
  })
  lastAmendmentChanges!: OrderAmendmentChangeDto[] | null;

  @ApiProperty({
    description:
      'True when `dispatchByAt` is an OL-side ESTIMATE rather than a marketplace-authoritative ' +
      'commitment (#1776). Derived from the snapshot dispatch window\'s `estimated` flag: Erli derives ' +
      'its ship-by from per-offer (falling back to connection-default) handling time and marks it estimated; ' +
      'Allegro carries the platform-authoritative dispatch time and leaves it false. The FE renders a subtle ' +
      '"~" qualifier next to the ship-by badge when true.',
  })
  dispatchByEstimated!: boolean;

  @ApiProperty({
    enum: FulfillmentRollupStateValues,
    description:
      'Per-order fulfillment rollup (#1108) of the order\'s shipment lifecycle. "not-shipped" when no shipment has progressed (also the default for orders with no shipments).',
  })
  fulfillmentState!: FulfillmentRollupState;

  @ApiProperty({
    enum: SlaStateValues,
    description:
      'Ship-by SLA bucket (#1108), server-derived from dispatchByAt + fulfillmentState (cleared to "none" once shipped). The single source of truth the list badge + filter agree on; the FE renders only the live countdown from dispatchByAt.',
  })
  slaState!: SlaState;

  @ApiProperty({
    enum: OrderLifecyclePhaseValues,
    description:
      'Derived lifecycle phase (#2309, ADR-059) — "what is this order waiting on, and who holds ' +
      'it up". Server-derived by the one pure `deriveOrderLifecyclePhase`, whose SQL twin backs ' +
      'the `?phase=` filter, so the badge and the filter always agree. CLOCK-FREE, unlike ' +
      'slaState: two reads of an unchanged order can never differ. A SECOND ORTHOGONAL ' +
      'PARTITION beside the order-health buckets, never a sixth one — a held order is usually ' +
      'also synced. Nothing persists a phase; it is recomputed from facts each read.',
  })
  lifecyclePhase!: OrderLifecyclePhase;

  @ApiPropertyOptional({
    type: OrderDeliveryResolutionDto,
    description:
      'Read-only projection (#1791) of how fulfillment routing resolved for this order\'s delivery ' +
      'method — the outcome IFulfillmentRoutingService.resolve computes. Present on both the list and ' +
      'detail reads when the order carries a source delivery method; absent otherwise. Never changes ' +
      'routing behaviour — a pure derived read.',
  })
  deliveryResolution?: OrderDeliveryResolutionDto;

  @ApiPropertyOptional({
    type: OrderDeliveryRiderDto,
    description:
      'Read-only actionable delivery hint (#1792) for a "default"-resolved order — Add mapping / ' +
      'Connect {carrier} / nothing. Present alongside deliveryResolution when the order carries a ' +
      'source delivery method; absent otherwise. The heuristic only picks which hint to show — it ' +
      'never influences routing/dispatch.',
  })
  deliveryRider?: OrderDeliveryRiderDto;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Source delivery method id (#1791) — the Add-mapping deep-link target.',
  })
  sourceDeliveryMethodId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Source delivery method label (#1791).',
  })
  sourceDeliveryMethodName?: string | null;

  @ApiPropertyOptional({
    enum: HoldReasonValues,
    nullable: true,
    description:
      'Why this order is currently held, or null (#2340/#2341). On the SHARED projection, so it ' +
      'reaches the list and the detail read from one place at no query cost — the column is ' +
      'already loaded. It is #2340\'s DISPLAY CACHE with an hourly repair window: a badge may ' +
      'render it, and no GATE may read it. Whether an order is held is decided through ' +
      'IOrderHoldService.getOpenHold against order_holds (the epic\'s L4 exit criterion).',
  })
  activeHoldReason!: HoldReason | null;

  @ApiPropertyOptional({
    type: OrderHoldDto,
    nullable: true,
    description:
      'The open hold on this order, or null (#2341). DETAIL READ ONLY — absent on the list, where ' +
      'resolving it would be one query per row. Read it as `.nullish()`, never `.optional()` (#939).',
  })
  activeHold?: OrderHoldDto | null;

  @ApiPropertyOptional({
    type: [OrderHoldDto],
    description:
      'Every hold this order has carried, newest first — the operator-facing audit trail (#2341). ' +
      'DETAIL READ ONLY, same as activeHold above.',
  })
  holdHistory?: OrderHoldDto[];

  @ApiPropertyOptional({
    type: SalesDocumentViewResponseDto,
    description:
      'The per-order sales-document projection (#2517, ADR-065) - the routed document kind, the state ' +
      'on the axis belonging to that kind, the persisted block reasons verbatim, and any record held ' +
      'on another connection. Carried on BOTH the list and the detail read, in the same shape ' +
      'GET /orders/:internalOrderId/sales-document serves, so a row and the panel opened from it can ' +
      'never describe one order differently and the list needs no second request per row. Optional ' +
      'only because the projection is a separate read: it is populated for every order the read ' +
      'resolves, and an order with NO document at all is present with `document: null`, never absent.',
  })
  salesDocument?: SalesDocumentViewResponseDto;
}

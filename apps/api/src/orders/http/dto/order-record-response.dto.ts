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
import { OrderLifecyclePhaseValues, type OrderLifecyclePhase } from '@openlinker/core/order-lifecycle';
import {
  SalesDocumentGateBlockReasonValues,
  SalesDocumentUnresolvedReasonValues,
} from '@openlinker/core/sales-documents';
import type {
  SalesDocumentGateBlockReason,
  SalesDocumentUnresolvedReason,
} from '@openlinker/core/sales-documents';
import { OrderAmendmentChangeDto } from './order-amendment-change.dto';
import { OrderSyncStatusResponseDto } from './order-sync-status-response.dto';
import { SyncAttemptResponseDto } from './sync-attempt-response.dto';
import type { OrderInvoiceProjectionDto } from './order-invoice-projection.dto';
import { OrderReservationShortfallDto } from './order-reservation-shortfall.dto';
import { OrderDeliveryResolutionDto } from './order-delivery-resolution.dto';
import { OrderDeliveryRiderDto } from './order-delivery-rider.dto';

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
      'is one the shortfall lands on. Nothing was silently reduced. Present ' +
      'only on the DETAIL read; the list read does not carry it, so a page of ' +
      'orders costs no per-row lookup.',
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
}

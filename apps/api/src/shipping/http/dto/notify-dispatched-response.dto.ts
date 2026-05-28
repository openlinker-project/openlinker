/**
 * Notify Dispatched Response DTO
 *
 * Response for `POST /shipments/:id/notify-dispatched` (#769) — the operator-
 * facing entry point to #837's source + dest projection orchestration. Mirrors
 * the core `ShipmentDispatchNotificationResult` shape: `outcome` is the
 * top-level disposition, `source` reports the A-side mark-sent outcome, and
 * `destinations[]` enumerates the per-OMP B-side fulfillment-update results.
 *
 * `shipment-not-found` is converted to a 404 by the controller before this
 * DTO is built, so the wire-level `outcome` here is one of `notified |
 * skipped-not-generated`. FE renders `notified` as a success toast and
 * `skipped-not-generated` as a `tone="info"` Alert.
 *
 * @module apps/api/src/shipping/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import type { ShipmentDispatchNotificationResult } from '@openlinker/core/shipping';

class NotifyDispatchedDestinationResultDto {
  @ApiProperty({ description: 'Destination connection id (UUID)' })
  connectionId!: string;

  @ApiProperty({ enum: ['ok', 'failed', 'unsupported'] })
  status!: 'ok' | 'failed' | 'unsupported';
}

export class NotifyDispatchedResponseDto {
  @ApiProperty({ description: 'Internal shipment id (ol_shipment_*) the notify ran against' })
  shipmentId!: string;

  @ApiProperty({
    enum: ['notified', 'skipped-not-generated'],
    description:
      'Top-level outcome. `notified` — the gate was open and source + destinations were attempted. ' +
      '`skipped-not-generated` — the shipment is past the gate (already dispatched/terminal), idempotent no-op.',
  })
  outcome!: 'notified' | 'skipped-not-generated';

  @ApiProperty({
    enum: ['ok', 'failed', 'absent'],
    description:
      'Source mark-sent outcome (capability A). `absent` when the order has no source connection ' +
      'or the source adapter does not implement `OrderDispatchNotifier`.',
  })
  source!: 'ok' | 'failed' | 'absent';

  @ApiProperty({ type: [NotifyDispatchedDestinationResultDto] })
  destinations!: NotifyDispatchedDestinationResultDto[];

  static fromResult(result: ShipmentDispatchNotificationResult): NotifyDispatchedResponseDto {
    const dto = new NotifyDispatchedResponseDto();
    dto.shipmentId = result.shipmentId;
    // Caller filters `shipment-not-found` to a 404 before fromResult is invoked, so
    // narrow the wire-level union to the two values that can appear here.
    dto.outcome = result.outcome as 'notified' | 'skipped-not-generated';
    dto.source = result.source;
    dto.destinations = result.destinations.map((d) => ({
      connectionId: d.connectionId,
      status: d.status,
    }));
    return dto;
  }
}

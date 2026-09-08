/**
 * Waybill Relay Failure Response DTO (#2073)
 *
 * The operator-facing projection of a shipment's consecutive waybill-relay
 * failures. `null` on `ShipmentResponseDto` means the relay has never failed,
 * or that its history was cleared by a relay that succeeded.
 *
 * **The backend derives `stuck`; the frontend renders it.** `apps/web` cannot
 * import `@openlinker/core` (#591), so a browser-side comparison against the
 * threshold would be a mirror needing a `check:invariants` guard. Shipping the
 * boolean means there is no shared rule to mirror at all — strictly better than
 * a guarded copy, and the reason no mirror script accompanies this change.
 *
 * **No role gating.** `GET /shipments` redacts `errorMessage` for a caller
 * without `shipments:write` because it is free-text carrier content; nothing
 * here is. `lastFailureReason` is a closed code vocabulary and
 * `lastFailureConnectionId` names one of the operator's own connections, which
 * every row already exposes unconditionally as `connectionId`.
 *
 * @module apps/api/src/shipping/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  isWaybillRelayStuck,
  WaybillRelayFailureReasonValues,
  type WaybillRelayFailure,
  type WaybillRelayFailureReason,
} from '@openlinker/core/shipping';

export class WaybillRelayResponseDto {
  @ApiProperty({
    description:
      'Consecutive failed attempts to relay this shipment\'s waybill to the order\'s participants. Reset to zero by a relay that succeeds.',
  })
  failureCount!: number;

  @ApiProperty({
    description:
      'Whether the failure count has reached the escalation threshold (OL_WAYBILL_RELAY_FAILURE_ALERT_THRESHOLD, default 3). Derived server-side so no client re-implements the rule. A single transient failure never sets this — the threshold is clamped to a minimum of 2.',
  })
  stuck!: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'When the current run of failures began.',
  })
  firstFailedAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description:
      'The most recent failure. Distinguishes a relay that is still being retried from a frozen historical count on a shipment that has since reached a terminal status, which the status-sync scan no longer visits.',
  })
  lastFailedAt!: string;

  @ApiProperty({
    enum: WaybillRelayFailureReasonValues,
    nullable: true,
    description:
      "Why the last attempt failed. 'rejected' — a participant's adapter refused the write; 'adapter-unresolved' — its adapter could not be built (disabled connection, credential failure); 'threw' — the relay failed before any participant was resolved. Null when the stored value is not one this build recognises. The adapter's own message is logged, never persisted here.",
  })
  lastFailureReason!: WaybillRelayFailureReason | null;

  @ApiProperty({
    nullable: true,
    description:
      'The first participant connection in the failing set, for display only — no retry decision reads it. Null for a failure that happened before any participant was resolved. Per-destination retry state is #861.',
  })
  lastFailureConnectionId!: string | null;

  /**
   * `threshold` is a REQUIRED parameter, never resolved in here. A DTO reading
   * `process.env` would be a second reader of the value the list filter was
   * built from, and the two could then disagree about which rows are stuck.
   */
  static fromDomain(
    failure: WaybillRelayFailure | null,
    threshold: number,
  ): WaybillRelayResponseDto | null {
    if (failure === null) {
      return null;
    }
    const dto = new WaybillRelayResponseDto();
    dto.failureCount = failure.count;
    dto.stuck = isWaybillRelayStuck(failure, threshold);
    dto.firstFailedAt = failure.firstFailedAt.toISOString();
    dto.lastFailedAt = failure.lastFailedAt.toISOString();
    dto.lastFailureReason = failure.reason;
    dto.lastFailureConnectionId = failure.connectionId;
    return dto;
  }
}

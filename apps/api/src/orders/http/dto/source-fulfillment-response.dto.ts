/**
 * Source Fulfillment Response DTO
 *
 * The wire shape of `GET /orders/:internalOrderId/source-fulfillment` (#3365).
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { SourceFulfillmentStatusView } from '../../application/types/source-fulfillment-status.types';

export class SourceFulfillmentWaybillDto {
  @ApiProperty({ description: 'The tracking number as the marketplace reports it.' })
  waybill!: string;

  @ApiPropertyOptional({ description: "The marketplace's own carrier identifier, verbatim." })
  carrierId?: string;

  @ApiPropertyOptional({ description: 'A free-text carrier name, where the marketplace carries one.' })
  carrierName?: string;
}

export class SourceFulfillmentReadbackDto {
  @ApiProperty({
    enum: ['read', 'unsupported', 'unavailable'],
    description:
      '`read` - the marketplace answered. `unsupported` - this source reports nothing back, ever. ' +
      '`unavailable` - it could not be reached or refused; transient. These are three different ' +
      'operator actions and must never be collapsed.',
  })
  outcome!: 'read' | 'unsupported' | 'unavailable';

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "The marketplace's own status string, verbatim and un-normalised (Allegro: `SENT`, `NEW`, " +
      '`CANCELLED`). `null` on any outcome other than `read`, and when the source answered without ' +
      'naming one.',
  })
  rawStatus!: string | null;

  @ApiProperty({
    type: Boolean,
    nullable: true,
    description:
      '`null` means UNKNOWN - the adapter did not recognise `rawStatus` - and must never be read as ' +
      '"not dispatched".',
  })
  dispatched!: boolean | null;

  @ApiProperty({
    type: [SourceFulfillmentWaybillDto],
    nullable: true,
    description:
      '`null` means this source does not report attached waybills at all - NOT that none is attached. ' +
      'An empty array is the different, stronger claim that it answered and listed none. Allegro is ' +
      '`null` today: it accepts a waybill and exposes no verified read that returns one.',
  })
  waybills!: SourceFulfillmentWaybillDto[] | null;

  @ApiPropertyOptional({ description: 'Why the answer is absent. Operator-facing; carries no credential.' })
  detail?: string;
}

export class SourceFulfillmentResponseDto {
  @ApiProperty()
  internalOrderId!: string;

  @ApiProperty({ description: 'The connection the order was ingested from.' })
  sourceConnectionId!: string;

  @ApiProperty({ type: String, nullable: true })
  sourceConnectionName!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The source-native order id the answer is about; `null` when the order is unmapped there.',
  })
  externalOrderId!: string | null;

  @ApiProperty({
    type: SourceFulfillmentReadbackDto,
    nullable: true,
    description: 'The marketplace’s answer. `null` only when there was nothing to ask - see `unmappedReason`.',
  })
  readback!: SourceFulfillmentReadbackDto | null;

  @ApiProperty({
    type: String,
    nullable: true,
    enum: ['no-source-mapping'],
    description:
      'Set exactly when `readback` is null. `no-source-mapping` is an OpenLinker-side fact and is ' +
      'deliberately NOT folded into `unavailable`, which means the marketplace WAS asked.',
  })
  unmappedReason!: 'no-source-mapping' | null;

  @ApiProperty({ description: "When OpenLinker asked. Always OpenLinker's clock - it is our own act." })
  readAt!: string;
}

export function toSourceFulfillmentDto(
  view: SourceFulfillmentStatusView
): SourceFulfillmentResponseDto {
  return {
    internalOrderId: view.internalOrderId,
    sourceConnectionId: view.sourceConnectionId,
    sourceConnectionName: view.sourceConnectionName,
    externalOrderId: view.externalOrderId,
    readback:
      view.readback === null
        ? null
        : {
            outcome: view.readback.outcome,
            rawStatus: view.readback.rawStatus,
            dispatched: view.readback.dispatched,
            waybills:
              view.readback.waybills === null
                ? null
                : view.readback.waybills.map((w) => ({
                    waybill: w.waybill,
                    ...(w.carrierId !== undefined && { carrierId: w.carrierId }),
                    ...(w.carrierName !== undefined && { carrierName: w.carrierName }),
                  })),
            ...(view.readback.detail !== undefined && { detail: view.readback.detail }),
          },
    unmappedReason: view.unmappedReason,
    readAt: view.readAt,
  };
}

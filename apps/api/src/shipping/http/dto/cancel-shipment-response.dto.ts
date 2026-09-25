/**
 * Cancel Shipment Response DTO
 *
 * The cancelled shipment, plus the one fact the row itself cannot express.
 *
 * A separate DTO rather than a field on `ShipmentResponseDto` because
 * `cancelledAfterDispatch` is an answer about THIS call: on a list or a get it
 * would be a permanently absent field that means nothing, and a field that
 * means nothing on most of its appearances is one a consumer eventually reads
 * wrong.
 *
 * The flag is a CODE, not copy. The sentence an operator reads - that the
 * dispatch notification had already run and OpenLinker sends no marketplace
 * event to withdraw it - belongs in the frontend, where operator vocabulary
 * lives and is checked.
 *
 * @module apps/api/src/shipping/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

import { ShipmentResponseDto } from './shipment-response.dto';

export class CancelShipmentResponseDto {
  @ApiProperty({ type: ShipmentResponseDto, description: 'The cancelled shipment.' })
  shipment!: ShipmentResponseDto;

  @ApiProperty({
    description:
      'The shipment had already reached `dispatched` when it was cancelled, so its dispatch ' +
      'notification had already run. OpenLinker sends NO marketplace event to withdraw it: the ' +
      "only cancellation event it carries means the buyer's ORDER was cancelled, which is a " +
      'different and usually false claim when an operator voided a label. The notification has ' +
      'to be settled with the channel by hand. Note this reports what the ROW can attest to - ' +
      'the notification advances the row both when a source applied the event and when there ' +
      'was no source to apply it, and the row does not record which.',
  })
  cancelledAfterDispatch!: boolean;

  static fromResult(
    shipment: ShipmentResponseDto,
    cancelledAfterDispatch: boolean
  ): CancelShipmentResponseDto {
    const dto = new CancelShipmentResponseDto();
    dto.shipment = shipment;
    dto.cancelledAfterDispatch = cancelledAfterDispatch;
    return dto;
  }
}

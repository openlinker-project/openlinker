/**
 * Channel Quantity Push Response DTO (#4062)
 *
 * What OpenLinker sent a channel listing for one stock movement. Returned by
 * `GET /inventory/movements/:movementId/pushes`.
 *
 * @module apps/api/src/inventory/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  ChannelQuantityPushOutcomeValues,
  type ChannelQuantityPush,
  type ChannelQuantityPushOutcome,
} from '@openlinker/core/inventory';

export class ChannelQuantityPushResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'The channel connection the quantity was written to' })
  connectionId!: string;

  @ApiProperty({ description: "The channel's own listing id (an offer or a shop product)" })
  externalOfferId!: string;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'The quantity sent after publish controls; null when none could be resolved',
  })
  quantity!: number | null;

  @ApiProperty({
    enum: ChannelQuantityPushOutcomeValues,
    description:
      '`sent`: the channel accepted it (an asynchronous channel: accepted for processing). ' +
      '`failed`: it did not land. `skipped`: the channel already carried a newer quantity.',
  })
  outcome!: ChannelQuantityPushOutcome;

  @ApiProperty({ nullable: true, type: String })
  errorCode!: string | null;

  @ApiProperty({ nullable: true, type: String })
  message!: string | null;

  @ApiProperty({ description: 'When OpenLinker made the write (ISO 8601)' })
  pushedAt!: string;
}

export class ChannelQuantityPushesResponseDto {
  @ApiProperty({ type: [ChannelQuantityPushResponseDto] })
  items!: ChannelQuantityPushResponseDto[];
}

export function toChannelQuantityPushResponseDto(push: ChannelQuantityPush): ChannelQuantityPushResponseDto {
  return {
    id: push.id,
    connectionId: push.connectionId,
    externalOfferId: push.externalOfferId,
    quantity: push.quantity,
    outcome: push.outcome,
    errorCode: push.errorCode,
    message: push.message,
    pushedAt: push.pushedAt.toISOString(),
  };
}

/**
 * Source Change Result Response DTO (#3961)
 *
 * What "Check again" or "Keep as is" did to an order whose source changed a
 * line after routing. Codes only; the frontend owns the copy.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { SourceChangeHoldCauseValues, type SourceChangeHoldCause } from '@openlinker/core/orders';

const OUTCOMES = [
  'nothing-to-do',
  'applied',
  'held',
  'shipped',
  'accepted',
  'contended',
  'failed',
] as const;

export class SourceChangeLineResponseDto {
  @ApiProperty({ description: 'The source-native order line id.' })
  orderLineId!: string;

  @ApiProperty({ description: 'Units the packing work required before the call.' })
  from!: number;

  @ApiProperty({ description: 'Units the order asks for now.' })
  to!: number;
}

export class SourceChangeResultResponseDto {
  @ApiProperty({
    enum: OUTCOMES,
    description:
      '`applied`: packing, reservation and stock moved to the new quantities. ' +
      '`held`: the box stays on hold; `cause` says why. ' +
      '`shipped`: the parcel already left, only reported. ' +
      '`accepted`: the operator kept the packing work as it is and the hold was released. ' +
      '`nothing-to-do`: the order agrees with its packing work. ' +
      '`contended`: another edit holds the order; try again. ' +
      '`failed`: a step failed and the order stays flagged.',
  })
  outcome!: (typeof OUTCOMES)[number];

  @ApiProperty({ enum: SourceChangeHoldCauseValues, nullable: true })
  cause!: SourceChangeHoldCause | null;

  @ApiProperty({ type: [SourceChangeLineResponseDto] })
  lines!: SourceChangeLineResponseDto[];
}

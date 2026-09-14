/**
 * Pack-bench work-list response DTOs (#2416, `W3b-3`)
 *
 * Field-by-field, never a spread — the same allowlist discipline
 * `FulfillmentWorkResponseDto` states, and here it is load-bearing twice over:
 * this response carries a buyer name, and it is the only response in the tree a
 * `packer` session can read a buyer name from.
 *
 * @module apps/api/src/bench/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BenchWorkStateValues, type BenchWorkState } from '../../application/types/bench-work.types';

export class BenchWorkResponseDto {
  @ApiProperty() workId!: string;
  @ApiProperty({ description: 'Optimistic token. Required to act on this parcel.' })
  version!: number;
  @ApiProperty() orderId!: string;
  @ApiProperty({
    description:
      "The source's own order reference where it has one, and the internal order id otherwise. " +
      'Never empty — it is what the bench search matches and what a packer reads aloud.',
  })
  orderReference!: string;
  @ApiPropertyOptional({
    nullable: true,
    description:
      'Buyer name as the source reported it. `null` is ordinary rather than a failure: with PII ' +
      'storage switched off there is no name to report, and the surface renders none.',
  })
  buyerName!: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Marketplace dispatch deadline.' })
  dispatchByAt!: string | null;
  @ApiProperty({ description: 'Which parcel of the order this is, 1-based.' })
  parcelIndex!: number;
  @ApiProperty({
    description:
      'How many parcels the order has in all — counting every one, whatever its state and ' +
      'whoever carries it out, so a split order is never described as whole.',
  })
  parcelTotal!: number;
  @ApiProperty() lineCount!: number;
  @ApiProperty({
    description:
      'Units to confirm against the box. This is NOT a readiness signal: OpenLinker cannot see a ' +
      'shelf and never reports that stock has been picked or gathered.',
  })
  unitsToVerify!: number;
  @ApiProperty({ enum: BenchWorkStateValues })
  state!: BenchWorkState;
  @ApiPropertyOptional({ nullable: true }) holdReason!: string | null;
  @ApiPropertyOptional({ nullable: true }) holdPlacedAt!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'When somebody moved this ahead of deadline order; null otherwise.',
  })
  expeditedAt!: string | null;
  @ApiProperty({
    type: [String],
    description: 'What is legal on this parcel now, decided server-side. Empty on a cancelled one.',
  })
  supportedActions!: string[];
}

export class BenchRoutingReadinessResponseDto {
  @ApiProperty({ description: 'Whether packing work can reach this bench at all.' })
  ready!: boolean;
  @ApiPropertyOptional({
    nullable: true,
    enum: ['no-packing-connection'],
    description:
      'Why no work can arrive. `null` when it can. Distinguishing this from an empty list is the ' +
      'whole point: "nothing to pack right now" and "nothing will ever arrive here" are different ' +
      'facts with different remedies.',
  })
  reason!: string | null;
}

export class BenchWorkListResponseDto {
  @ApiProperty({ type: [BenchWorkResponseDto] })
  works!: BenchWorkResponseDto[];
  @ApiPropertyOptional({
    nullable: true,
    description:
      'Name of the connection whose packing work this is. `null` when none is set up, or when ' +
      'several are and naming one would be arbitrary. Deliberately not a warehouse name — ' +
      'nothing tells a bench which location it stands in.',
  })
  executorName!: string | null;
  @ApiProperty({ type: BenchRoutingReadinessResponseDto })
  routing!: BenchRoutingReadinessResponseDto;
  @ApiProperty({
    description:
      'How many parcels match, which may exceed the number returned. Reported so a truncated ' +
      'list can say so rather than quietly showing part of the work.',
  })
  total!: number;
}

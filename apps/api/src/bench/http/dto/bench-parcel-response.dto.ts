/**
 * Bench parcel response DTOs (#2418, `W3b-5`, spec §§ 2.4–2.6)
 *
 * The wire shape of one box.
 *
 * ## Every one of these is an explicit ALLOWLIST
 *
 * The controller maps field by field, never by spread, and the class properties
 * below ARE the disclosure. #2413 closed `/orders` to `packer` because
 * `orderSnapshot` carries the buyer's name, email and both un-redacted addresses;
 * the bench reads the parcel through the WORK instead, and this is what it gets:
 * a reference, a name, the lines' catalogue identity, and counts. No address, no
 * email, no phone, no total, no price.
 *
 * That list is also story D4's guarantee. The surface interrupts when this
 * projection changes; there is nothing in it a buyer's address edit could move,
 * so an interruption fired by one is not something to avoid — it is not
 * expressible.
 *
 * @module apps/api/src/bench/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  ParcelReopenRefusalValues,
  ParcelVerificationRefusalValues,
} from '@openlinker/core/fulfillment';

import { BenchParcelRefusalValues } from '../../application/types/bench-parcel.types';

export class BenchParcelLineResponseDto {
  @ApiProperty({ description: 'Id of this line within the work object' })
  workLineId!: string;

  @ApiProperty({ description: 'Internal product-variant id (ol_variant_*)' })
  productVariantId!: string;

  @ApiProperty({
    nullable: true,
    description:
      "The product's name, or null when the variant is not in OpenLinker's catalogue. Null is an honest answer rather than a placeholder — the surface shows the codes instead.",
  })
  name!: string | null;

  @ApiProperty({ nullable: true })
  sku!: string | null;

  @ApiProperty({ nullable: true, description: 'EAN, as the catalogue holds it' })
  ean!: string | null;

  @ApiProperty({ nullable: true, description: 'GTIN, as the catalogue holds it' })
  gtin!: string | null;

  @ApiProperty({
    description:
      'Units this line still requires: totalQuantity minus cancelledQuantity. The same definition the work list publishes as unitsToVerify, and the same one the close predicate uses.',
  })
  requiredQuantity!: number;

  @ApiProperty({
    description:
      'Units verified into the box. Never greater than requiredQuantity — over-packing is refused at the moment it happens, not clamped afterwards.',
  })
  verifiedQuantity!: number;
}

export class BenchParcelResponseDto {
  @ApiProperty() workId!: string;

  @ApiProperty({ description: 'Optimistic token. Required on a reopen.' })
  version!: number;

  @ApiProperty({ description: "The source's own order reference, or the internal id" })
  orderReference!: string;

  @ApiProperty({
    nullable: true,
    description:
      'The buyer name, as it will appear on the label this session may print. Null under OL_STORE_PII=false, which is an ordinary answer rather than a failure.',
  })
  buyerName!: string | null;

  @ApiProperty({ description: 'Which parcel of the order this is (1-based)' })
  parcelIndex!: number;

  @ApiProperty({ description: 'How many parcels the order has in all' })
  parcelTotal!: number;

  @ApiProperty({
    nullable: true,
    enum: BenchParcelRefusalValues,
    description:
      'Why this parcel must not be packed, or null when it may be. Derived from the SAME rule that colours the work list, so the two can never disagree. A work belonging to another executor answers 404 rather than appearing here.',
  })
  refusal!: string | null;

  @ApiProperty({ nullable: true, description: 'Why it is held, when it is held' })
  holdReason!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'When the last verification shut the box, or null while it is open. There is no control that closes a parcel — it closes itself on the last verification.',
  })
  closedAt!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'The LAST verifier. Under roaming benches this may be someone who checked one item of five, so it is not a complete account of who handled the box.',
  })
  packedByUserId!: string | null;

  @ApiProperty({ type: [BenchParcelLineResponseDto] })
  lines!: BenchParcelLineResponseDto[];
}

export class BenchVerificationResultResponseDto {
  @ApiProperty({
    enum: ['verified', 'deduplicated', 'refused'],
    description:
      'verified: recorded. deduplicated: this exact gesture was already recorded — one physical action offered twice, and nothing changed. refused: nothing was recorded.',
  })
  outcome!: string;

  @ApiProperty({
    nullable: true,
    enum: ParcelVerificationRefusalValues,
    description: 'Why the unit was turned away. Null on any other outcome.',
  })
  reason!: string | null;

  @ApiProperty({
    type: BenchParcelResponseDto,
    description: 'The parcel as it now stands — returned on every outcome, including a refusal.',
  })
  parcel!: BenchParcelResponseDto;
}

export class BenchReopenResultResponseDto {
  @ApiProperty({ enum: ['reopened', 'refused'] })
  outcome!: string;

  @ApiProperty({ nullable: true, enum: ParcelReopenRefusalValues })
  reason!: string | null;

  @ApiProperty({ type: BenchParcelResponseDto })
  parcel!: BenchParcelResponseDto;
}

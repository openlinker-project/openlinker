/**
 * Bench documents response DTOs (#2418, `W3b-5`, spec § 2.6)
 *
 * What goes INSIDE the box, and what goes ON it — the organising distinction of
 * this surface, because it is the thing a packer has to get right.
 *
 * The invoice and the label are separate objects with separate states on
 * purpose: a missing document does not stop a box shipping (D17), and a missing
 * label stops it absolutely (F4). Folding them into one status would make the
 * one state this surface exists for indistinguishable from a warning.
 *
 * @module apps/api/src/bench/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class BenchInvoiceResponseDto {
  @ApiProperty({
    enum: ['ready', 'issued-not-printable', 'missing'],
    description:
      'ready: issued, and the provider can produce something printable. issued-not-printable: the document exists but only as machine-readable source, so there is nothing to fold into the box. missing: never issued — see blockReason.',
  })
  state!: string;

  @ApiProperty({ nullable: true, description: 'Null when nothing was issued' })
  invoiceId!: string | null;

  @ApiProperty({ nullable: true })
  documentNumber!: string | null;

  @ApiProperty({ nullable: true })
  issuedAt!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      "Why no document was issued, in the sales-document vocabulary the rest of the product already uses (#2100). Null when nothing recorded a reason — itself an answer, rather than something to invent one for. Packing is NEVER refused because of this.",
  })
  blockReason!: string | null;

  @ApiProperty({ nullable: true, description: 'The routing half of the same answer' })
  unresolvedReason!: string | null;
}

export class BenchLabelResponseDto {
  @ApiProperty({
    enum: ['ready', 'unavailable', 'none'],
    description:
      'ready: a label exists and can be printed. unavailable: the box is packed and cannot go out. none: no shipment for this parcel yet.',
  })
  state!: string;

  @ApiProperty({ nullable: true })
  shipmentId!: string | null;

  @ApiProperty({ nullable: true })
  carrier!: string | null;

  @ApiProperty({ nullable: true })
  trackingNumber!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      "The carrier's own short code. Never redacted — it is a discriminator, not prose.",
  })
  providerCode!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      "The carrier's own words. Null for a caller without shipments:write, because the raw rejection text may embed address fragments — the same redaction ShipmentResponseDto applies.",
  })
  carrierMessage!: string | null;

  @ApiProperty({
    description:
      'Whether a reason exists that this caller may not see. Lets the surface say "hidden from your role" instead of "the carrier gave no reason", which for a packer would otherwise be false whenever a reason exists.',
  })
  carrierMessageRedacted!: boolean;

  @ApiProperty({ nullable: true })
  failedAt!: string | null;
}

export class BenchDocumentsResponseDto {
  @ApiProperty() workId!: string;

  @ApiProperty({ type: BenchInvoiceResponseDto, description: 'Goes INSIDE the box' })
  invoice!: BenchInvoiceResponseDto;

  @ApiProperty({ type: BenchLabelResponseDto, description: 'Goes ON the box' })
  label!: BenchLabelResponseDto;
}

export class BenchUnlabelledParcelResponseDto {
  @ApiProperty() workId!: string;
  @ApiProperty() orderReference!: string;
  @ApiProperty() parcelIndex!: number;
  @ApiProperty() parcelTotal!: number;

  @ApiProperty({ nullable: true })
  closedAt!: string | null;

  @ApiProperty({ nullable: true })
  carrier!: string | null;

  @ApiProperty({
    nullable: true,
    description: "The carrier's own short code. The prose is never on this list, which two audiences read.",
  })
  providerCode!: string | null;
}

export class BenchUnlabelledParcelListResponseDto {
  @ApiProperty({ type: [BenchUnlabelledParcelResponseDto] })
  parcels!: BenchUnlabelledParcelResponseDto[];

  @ApiProperty({ description: 'How many unlabelled parcels this read found' })
  total!: number;

  @ApiProperty({ description: 'Whether the read hit its cap and there may be more' })
  truncated!: boolean;
}

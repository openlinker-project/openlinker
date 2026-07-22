/**
 * Numbering Route Response DTO (#9/#10)
 *
 * Response shape for the per-document-type routing surface. Mirrors the neutral
 * `SeriesRouteData` domain type: a detachable pointer keyed by
 * `(connectionId, documentType, register)` to the numbering series that supplies
 * that document's number.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { DocumentTypeValues } from '@openlinker/core/invoicing';

export class NumberingRouteResponseDto {
  @ApiProperty({ description: 'Connection id the route belongs to' })
  connectionId!: string;

  @ApiProperty({ description: 'Neutral document type routed by this rule (open-world)', enum: DocumentTypeValues })
  documentType!: string;

  @ApiProperty({
    description: 'Neutral register / entity scope; null = wildcard (the register-less default route)',
    nullable: true,
    type: String,
  })
  register!: string | null;

  @ApiProperty({
    description: 'ISO-4217 currency axis (#1694); null = wildcard (matches any currency)',
    nullable: true,
    type: String,
  })
  currency!: string | null;

  @ApiProperty({
    description: 'Neutral order-origin axis (#1694); null = wildcard (matches any source)',
    nullable: true,
    type: String,
  })
  source!: string | null;

  @ApiProperty({ description: 'Numbering series id this document type routes to' })
  seriesId!: string;

  @ApiProperty({ description: 'Creation timestamp (ISO 8601)' })
  createdAt!: string;

  @ApiProperty({ description: 'Last-update timestamp (ISO 8601)' })
  updatedAt!: string;
}

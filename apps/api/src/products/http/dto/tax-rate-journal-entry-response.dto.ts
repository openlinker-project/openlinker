/**
 * Tax-Rate Journal Entry Response DTO
 *
 * Wire projection of one `TaxRateJournalEntry` (#2250, ADR-052 § 4) returned by
 * `GET /products/:id/tax-rate-journal` - the latest entry per connection for
 * one catalogue item.
 *
 * A projection rather than the domain entity: the journal is provenance an
 * operator reads to attribute a disagreement, so the wire shape is an explicit
 * allowlist and stays stable if the entry grows a field.
 *
 * @module apps/api/src/products/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { TaxRateJournalOrigin, TaxRateJournalOriginValues } from '@openlinker/core/products';

export class TaxRateJournalEntryResponseDto {
  @ApiProperty({ description: 'Journal entry id' })
  id!: string;

  @ApiProperty({ description: 'Internal product ID', example: 'ol_product_xxx' })
  productId!: string;

  @ApiProperty({
    description:
      'Internal variant ID when the observation is variant-specific; null when it is about the product.',
    nullable: true,
  })
  variantId!: string | null;

  @ApiProperty({
    description:
      'The connection the observation is about - the master connection for a `shop` entry, the channel connection for the other two.',
  })
  connectionId!: string;

  @ApiProperty({
    description:
      'Where the observed rate came from. `written-by-us` is an action OpenLinker took, not an observation, so a later `channel` entry carrying a different value proves somebody changed it afterwards.',
    enum: TaxRateJournalOriginValues,
  })
  origin!: TaxRateJournalOrigin;

  @ApiProperty({
    description:
      'The neutral rate code observed (`23`, `8`, `0`, `zw`, ...), or null when the source named none.',
    nullable: true,
  })
  taxRate!: string | null;

  @ApiProperty({
    description:
      'The channel reports this field as frozen by the seller - a value a person set deliberately, which is what makes a later disagreement attributable to them rather than to OpenLinker.',
  })
  frozen!: boolean;

  @ApiProperty({ description: 'When the observation was made (ISO-8601)' })
  observedAt!: string;

  @ApiProperty({ description: 'When the row was written (ISO-8601)' })
  createdAt!: string;
}

export class TaxRateJournalResponseDto {
  @ApiProperty({
    description:
      'One entry per connection - the latest each connection holds for this item, ordered by connection.',
    type: [TaxRateJournalEntryResponseDto],
  })
  items!: TaxRateJournalEntryResponseDto[];
}

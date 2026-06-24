/**
 * Buyer Tax Id DTO (#1119)
 *
 * Scheme-tagged tax identifier (EN 16931 BT-30 / ISO 6523). PRESENCE on the
 * issue request drives the B2B/B2C axis in the mapper (present => company,
 * absent => private) — there is NO NIP/VAT logic in the API layer; `scheme` is
 * an open string the provider adapter interprets.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class BuyerTaxIdDto {
  @ApiProperty({ description: 'Open scheme tag interpreted by the adapter (e.g. pl-nip, eu-vat)' })
  @IsString()
  @IsNotEmpty()
  scheme!: string;

  @ApiProperty({ description: 'The identifier value' })
  @IsString()
  @IsNotEmpty()
  value!: string;
}

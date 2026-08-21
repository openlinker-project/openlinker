/**
 * Sales-Document Country Default Response DTO (#2170)
 *
 * @module apps/api/src/sales-documents/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import type { SalesDocumentCountryDefault } from '@openlinker/core/sales-documents';

export class SalesDocumentCountryDefaultResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  country!: string;

  @ApiProperty()
  documentKind!: string;

  @ApiProperty()
  connectionId!: string;

  static fromDomain(
    countryDefault: SalesDocumentCountryDefault,
  ): SalesDocumentCountryDefaultResponseDto {
    const dto = new SalesDocumentCountryDefaultResponseDto();
    dto.id = countryDefault.id;
    dto.country = countryDefault.country;
    dto.documentKind = countryDefault.documentKind;
    dto.connectionId = countryDefault.connectionId;
    return dto;
  }
}

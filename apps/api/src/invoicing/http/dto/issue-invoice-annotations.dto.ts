/**
 * Per-issue fiscal annotations (DEF-20)
 *
 * What an operator may state about ONE sale when issuing by hand: the
 * annotation flags, the parties besides seller and buyer, and per-line
 * classification markers. Neutral vocabulary only - the provider adapter maps
 * each field to its regime (KSeF: Adnotacje, Podmiot3, GTU / Procedura), and
 * the codes it offers are the adapter's own (ADR-026).
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ExemptionBasisKindValues, MarginSchemeKindValues } from '@openlinker/core/invoicing';
import { BuyerTaxIdDto } from './buyer-tax-id.dto';

export class ExemptionBasisDto {
  @ApiProperty({ enum: ExemptionBasisKindValues, description: 'What the grounds cite' })
  @IsIn(ExemptionBasisKindValues)
  kind!: 'statute' | 'directive' | 'other';

  @ApiProperty({ description: 'The grounds, e.g. "art. 43 ust. 1 pkt 19 ustawy o VAT"' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  text!: string;
}

export class InvoiceAnnotationsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() cashAccounting?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() selfBilling?: boolean;
  @ApiPropertyOptional({ description: 'Split payment applies (never set automatically)' })
  @IsOptional()
  @IsBoolean()
  splitPayment?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() triangulation?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() marginScheme?: boolean;

  @ApiPropertyOptional({ enum: MarginSchemeKindValues })
  @IsOptional()
  @IsIn(MarginSchemeKindValues)
  marginKind?: 'travel-services' | 'used-goods' | 'works-of-art' | 'collectors-items';

  @ApiPropertyOptional({ type: ExemptionBasisDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ExemptionBasisDto)
  exemptionBasis?: ExemptionBasisDto;
}

export class AdditionalPartyAddressDto {
  @ApiProperty() @IsString() @IsNotEmpty() line1!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() line2?: string;
  @ApiProperty() @IsString() @IsNotEmpty() city!: string;
  @ApiProperty() @IsString() @IsNotEmpty() postalCode!: string;
  @ApiProperty() @IsString() @IsNotEmpty() countryIso2!: string;
}

export class AdditionalPartyDto {
  @ApiProperty({ description: "The provider's role code (KSeF: TRolaPodmiotu3, e.g. 8 or 10)" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  role!: string;

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(512) name!: string;

  @ApiPropertyOptional({ type: BuyerTaxIdDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BuyerTaxIdDto)
  taxId?: BuyerTaxIdDto;

  @ApiPropertyOptional({ type: AdditionalPartyAddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AdditionalPartyAddressDto)
  address?: AdditionalPartyAddressDto;
}

export class LineClassificationDto {
  @ApiProperty({ description: 'Order line id the markers apply to' })
  @IsString()
  @IsNotEmpty()
  orderLineId!: string;

  @ApiPropertyOptional({ description: 'Goods/services group marker (KSeF: GTU_01..GTU_13)' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  gtuCode?: string;

  @ApiPropertyOptional({ description: 'Procedure marker (KSeF: e.g. WSTO_EE, TP)' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  procedureCode?: string;
}

/** Upper bound on the per-issue lists, so a request cannot balloon a document. */
export const ANNOTATION_LIST_LIMIT = 100;

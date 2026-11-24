/**
 * Sales Document Settings DTOs (#3941)
 *
 * @module apps/api/src/sales-documents/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, Matches, ValidateIf } from 'class-validator';
import {
  GiftDocumentFormChoiceValues,
  type GiftDocumentFormChoice,
  type GiftDocumentFormSetting,
} from '@openlinker/core/sales-documents';

export class SetSalesDocumentSettingsDto {
  @ApiProperty({
    enum: GiftDocumentFormChoiceValues,
    description: 'The OpenLinker-wide form a gift takes on a document',
  })
  @IsIn(GiftDocumentFormChoiceValues as readonly string[])
  giftDocumentForm!: GiftDocumentFormChoice;

  @ApiPropertyOptional({
    type: String,
    description:
      'Gross unit price per gift unit for custom-price: a positive decimal string with at most 2 decimals. Required with custom-price, ignored otherwise.',
  })
  @ValidateIf((o: { giftDocumentForm?: string }) => o.giftDocumentForm === 'custom-price')
  @Matches(/^(?!0+(\.0+)?$)\d+(\.\d{1,2})?$/, { message: 'giftDocumentUnitPrice must be a decimal with at most 2 decimals' })
  giftDocumentUnitPrice?: string;
}

export class SalesDocumentSettingsResponseDto {
  @ApiProperty({ enum: GiftDocumentFormChoiceValues })
  giftDocumentForm!: GiftDocumentFormChoice;

  @ApiProperty({ type: String, nullable: true, description: 'Set only for custom-price' })
  giftDocumentUnitPrice!: string | null;

  @ApiProperty({
    enum: ['setting', 'default'],
    description: 'Where the value came from: a saved choice, or the code default',
  })
  giftDocumentFormSource!: 'setting' | 'default';

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  updatedAt!: string | null;

  static fromSetting(setting: GiftDocumentFormSetting): SalesDocumentSettingsResponseDto {
    const dto = new SalesDocumentSettingsResponseDto();
    dto.giftDocumentForm = setting.form;
    dto.giftDocumentUnitPrice = setting.unitPrice;
    dto.giftDocumentFormSource = setting.source;
    dto.updatedAt = setting.updatedAt?.toISOString() ?? null;
    return dto;
  }
}

export class SalesDocumentProviderZeroSupportDto {
  @ApiProperty() connectionId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() platformType!: string;
  @ApiProperty({ enum: ['invoice', 'fiscal-receipt'] }) kind!: 'invoice' | 'fiscal-receipt';
  @ApiProperty({
    type: Boolean,
    nullable: true,
    description:
      'Whether the provider declares it accepts a 0.00 line. null = it declares nothing. A receipt always reads false.',
  })
  acceptsZeroValueLine!: boolean | null;
}

export class SalesDocumentProvidersResponseDto {
  @ApiProperty({ type: [SalesDocumentProviderZeroSupportDto] })
  providers!: SalesDocumentProviderZeroSupportDto[];
}

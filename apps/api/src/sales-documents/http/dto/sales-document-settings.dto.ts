/**
 * Sales Document Settings DTOs (#3941)
 *
 * @module apps/api/src/sales-documents/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
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
}

export class SalesDocumentSettingsResponseDto {
  @ApiProperty({ enum: GiftDocumentFormChoiceValues })
  giftDocumentForm!: GiftDocumentFormChoice;

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

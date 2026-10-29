/**
 * Send Receipt Email Request DTO (#3550)
 *
 * Body of `POST /fiscal-registrations/:id/send-email`. A receipt is emailed by
 * OpenLinker's mailer only (no provider has an email capability for receipts),
 * so there is no `sendCopy`.
 *
 * @module apps/api/src/fiscalization/http/dto
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const ReceiptEmailLocaleValues = ['pl', 'en'] as const;

export class SendReceiptEmailRequestDto {
  @ApiPropertyOptional({
    description:
      "Where to send it. Defaults to the buyer's address on the order. Validated server-side.",
    maxLength: 254,
  })
  @IsOptional()
  @IsString()
  @MaxLength(254)
  recipient?: string;

  @ApiPropertyOptional({ enum: ReceiptEmailLocaleValues, description: 'Language of the message.' })
  @IsOptional()
  @IsIn(ReceiptEmailLocaleValues)
  locale?: 'pl' | 'en';
}

/**
 * Send Buyer Email Test Request DTO (#3555)
 *
 * `POST /buyer-emails/test` - the template editor's "Send a test email".
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import {
  BuyerEmailTemplateValues,
  type BuyerEmailTemplate,
} from '@openlinker/core/identifier-mapping';

export class SendBuyerEmailTestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  connectionId!: string;

  @ApiProperty({ enum: BuyerEmailTemplateValues })
  @IsIn(BuyerEmailTemplateValues)
  templateKey!: BuyerEmailTemplate;

  @ApiProperty({ description: 'One address to send the test to.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(320)
  to!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(998)
  subject!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  body!: string;
}

export class SendBuyerEmailTestResponseDto {
  @ApiProperty({ enum: ['sent'] })
  status!: 'sent';
}

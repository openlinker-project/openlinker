/**
 * Update Mailer Settings DTO
 *
 * Request body for `PUT /mailer-settings`. Non-secret transport fields only
 * — the SMTP password is written separately via
 * `PUT /mailer-settings/credentials`. `smtpHost`/`smtpPort` are required
 * when `transport === 'smtp'`; the controller does not cross-validate this
 * (matching the AI settings precedent of trusting the admin form) so an
 * operator can stage a partial SMTP config before switching transport.
 *
 * @module apps/api/src/mailer/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { MailerTransport, MailerTransportValues } from '@openlinker/core/mailer';

export class UpdateMailerSettingsDto {
  @ApiProperty({ enum: MailerTransportValues })
  @IsIn(MailerTransportValues as unknown as string[])
  transport!: MailerTransport;

  @ApiProperty({ type: String, nullable: true, description: 'SMTP server host.' })
  @IsOptional()
  @IsString()
  smtpHost?: string | null;

  @ApiProperty({ type: Number, nullable: true, description: 'SMTP server port.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  smtpPort?: number | null;

  @ApiProperty({ description: 'Use implicit TLS (true) vs STARTTLS/plain (false).' })
  @IsBoolean()
  smtpSecure!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Default From address for outbound mail.',
  })
  @IsOptional()
  @IsString()
  fromAddress?: string | null;
}

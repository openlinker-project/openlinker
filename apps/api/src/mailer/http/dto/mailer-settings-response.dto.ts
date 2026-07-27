/**
 * Mailer Settings Response DTO
 *
 * Response body for `GET /mailer-settings`. Reports the non-secret
 * transport fields plus whether an SMTP password is currently configured
 * (DB or env) — the password value itself never leaves the server.
 *
 * @module apps/api/src/mailer/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  MailerTransport,
  MailerTransportValues,
  type MailerSettingsView,
} from '@openlinker/core/mailer';

export class MailerSettingsResponseDto {
  @ApiProperty({ enum: MailerTransportValues })
  transport!: MailerTransport;

  @ApiProperty({ type: String, nullable: true })
  smtpHost!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  smtpPort!: number | null;

  @ApiProperty()
  smtpSecure!: boolean;

  @ApiProperty({ type: String, nullable: true })
  fromAddress!: string | null;

  @ApiProperty({ description: 'True when an SMTP password is currently resolvable (DB or env).' })
  smtpPasswordConfigured!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'When the settings were last changed. `null` when no row exists yet.',
  })
  updatedAt!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Who last changed the settings. `null` when no row exists yet.',
  })
  updatedBy!: string | null;

  static fromView(view: MailerSettingsView): MailerSettingsResponseDto {
    const dto = new MailerSettingsResponseDto();
    dto.transport = view.transport;
    dto.smtpHost = view.smtpHost;
    dto.smtpPort = view.smtpPort;
    dto.smtpSecure = view.smtpSecure;
    dto.fromAddress = view.fromAddress;
    dto.smtpPasswordConfigured = view.smtpPasswordConfigured;
    dto.updatedAt = view.updatedAt ? view.updatedAt.toISOString() : null;
    dto.updatedBy = view.updatedBy;
    return dto;
  }
}

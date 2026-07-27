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
import type { ValidatorConstraintInterface } from 'class-validator';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  Validate,
  ValidatorConstraint,
} from 'class-validator';
import { MailerTransport, MailerTransportValues } from '@openlinker/core/mailer';

// Mirrors apps/web/src/features/mailer-settings/components/mailer-settings-form.schema.ts
// (EMAIL_PATTERN / NAME_AND_EMAIL_PATTERN, from PR #1761) — keep both sides in sync if
// either changes (see #1761 / #1765). Excludes `<`/`>` (in addition to whitespace/`@`) so a
// stray bracket can't be swallowed into the local-part or domain, and the `(?!.*\.\.)`
// lookahead rejects consecutive dots.
const EMAIL_PATTERN = /^(?!.*\.\.)[^\s@<>.][^\s@<>]*@[^\s@<>.][^\s@<>]*\.[^\s@<>]+$/;
// Matches `Display Name <email@domain.com>`. The name segment excludes `<`/`>` so a second
// bracketed address fails the match instead of silently picking one, and excludes CR/LF so
// a CRLF-carrying name can't smuggle a second mail header (email-header-injection).
const NAME_AND_EMAIL_PATTERN = /^[^<>\r\n]+\s<([^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)>$/;

function isValidFromAddress(value: string): boolean {
  if (EMAIL_PATTERN.test(value)) {
    return true;
  }
  const match = NAME_AND_EMAIL_PATTERN.exec(value);
  return match !== null && EMAIL_PATTERN.test(match[1]);
}

@ValidatorConstraint({ name: 'fromAddressShape', async: false })
class FromAddressShapeConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string' || value.length === 0) {
      return true; // empty/absent handled by @IsOptional(); not a header-injection vector
    }
    return isValidFromAddress(value);
  }
  defaultMessage(): string {
    return 'fromAddress must be a valid email address, optionally with a display name (e.g. "OpenLinker <noreply@example.com>")';
  }
}

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
  @Validate(FromAddressShapeConstraint)
  fromAddress?: string | null;
}

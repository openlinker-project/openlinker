/**
 * Update Login Page Settings DTO
 *
 * Request body for `PUT /login-page-settings` (#4028). Per language, every
 * field is optional: an omitted field is left as it was, and `null` or an
 * empty string clears it back to env and then the frontend's default.
 *
 * Length is checked by `LoginPageSettingsService` after trimming, against
 * `LOGIN_PAGE_COPY_MAX_LENGTH`; the `maxLength` here only documents it.
 *
 * @module apps/api/src/login-page-settings/http/dto
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, ValidateIf, ValidateNested } from 'class-validator';
import { LOGIN_PAGE_COPY_MAX_LENGTH } from '@openlinker/core/login-page-settings';

const MAX = LOGIN_PAGE_COPY_MAX_LENGTH;

export class LoginPageCopyInputDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: MAX.headline })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  headline?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: MAX.headlineAccent })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  headlineAccent?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: MAX.lead })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  lead?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: MAX.formTitle })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  formTitle?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: MAX.formSubtitle })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  formSubtitle?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: MAX.support })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  support?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: MAX.registerTitle })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  registerTitle?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: MAX.registerSubtitle })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  registerSubtitle?: string | null;
}

export class UpdateLoginPageSettingsDto {
  @ApiPropertyOptional({ type: LoginPageCopyInputDto, description: 'Polish copy overrides.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => LoginPageCopyInputDto)
  pl?: LoginPageCopyInputDto;

  @ApiPropertyOptional({ type: LoginPageCopyInputDto, description: 'English copy overrides.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => LoginPageCopyInputDto)
  en?: LoginPageCopyInputDto;

  @ApiPropertyOptional({
    type: Boolean,
    nullable: true,
    description:
      'Offer a request for access on the login page and accept one. `null` hands the decision back to OL_REGISTRATION_ENABLED.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsBoolean()
  registrationEnabled?: boolean | null;
}

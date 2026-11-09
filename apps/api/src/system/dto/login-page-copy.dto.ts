/**
 * Login Page Copy DTO
 *
 * The login-page copy overrides carried on the public `GET /system/config`
 * (#4028): per language, only the fields an admin or env set. A missing field
 * means the frontend shows its own catalog default.
 *
 * @module apps/api/src/system/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginPageCopyOverridesDto {
  @ApiPropertyOptional() headline?: string;
  @ApiPropertyOptional() headlineAccent?: string;
  @ApiPropertyOptional() lead?: string;
  @ApiPropertyOptional() formTitle?: string;
  @ApiPropertyOptional() formSubtitle?: string;
  @ApiPropertyOptional() support?: string;
  @ApiPropertyOptional() registerTitle?: string;
  @ApiPropertyOptional() registerSubtitle?: string;
}

export class LoginPageCopyDto {
  @ApiProperty({ type: LoginPageCopyOverridesDto })
  pl!: LoginPageCopyOverridesDto;

  @ApiProperty({ type: LoginPageCopyOverridesDto })
  en!: LoginPageCopyOverridesDto;
}

/**
 * Login Page Settings Response DTO
 *
 * `GET /login-page-settings` (#4028): every field per language with the rung
 * that produced it. `source: 'default'` carries `value: null`; the frontend
 * then shows its own catalog text.
 *
 * @module apps/api/src/login-page-settings/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  LoginPageCopySourceValues,
  type LoginPageCopyField,
  type LoginPageCopySource,
  type LoginPageSettingsView,
  type ResolvedLoginPageField,
} from '@openlinker/core/login-page-settings';

export class ResolvedLoginPageFieldDto {
  @ApiProperty({ type: String, nullable: true })
  value!: string | null;

  @ApiProperty({ enum: LoginPageCopySourceValues })
  source!: LoginPageCopySource;
}

export class ResolvedLoginPageCopyDto {
  @ApiProperty({ type: ResolvedLoginPageFieldDto })
  headline!: ResolvedLoginPageFieldDto;

  @ApiProperty({ type: ResolvedLoginPageFieldDto })
  headlineAccent!: ResolvedLoginPageFieldDto;

  @ApiProperty({ type: ResolvedLoginPageFieldDto })
  lead!: ResolvedLoginPageFieldDto;

  @ApiProperty({ type: ResolvedLoginPageFieldDto })
  formTitle!: ResolvedLoginPageFieldDto;

  @ApiProperty({ type: ResolvedLoginPageFieldDto })
  formSubtitle!: ResolvedLoginPageFieldDto;

  @ApiProperty({ type: ResolvedLoginPageFieldDto })
  support!: ResolvedLoginPageFieldDto;

  @ApiProperty({ type: ResolvedLoginPageFieldDto })
  registerTitle!: ResolvedLoginPageFieldDto;

  @ApiProperty({ type: ResolvedLoginPageFieldDto })
  registerSubtitle!: ResolvedLoginPageFieldDto;
}

export class ResolvedLoginPageLocalesDto {
  @ApiProperty({ type: ResolvedLoginPageCopyDto })
  pl!: ResolvedLoginPageCopyDto;

  @ApiProperty({ type: ResolvedLoginPageCopyDto })
  en!: ResolvedLoginPageCopyDto;
}

export class ResolvedRegistrationDto {
  @ApiProperty() value!: boolean;

  @ApiProperty({ enum: LoginPageCopySourceValues })
  source!: LoginPageCopySource;
}

export class LoginPageMaxLengthDto {
  @ApiProperty() headline!: number;
  @ApiProperty() headlineAccent!: number;
  @ApiProperty() lead!: number;
  @ApiProperty() formTitle!: number;
  @ApiProperty() formSubtitle!: number;
  @ApiProperty() support!: number;
  @ApiProperty() registerTitle!: number;
  @ApiProperty() registerSubtitle!: number;
}

export class LoginPageSettingsResponseDto {
  @ApiProperty({ type: ResolvedLoginPageLocalesDto })
  copy!: ResolvedLoginPageLocalesDto;

  @ApiProperty({ type: ResolvedRegistrationDto })
  registration!: ResolvedRegistrationDto;

  @ApiProperty({ type: LoginPageMaxLengthDto })
  maxLength!: LoginPageMaxLengthDto;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  updatedAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  updatedBy!: string | null;

  static fromView(view: LoginPageSettingsView): LoginPageSettingsResponseDto {
    const copyOf = (
      fields: Record<LoginPageCopyField, ResolvedLoginPageField>
    ): ResolvedLoginPageCopyDto => ({
      headline: { ...fields.headline },
      headlineAccent: { ...fields.headlineAccent },
      lead: { ...fields.lead },
      formTitle: { ...fields.formTitle },
      formSubtitle: { ...fields.formSubtitle },
      support: { ...fields.support },
      registerTitle: { ...fields.registerTitle },
      registerSubtitle: { ...fields.registerSubtitle },
    });
    return {
      copy: { pl: copyOf(view.copy.pl), en: copyOf(view.copy.en) },
      registration: { ...view.registration },
      maxLength: { ...view.maxLength },
      updatedAt: view.updatedAt ? view.updatedAt.toISOString() : null,
      updatedBy: view.updatedBy,
    };
  }
}

/**
 * Login Page Settings Domain Entity
 *
 * The singleton row holding an admin's per-language login-page copy overrides
 * (#4028). Only fields the admin set are present; everything else resolves
 * through env and then the frontend's catalog default.
 *
 * @module libs/core/src/login-page-settings/domain/entities
 */
import type { LoginPageCopyByLocale } from '../types/login-page-settings.types';

export const LOGIN_PAGE_SETTINGS_SINGLETON_ID = 'singleton';

export class LoginPageSettings {
  constructor(
    public readonly copy: LoginPageCopyByLocale,
    /** `null` = not set here; `OL_REGISTRATION_ENABLED` decides. */
    public readonly registrationEnabled: boolean | null,
    public readonly updatedAt: Date,
    public readonly updatedBy: string | null
  ) {}
}

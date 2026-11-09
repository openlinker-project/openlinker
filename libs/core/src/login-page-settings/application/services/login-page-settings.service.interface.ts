/**
 * Login Page Settings Service Interface
 *
 * Reads the effective login-page copy (each field with the rung that produced
 * it) and applies admin writes.
 *
 * @module libs/core/src/login-page-settings/application/services
 */
import type {
  LoginPageCopyByLocale,
  LoginPageSettingsInput,
  LoginPageSettingsView,
} from '../../domain/types/login-page-settings.types';

export interface ILoginPageSettingsService {
  resolve(): Promise<LoginPageSettingsView>;

  /** Only the overrides (row or env) per language, for the public system config. */
  resolvePublicCopy(): Promise<LoginPageCopyByLocale>;

  /** Whether the login page offers sign-up / a request for access, and the API accepts one. */
  isRegistrationEnabled(): Promise<boolean>;

  /** @throws InvalidLoginPageSettingError on an unknown field or an over-length value */
  updateSettings(input: LoginPageSettingsInput, updatedBy: string | null): Promise<void>;
}

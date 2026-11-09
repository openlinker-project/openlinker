/**
 * Login Page Settings Types
 *
 * Mirrors `GET/PUT /login-page-settings` (#4028): per language, each field
 * with the rung that produced it. `source: 'default'` carries `value: null`,
 * meaning the login page shows its own catalog text.
 *
 * @module features/login-page-settings/api
 */
import type { LoginPageCopyField } from '../../system';

export const LoginPageLocaleValues = ['pl', 'en'] as const;
export type LoginPageLocale = (typeof LoginPageLocaleValues)[number];

export type LoginPageCopySource = 'setting' | 'env' | 'default';

export interface ResolvedLoginPageField {
  value: string | null;
  source: LoginPageCopySource;
}

export type ResolvedLoginPageCopy = Record<LoginPageCopyField, ResolvedLoginPageField>;

export interface LoginPageSettingsView {
  copy: Record<LoginPageLocale, ResolvedLoginPageCopy>;
  /** Whether the login page offers a request for access, and who decided it. */
  registration: { value: boolean; source: LoginPageCopySource };
  maxLength: Record<LoginPageCopyField, number>;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** An empty string or `null` clears a field back to env and then the default. */
export type UpdateLoginPageSettingsInput = Partial<
  Record<LoginPageLocale, Partial<Record<LoginPageCopyField, string | null>>>
> & { registrationEnabled?: boolean | null };

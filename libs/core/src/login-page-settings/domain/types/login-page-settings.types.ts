/**
 * Login Page Settings Types
 *
 * The closed vocabulary of login-page copy an admin may override on a real
 * install (#4028), plus the pure rules that normalise a write and resolve a
 * field through its ladder: stored row, then env var, then the frontend's own
 * catalog default. The API never holds default copy; "default" means the API
 * returns nothing and the browser falls back to its catalog.
 *
 * @module libs/core/src/login-page-settings/domain/types
 */
import { InvalidLoginPageSettingError } from '../exceptions/login-page-settings.exception';

export const LoginPageCopyFieldValues = [
  'headline',
  'headlineAccent',
  'lead',
  'formTitle',
  'formSubtitle',
  'support',
  'registerTitle',
  'registerSubtitle',
] as const;
export type LoginPageCopyField = (typeof LoginPageCopyFieldValues)[number];

export const LoginPageLocaleValues = ['pl', 'en'] as const;
export type LoginPageLocale = (typeof LoginPageLocaleValues)[number];

export const LoginPageCopySourceValues = ['setting', 'env', 'default'] as const;
export type LoginPageCopySource = (typeof LoginPageCopySourceValues)[number];

export type LoginPageCopy = Partial<Record<LoginPageCopyField, string>>;
export type LoginPageCopyByLocale = Record<LoginPageLocale, LoginPageCopy>;

/**
 * `null` or an empty string clears a stored copy override back to env/default;
 * `registrationEnabled: null` hands the decision back to `OL_REGISTRATION_ENABLED`.
 */
export type LoginPageSettingsInput = Partial<
  Record<LoginPageLocale, Partial<Record<LoginPageCopyField, string | null>>>
> & { registrationEnabled?: boolean | null };

export interface ResolvedRegistration {
  /** True when the login page offers sign-up (demo) or a request for access. */
  value: boolean;
  source: LoginPageCopySource;
}

export interface ResolvedLoginPageField {
  value: string | null;
  source: LoginPageCopySource;
}

export type ResolvedLoginPageCopy = Record<
  LoginPageLocale,
  Record<LoginPageCopyField, ResolvedLoginPageField>
>;

export interface LoginPageSettingsView {
  copy: ResolvedLoginPageCopy;
  registration: ResolvedRegistration;
  maxLength: Record<LoginPageCopyField, number>;
  updatedAt: Date | null;
  updatedBy: string | null;
}

export const LOGIN_PAGE_COPY_MAX_LENGTH: Record<LoginPageCopyField, number> = {
  headline: 60,
  headlineAccent: 60,
  lead: 280,
  formTitle: 60,
  formSubtitle: 140,
  // Rich text (a link to the operator's own help page), so room for its markup.
  support: 500,
  registerTitle: 60,
  registerSubtitle: 140,
};

const ENV_FIELD_SEGMENT: Record<LoginPageCopyField, string> = {
  headline: 'HEADLINE',
  headlineAccent: 'HEADLINE_ACCENT',
  lead: 'LEAD',
  formTitle: 'FORM_TITLE',
  formSubtitle: 'FORM_SUBTITLE',
  support: 'SUPPORT',
  registerTitle: 'REGISTER_TITLE',
  registerSubtitle: 'REGISTER_SUBTITLE',
};

/** `OL_LOGIN_{FIELD}_{LOCALE}`, e.g. `OL_LOGIN_FORM_TITLE_PL`. */
export function loginPageEnvVarName(field: LoginPageCopyField, locale: LoginPageLocale): string {
  return `OL_LOGIN_${ENV_FIELD_SEGMENT[field]}_${locale.toUpperCase()}`;
}

export function emptyLoginPageCopy(): LoginPageCopyByLocale {
  return { pl: {}, en: {} };
}

/** Coerces an untrusted stored jsonb value into the closed shape, dropping anything unknown. */
export function readLoginPageCopy(raw: unknown): LoginPageCopyByLocale {
  const result = emptyLoginPageCopy();
  if (!raw || typeof raw !== 'object') return result;
  const source = raw as Record<string, unknown>;
  for (const locale of LoginPageLocaleValues) {
    const fields = source[locale];
    if (!fields || typeof fields !== 'object') continue;
    for (const field of LoginPageCopyFieldValues) {
      const value = (fields as Record<string, unknown>)[field];
      if (typeof value === 'string' && value.trim() !== '') {
        result[locale][field] = value.trim();
      }
    }
  }
  return result;
}

/**
 * Applies a write onto the stored copy: trims, clears on empty or null, and
 * refuses an unknown language or field and an over-length value. Returns a new
 * object; the input is not mutated.
 */
export function applyLoginPageCopyInput(
  current: LoginPageCopyByLocale,
  input: LoginPageSettingsInput
): LoginPageCopyByLocale {
  const next: LoginPageCopyByLocale = { pl: { ...current.pl }, en: { ...current.en } };
  for (const [locale, fields] of Object.entries(input)) {
    if (locale === 'registrationEnabled') continue;
    if (!(LoginPageLocaleValues as readonly string[]).includes(locale)) {
      throw new InvalidLoginPageSettingError(locale, `Unknown language "${locale}".`);
    }
    if (fields === undefined || fields === null || typeof fields !== 'object') continue;
    const target = next[locale as LoginPageLocale];
    for (const [field, value] of Object.entries(fields)) {
      const path = `${locale}.${field}`;
      if (!(LoginPageCopyFieldValues as readonly string[]).includes(field)) {
        throw new InvalidLoginPageSettingError(path, `Unknown field "${path}".`);
      }
      if (value === undefined) continue;
      const key = field as LoginPageCopyField;
      const trimmed = value === null ? '' : value.trim();
      if (trimmed === '') {
        delete target[key];
        continue;
      }
      const max = LOGIN_PAGE_COPY_MAX_LENGTH[key];
      if (trimmed.length > max) {
        throw new InvalidLoginPageSettingError(path, `${path} is longer than ${max} characters.`);
      }
      target[key] = trimmed;
    }
  }
  return next;
}

export const REGISTRATION_ENABLED_ENV_VAR = 'OL_REGISTRATION_ENABLED';

/** Registration: the admin's choice, then `OL_REGISTRATION_ENABLED`, then off. */
export function resolveRegistration(
  stored: boolean | null,
  readEnv: (name: string) => string | undefined
): ResolvedRegistration {
  if (stored !== null) return { value: stored, source: 'setting' };
  const env = readEnv(REGISTRATION_ENABLED_ENV_VAR)?.trim().toLowerCase();
  if (env) return { value: env === 'true', source: 'env' };
  return { value: false, source: 'default' };
}

/** Resolves every field and language: row, then env, then default (no value). */
export function resolveLoginPageCopy(
  stored: LoginPageCopyByLocale,
  readEnv: (name: string) => string | undefined
): ResolvedLoginPageCopy {
  const resolveLocale = (
    locale: LoginPageLocale
  ): Record<LoginPageCopyField, ResolvedLoginPageField> => {
    const out = {} as Record<LoginPageCopyField, ResolvedLoginPageField>;
    for (const field of LoginPageCopyFieldValues) {
      const setting = stored[locale][field];
      if (setting) {
        out[field] = { value: setting, source: 'setting' };
        continue;
      }
      const env = readEnv(loginPageEnvVarName(field, locale))?.trim();
      if (env) {
        out[field] = { value: env.slice(0, LOGIN_PAGE_COPY_MAX_LENGTH[field]), source: 'env' };
        continue;
      }
      out[field] = { value: null, source: 'default' };
    }
    return out;
  };
  return { pl: resolveLocale('pl'), en: resolveLocale('en') };
}

/** The overrides only, without sources: what the public system config carries. */
export function toPublicLoginPageCopy(copy: ResolvedLoginPageCopy): LoginPageCopyByLocale {
  const result = emptyLoginPageCopy();
  for (const locale of LoginPageLocaleValues) {
    for (const field of LoginPageCopyFieldValues) {
      const value = copy[locale][field].value;
      if (value !== null) result[locale][field] = value;
    }
  }
  return result;
}

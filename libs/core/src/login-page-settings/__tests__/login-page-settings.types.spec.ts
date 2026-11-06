/**
 * Login Page Settings Types Spec
 *
 * Covers the resolution ladder (row -> env -> default), the write rules (trim,
 * clear on empty, refuse unknown fields and over-length values) and the
 * public projection that carries overrides only.
 *
 * @module libs/core/src/login-page-settings/__tests__
 */
import { InvalidLoginPageSettingError } from '../domain/exceptions/login-page-settings.exception';
import {
  LOGIN_PAGE_COPY_MAX_LENGTH,
  applyLoginPageCopyInput,
  emptyLoginPageCopy,
  loginPageEnvVarName,
  readLoginPageCopy,
  resolveRegistration,
  resolveLoginPageCopy,
  toPublicLoginPageCopy,
  type LoginPageSettingsInput,
} from '../domain/types/login-page-settings.types';

describe('login page settings rules', () => {
  describe('loginPageEnvVarName', () => {
    it('should build OL_LOGIN_{FIELD}_{LOCALE} when given a camelCase field', () => {
      expect(loginPageEnvVarName('formTitle', 'pl')).toBe('OL_LOGIN_FORM_TITLE_PL');
      expect(loginPageEnvVarName('headlineAccent', 'en')).toBe('OL_LOGIN_HEADLINE_ACCENT_EN');
    });
  });

  describe('resolveLoginPageCopy', () => {
    it('should prefer the stored value over env when both are set', () => {
      const stored = emptyLoginPageCopy();
      stored.pl.headline = 'Z wiersza';
      const view = resolveLoginPageCopy(stored, () => 'Z env');
      expect(view.pl.headline).toEqual({ value: 'Z wiersza', source: 'setting' });
    });

    it('should fall back to env when no row value exists', () => {
      const env: Record<string, string> = { OL_LOGIN_LEAD_EN: '  From env  ' };
      const view = resolveLoginPageCopy(emptyLoginPageCopy(), (name) => env[name]);
      expect(view.en.lead).toEqual({ value: 'From env', source: 'env' });
    });

    it('should report default with no value when neither row nor env is set', () => {
      const view = resolveLoginPageCopy(emptyLoginPageCopy(), () => undefined);
      expect(view.pl.support).toEqual({ value: null, source: 'default' });
    });

    it('should cut an env value to the field maximum when it is too long', () => {
      const long = 'x'.repeat(500);
      const view = resolveLoginPageCopy(emptyLoginPageCopy(), () => long);
      expect(view.pl.headline.value).toHaveLength(LOGIN_PAGE_COPY_MAX_LENGTH.headline);
    });
  });

  describe('applyLoginPageCopyInput', () => {
    it('should trim and store a value when given whitespace around it', () => {
      const next = applyLoginPageCopyInput(emptyLoginPageCopy(), { pl: { headline: '  Panel  ' } });
      expect(next.pl.headline).toBe('Panel');
    });

    it('should clear a stored value when given an empty string or null', () => {
      const current = emptyLoginPageCopy();
      current.en.lead = 'Old';
      current.en.support = 'Old support';
      const next = applyLoginPageCopyInput(current, { en: { lead: '   ', support: null } });
      expect(next.en).toEqual({});
    });

    it('should leave omitted fields untouched when given a partial write', () => {
      const current = emptyLoginPageCopy();
      current.pl.formTitle = 'Zaloguj się';
      const next = applyLoginPageCopyInput(current, { en: { headline: 'Sales panel' } });
      expect(next.pl.formTitle).toBe('Zaloguj się');
      expect(current.en.headline).toBeUndefined();
    });

    it('should refuse a value over the maximum length and name the field', () => {
      const tooLong = 'x'.repeat(LOGIN_PAGE_COPY_MAX_LENGTH.formSubtitle + 1);
      expect(() =>
        applyLoginPageCopyInput(emptyLoginPageCopy(), { pl: { formSubtitle: tooLong } })
      ).toThrow(InvalidLoginPageSettingError);
      expect(() =>
        applyLoginPageCopyInput(emptyLoginPageCopy(), { pl: { formSubtitle: tooLong } })
      ).toThrow('pl.formSubtitle');
    });

    it('should refuse an unknown language or field', () => {
      const unknownLocale = { de: { headline: 'x' } } as unknown as LoginPageSettingsInput;
      const unknownField = { pl: { footer: 'x' } } as unknown as LoginPageSettingsInput;
      expect(() => applyLoginPageCopyInput(emptyLoginPageCopy(), unknownLocale)).toThrow(
        InvalidLoginPageSettingError
      );
      expect(() => applyLoginPageCopyInput(emptyLoginPageCopy(), unknownField)).toThrow(
        InvalidLoginPageSettingError
      );
    });
  });

  describe('readLoginPageCopy', () => {
    it('should drop unknown keys and non-strings when given untrusted jsonb', () => {
      expect(
        readLoginPageCopy({ pl: { headline: 'Ok', footer: 'x', lead: 3 }, de: { headline: 'x' } })
      ).toEqual({ pl: { headline: 'Ok' }, en: {} });
      expect(readLoginPageCopy(null)).toEqual({ pl: {}, en: {} });
    });
  });

  describe('resolveRegistration', () => {
    it('should resolve the stored choice, then env, then off', () => {
      expect(resolveRegistration(true, () => 'false')).toEqual({ value: true, source: 'setting' });
      expect(resolveRegistration(null, () => ' TRUE ')).toEqual({ value: true, source: 'env' });
      expect(resolveRegistration(null, () => 'no')).toEqual({ value: false, source: 'env' });
      expect(resolveRegistration(null, () => undefined)).toEqual({
        value: false,
        source: 'default',
      });
    });
  });

  describe('toPublicLoginPageCopy', () => {
    it('should carry only fields that resolved from the row or env', () => {
      const stored = emptyLoginPageCopy();
      stored.pl.headline = 'Panel';
      const env: Record<string, string> = { OL_LOGIN_SUPPORT_EN: 'it@example.com' };
      const view = resolveLoginPageCopy(stored, (name) => env[name]);
      expect(toPublicLoginPageCopy(view)).toEqual({
        pl: { headline: 'Panel' },
        en: { support: 'it@example.com' },
      });
    });
  });
});

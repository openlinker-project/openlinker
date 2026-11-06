/**
 * Login Page Settings Form Schema
 *
 * Both languages live in one form, so switching the language being edited
 * keeps the other language's draft. The limits come from the API's own
 * `maxLength`, so the form never accepts what the server would refuse.
 *
 * @module features/login-page-settings/components
 */
import { z } from 'zod';
import { LoginPageCopyFieldValues, type LoginPageCopyField } from '../../system';
import type {
  LoginPageLocale,
  LoginPageSettingsView,
  UpdateLoginPageSettingsInput,
} from '../api/login-page-settings.types';

export type LoginPageDraft = Record<LoginPageCopyField, string>;
export type LoginPageSettingsFormValues = Record<LoginPageLocale, LoginPageDraft> & {
  registrationEnabled: boolean;
};

/** Sentinel replaced by the caller with the field's own maximum. */
export const TOO_LONG = 'tooLong';

export function loginPageSettingsSchema(
  maxLength: Record<LoginPageCopyField, number>
): z.ZodType<LoginPageSettingsFormValues, LoginPageSettingsFormValues> {
  const draft = z.object(
    Object.fromEntries(
      LoginPageCopyFieldValues.map((field) => [
        field,
        z.string().refine((value) => value.trim().length <= maxLength[field], TOO_LONG),
      ])
    ) as Record<LoginPageCopyField, z.ZodString>
  );
  return z.object({
    pl: draft,
    en: draft,
    registrationEnabled: z.boolean(),
  }) as unknown as z.ZodType<LoginPageSettingsFormValues, LoginPageSettingsFormValues>;
}

const emptyDraft = (): LoginPageDraft =>
  Object.fromEntries(LoginPageCopyFieldValues.map((field) => [field, ''])) as LoginPageDraft;

export function emptyLoginPageDraft(): LoginPageDraft {
  return emptyDraft();
}

/** Only values the admin SET appear in the form; env and default show as placeholders. */
export function toFormValues(view: LoginPageSettingsView): LoginPageSettingsFormValues {
  const read = (locale: LoginPageLocale): LoginPageDraft => {
    const draft = emptyDraft();
    for (const field of LoginPageCopyFieldValues) {
      const resolved = view.copy[locale]?.[field];
      if (resolved?.source === 'setting' && resolved.value) draft[field] = resolved.value;
    }
    return draft;
  };
  return { pl: read('pl'), en: read('en'), registrationEnabled: view.registration.value };
}

/**
 * Sends every copy field (an empty one clears the stored value). The registration choice is
 * sent only when the admin changed it, so saving copy never freezes the env default in place.
 */
export function toUpdateInput(
  values: LoginPageSettingsFormValues,
  registrationChanged: boolean
): UpdateLoginPageSettingsInput {
  return {
    pl: { ...values.pl },
    en: { ...values.en },
    ...(registrationChanged ? { registrationEnabled: values.registrationEnabled } : {}),
  };
}

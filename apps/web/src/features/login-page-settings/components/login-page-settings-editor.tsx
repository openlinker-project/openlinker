/**
 * Login Page Settings Editor
 *
 * Settings > Login page (#4029): an admin edits the six fields a real
 * install's login page shows, separately per language, and watches a live
 * preview of the real page beside the form. An empty field falls back to the
 * env value and then to the built-in text, which the placeholder shows, so a
 * fresh install is never left with a blank login page. The demo's copy is
 * fixed and not edited here.
 *
 * Laid out like the buyer-email template editor (#3555), with a wider preview
 * column: a whole page is unreadable at a third of the width.
 *
 * @module features/login-page-settings/components
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState, type ReactElement } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { interpolate, messagesIn, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { SegmentedControl } from '../../../shared/ui/segmented-control';
import { Textarea } from '../../../shared/ui/textarea';
import {
  LoginPageCopyFieldValues,
  type LoginPageCopyField,
  type LoginPageCopyOverrides,
} from '../../system';
import type { LoginPageLocale, LoginPageSettingsView } from '../api/login-page-settings.types';
import { useUpdateLoginPageSettingsMutation } from '../hooks/use-update-login-page-settings-mutation';
import {
  emptyLoginPageDraft,
  loginPageSettingsSchema,
  toFormValues,
  toUpdateInput,
  TOO_LONG,
  type LoginPageSettingsFormValues,
} from './login-page-settings-form.schema';
import { LoginPagePreview } from './login-page-preview';

const LANGUAGE_OPTIONS = [
  { value: 'pl' as const, label: 'Polski' },
  { value: 'en' as const, label: 'English' },
];

/** What the login page shows for a field when the admin leaves it empty. */
function fallbackFor(
  view: LoginPageSettingsView,
  locale: LoginPageLocale,
  field: LoginPageCopyField
): string {
  const resolved = view.copy[locale]?.[field];
  if (resolved?.source === 'env' && resolved.value) return resolved.value;
  const prod = messagesIn('login', locale).production;
  switch (field) {
    case 'headline':
      return prod.headline.line1;
    case 'headlineAccent':
      return prod.headline.accent;
    case 'lead':
      return prod.lead;
    case 'formTitle':
      return prod.login.title;
    case 'formSubtitle':
      return prod.login.lead;
    case 'support':
      return prod.support;
  }
}

interface LoginPageSettingsEditorProps {
  view: LoginPageSettingsView;
  registrationEnabled: boolean;
  initialLocale: LoginPageLocale;
}

export function LoginPageSettingsEditor({
  view,
  registrationEnabled,
  initialLocale,
}: LoginPageSettingsEditorProps): ReactElement {
  const copy = useMessages('loginPageSettings');
  const mutation = useUpdateLoginPageSettingsMutation();
  const [locale, setLocale] = useState<LoginPageLocale>(initialLocale);
  const [justSaved, setJustSaved] = useState(false);
  const saved = useMemo(() => toFormValues(view), [view]);
  const schema = useMemo(() => loginPageSettingsSchema(view.maxLength), [view.maxLength]);
  const form = useForm<LoginPageSettingsFormValues>({
    defaultValues: saved,
    resolver: zodResolver(schema),
  });
  const values = useWatch({ control: form.control });
  const dirty = form.formState.isDirty;

  const draft = values[locale] ?? {};
  const overrides: LoginPageCopyOverrides = {};
  for (const field of LoginPageCopyFieldValues) {
    const typed = draft[field]?.trim();
    const resolved = view.copy[locale]?.[field];
    const value = typed || (resolved?.source === 'env' ? resolved.value ?? undefined : undefined);
    if (value) overrides[field] = value;
  }

  const onSubmit = form.handleSubmit(async (submitted) => {
    setJustSaved(false);
    try {
      await mutation.mutateAsync(toUpdateInput(submitted));
      form.reset(submitted);
      setJustSaved(true);
    } catch {
      // Shown in the Alert below.
    }
  });

  const errorFor = (field: LoginPageCopyField): string | undefined => {
    const message = form.formState.errors[locale]?.[field]?.message;
    return message === TOO_LONG
      ? interpolate(copy.tooLong, { max: String(view.maxLength[field]) })
      : message;
  };

  return (
    <div className="buyer-email-editor login-page-editor">
      <form
        className="buyer-email-editor__form panel panel--dense"
        onSubmit={(e) => void onSubmit(e)}
        noValidate
      >
        <Alert tone="info" density="compact">
          {registrationEnabled ? copy.modeOn : copy.modeOff}
        </Alert>

        <div className="form-field">
          <span className="form-field__label">{copy.language}</span>
          <SegmentedControl
            aria-label={copy.language}
            value={locale}
            onChange={setLocale}
            options={LANGUAGE_OPTIONS}
          />
          <p className="form-field__description">{copy.emptyHint}</p>
        </div>

        {LoginPageCopyFieldValues.map((field) => {
          const { label, hint } = copy.fields[field];
          const placeholder = fallbackFor(view, locale, field);
          const registered = form.register(`${locale}.${field}`);
          return (
            <FormField
              key={`${locale}-${field}`}
              name={`${locale}-${field}`}
              label={label}
              description={hint}
              error={errorFor(field)}
            >
              {field === 'lead' ? (
                <Textarea
                  {...registered}
                  rows={3}
                  placeholder={placeholder}
                  lang={locale}
                  invalid={Boolean(errorFor(field))}
                />
              ) : (
                <Input
                  {...registered}
                  placeholder={placeholder}
                  lang={locale}
                  invalid={Boolean(errorFor(field))}
                />
              )}
            </FormField>
          );
        })}

        <div className="buyer-email-editor__actions">
          <Button type="submit" disabled={!dirty || mutation.isPending}>
            {mutation.isPending ? copy.saving : copy.save}
          </Button>
          <Button
            type="button"
            tone="secondary"
            onClick={() => {
              setJustSaved(false);
              form.setValue(locale, emptyLoginPageDraft(), { shouldDirty: true });
            }}
          >
            {copy.reset}
          </Button>
          <Button
            type="button"
            tone="ghost"
            disabled={!dirty}
            onClick={() => {
              setJustSaved(false);
              form.reset(saved);
            }}
          >
            {copy.cancel}
          </Button>
        </div>
        {mutation.error ? (
          <Alert tone="error" title={copy.saveError}>
            {mutation.error.message}
          </Alert>
        ) : null}
        {justSaved && !dirty ? <Alert tone="success">{copy.saved}</Alert> : null}
        {dirty ? <p className="muted-text">{copy.unsaved}</p> : null}
      </form>

      <aside className="buyer-email-editor__form">
        <section className="panel panel--dense">
          <p className="eyebrow">{copy.preview}</p>
          <p className="muted-text">{locale === 'pl' ? copy.previewHintPl : copy.previewHintEn}</p>
          <LoginPagePreview
            locale={locale}
            overrides={overrides}
            canRegister={registrationEnabled}
          />
        </section>
      </aside>
    </div>
  );
}

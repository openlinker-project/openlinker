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
import { useId, useMemo, useState, type ReactElement } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { describeApiError } from '../../../shared/api/describe-api-error';
import { interpolate, messagesIn, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '../../../shared/ui/dialog';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { RichTextEditor } from '../../../shared/ui/rich-text-editor';
import type { DescriptionFormat } from '../../../shared/ui/rich-text.types';
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

/**
 * The support line is the one rich-text field: a sentence with a link to the
 * operator's own help page. Paragraphs, emphasis and links only; the byte cap
 * is the field's stored limit. Stated here rather than fetched, like the
 * master description format: nothing declares it but this page.
 */
function supportFormat(maxBytes: number): DescriptionFormat {
  return {
    shape: 'html',
    allowedTags: ['p', 'br', 'strong', 'em', 'a'],
    allowedAttributes: { a: ['href'] },
    contentModel: null,
    rewrites: [],
    requiresBlockOpener: false,
    selfClosingVoids: false,
    maxBytes,
    declared: true,
    resolvedVia: null,
  };
}

/** Markup with no words (an emptied editor) counts as an empty field. */
const isBlankHtml = (html: string): boolean =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim() === '';

type LoginPageScreen = 'login' | 'register';

/** The hero, shared by both screens of the login page. */
const SHARED_FIELDS: readonly LoginPageCopyField[] = ['headline', 'headlineAccent', 'lead'];

/** The card's own fields per screen; the form card lists only the chosen screen's. */
const SCREEN_FIELDS: Record<LoginPageScreen, readonly LoginPageCopyField[]> = {
  login: ['formTitle', 'formSubtitle', 'support'],
  register: ['registerTitle', 'registerSubtitle'],
};

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
    case 'registerTitle':
      return prod.register.title;
    case 'registerSubtitle':
      return prod.register.lead;
    case 'support':
      // The default carries a docs link; the editor shows its words only.
      return prod.support.replace(/<\/?\w+>/g, '');
  }
}

interface LoginPageSettingsEditorProps {
  view: LoginPageSettingsView;
  initialLocale: LoginPageLocale;
}

export function LoginPageSettingsEditor({
  view,
  initialLocale,
}: LoginPageSettingsEditorProps): ReactElement {
  const copy = useMessages('login-page-settings');
  const mutation = useUpdateLoginPageSettingsMutation();
  const [locale, setLocale] = useState<LoginPageLocale>(initialLocale);
  const [justSaved, setJustSaved] = useState(false);
  const [screenChoice, setScreen] = useState<LoginPageScreen>('login');
  const [previewOpen, setPreviewOpen] = useState(false);
  const saved = useMemo(() => toFormValues(view), [view]);
  const schema = useMemo(() => loginPageSettingsSchema(view.maxLength), [view.maxLength]);
  const form = useForm<LoginPageSettingsFormValues>({
    defaultValues: saved,
    resolver: zodResolver(schema),
  });
  const values = useWatch({ control: form.control });
  const dirty = form.formState.isDirty;
  const registrationId = useId();
  const cardTitleId = useId();
  const canRegister = values.registrationEnabled ?? false;
  // Request access is a screen only while registration is on.
  const screen: LoginPageScreen = canRegister ? screenChoice : 'login';

  const draft = values[locale] ?? {};
  const overrides: LoginPageCopyOverrides = {};
  for (const field of LoginPageCopyFieldValues) {
    const raw = draft[field] ?? '';
    const typed = field === 'support' && isBlankHtml(raw) ? '' : raw.trim();
    const resolved = view.copy[locale]?.[field];
    const value = typed || (resolved?.source === 'env' ? resolved.value ?? undefined : undefined);
    if (value) overrides[field] = value;
  }

  const onSubmit = form.handleSubmit(async (submitted) => {
    setJustSaved(false);
    try {
      await mutation.mutateAsync(
        toUpdateInput(submitted, Boolean(form.formState.dirtyFields.registrationEnabled))
      );
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

  function renderField(field: LoginPageCopyField): ReactElement {
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
        {field === 'support' ? (
          <RichTextEditor
            key={locale}
            className="login-page-editor__support"
            format={supportFormat(view.maxLength.support)}
            value={draft.support ?? ''}
            onChange={(html) =>
              form.setValue(`${locale}.support`, isBlankHtml(html) ? '' : html, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
            placeholder={placeholder}
            aria-label={label}
            aria-invalid={Boolean(errorFor(field))}
          />
        ) : field === 'lead' ? (
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
  }

  const preview = (
    <LoginPagePreview
      screen={screen}
      locale={locale}
      overrides={overrides}
      canRegister={canRegister}
    />
  );

  return (
    <div className="buyer-email-editor login-page-editor">
      <form
        className="buyer-email-editor__form panel panel--dense"
        onSubmit={(e) => void onSubmit(e)}
        noValidate
      >
        <div className="form-field">
          <span className="form-field__label">{copy.registrationLabel}</span>
          <label className="buyer-emails-switch" htmlFor={registrationId}>
            <input id={registrationId} type="checkbox" {...form.register('registrationEnabled')} />
            <span>{copy.registrationToggle}</span>
          </label>
          <p className="form-field__description">
            {copy.registrationHint}
            {view.registration.source === 'env' ? ` ${copy.registrationEnv}` : ''}
          </p>
        </div>

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

        <Button
          type="button"
          tone="secondary"
          className="login-page-editor__preview-open"
          onClick={() => setPreviewOpen(true)}
        >
          {copy.previewOpen}
        </Button>

        {SHARED_FIELDS.map(renderField)}

        <section className="login-page-editor__card" aria-labelledby={cardTitleId}>
          <h3 className="login-page-editor__card-title" id={cardTitleId}>
            {copy.formCardTitle}
          </h3>
          {canRegister ? (
            <div className="form-field">
              <SegmentedControl
                className="login-page-editor__screens"
                aria-label={copy.previewScreen}
                value={screen}
                onChange={setScreen}
                options={[
                  { value: 'login' as const, label: copy.previewLogin },
                  { value: 'register' as const, label: copy.previewRegister },
                ]}
              />
              <p className="form-field__description">{copy.screenHint}</p>
            </div>
          ) : null}
          {SCREEN_FIELDS[screen].map(renderField)}
        </section>

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
            {describeApiError(mutation.error, 'login-page-settings')}
          </Alert>
        ) : null}
        {justSaved && !dirty ? <Alert tone="success">{copy.saved}</Alert> : null}
        {dirty ? <p className="muted-text">{copy.unsaved}</p> : null}
      </form>

      <aside className="buyer-email-editor__form">
        <section className="panel panel--dense">
          <p className="eyebrow">{copy.preview}</p>
          <p className="muted-text">{locale === 'pl' ? copy.previewHintPl : copy.previewHintEn}</p>
          {previewOpen ? null : preview}
        </section>
      </aside>

      {/* Narrow screens have no room beside the form: the preview opens on demand. */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="login-page-editor__preview-dialog" aria-describedby={undefined}>
          <DialogTitle>{copy.preview}</DialogTitle>
          {previewOpen ? (
            <LoginPagePreview
              frame="phone"
              screen={screen}
              locale={locale}
              overrides={overrides}
              canRegister={canRegister}
            />
          ) : null}
          <DialogFooter>
            <Button type="button" tone="secondary" onClick={() => setPreviewOpen(false)}>
              {copy.previewClose}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

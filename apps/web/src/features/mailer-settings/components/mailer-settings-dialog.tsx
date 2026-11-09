/**
 * Mailer Settings Dialog
 *
 * Edit modal for the DB-backed mailer/SMTP settings. Wraps the Dialog
 * primitive + React Hook Form / Zod, mirroring
 * `ai-provider-settings/components/ai-provider-key-dialog.tsx`. Submitting
 * the form updates the non-secret transport fields and — only when a new
 * password was typed — rotates the SMTP password in a second request. The
 * password field is never pre-filled; `smtpPasswordConfigured` drives the
 * "Password configured" / "No password set" hint instead.
 *
 * @module apps/web/src/features/mailer-settings/components
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../shared/ui/dialog';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { useToast } from '../../../shared/ui/toast-provider';
import { MailerTransportValues, type MailerSettingsView } from '../api/mailer-settings.types';
import { useClearMailerCredentialsMutation } from '../hooks/use-clear-mailer-credentials-mutation';
import { useSetMailerCredentialsMutation } from '../hooks/use-set-mailer-credentials-mutation';
import { useUpdateMailerSettingsMutation } from '../hooks/use-update-mailer-settings-mutation';
import {
  createMailerSettingsFormSchema,
  type MailerSettingsFormSubmission,
  type MailerSettingsFormValues,
} from './mailer-settings-form.schema';

interface MailerSettingsDialogProps {
  open: boolean;
  view: MailerSettingsView;
  onClose: () => void;
}

function toFormValues(view: MailerSettingsView): MailerSettingsFormValues {
  return {
    transport: view.transport,
    smtpHost: view.smtpHost ?? '',
    smtpPort: view.smtpPort !== null ? String(view.smtpPort) : '',
    smtpSecure: view.smtpSecure,
    fromAddress: view.fromAddress ?? '',
    password: '',
  };
}

export function MailerSettingsDialog({
  open,
  view,
  onClose,
}: MailerSettingsDialogProps): ReactElement {
  const { showToast } = useToast();
  const messages = useMessages('mailer-settings');
  const copy = messages.mailerSettingsDialog;
  const schema = useMemo(
    () => createMailerSettingsFormSchema(messages.mailerSettingsFormSchema),
    [messages.mailerSettingsFormSchema],
  );
  const updateMutation = useUpdateMailerSettingsMutation();
  const setCredentialsMutation = useSetMailerCredentialsMutation();
  const clearCredentialsMutation = useClearMailerCredentialsMutation();

  const form = useForm<MailerSettingsFormValues, undefined, MailerSettingsFormSubmission>({
    defaultValues: toFormValues(view),
    resolver: zodResolver(schema),
  });

  // Reset the form (and any prior mutation error) whenever the dialog opens —
  // matches the #478 fix in ai-provider-key-dialog.tsx: depend on the
  // destructured stable methods, not the wrapping `form` / mutation objects,
  // which get a fresh identity every render and would loop the effect.
  const { reset: resetForm } = form;
  const { reset: resetUpdateMutation } = updateMutation;
  const { reset: resetCredentialsMutation } = setCredentialsMutation;
  useEffect(() => {
    if (open) {
      resetForm(toFormValues(view));
      resetUpdateMutation();
      resetCredentialsMutation();
    }
    // `view` is intentionally excluded: resetting on every background
    // refetch (not just on open) would clobber an in-progress edit.
  }, [open, resetForm, resetUpdateMutation, resetCredentialsMutation]);

  const transport = form.watch('transport');

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await updateMutation.mutateAsync({
        transport: values.transport,
        smtpHost: values.transport === 'smtp' ? values.smtpHost : null,
        smtpPort: values.transport === 'smtp' ? Number(values.smtpPort) : null,
        smtpSecure: values.smtpSecure,
        fromAddress: values.transport === 'smtp' ? values.fromAddress : null,
      });

      if (values.password.length > 0) {
        await setCredentialsMutation.mutateAsync({ password: values.password });
      }

      showToast({
        tone: 'success',
        title: copy.savedToastTitle,
        description: copy.savedToastDescription,
      });
      onClose();
    } catch {
      // Surfaced via mutationError → <Alert> below.
    }
  });

  const handleClearPassword = async (): Promise<void> => {
    try {
      await clearCredentialsMutation.mutateAsync();
      form.setValue('password', '');
      showToast({
        tone: 'success',
        title: copy.clearedToastTitle,
        description: copy.clearedToastDescription,
      });
    } catch (error) {
      showToast({
        tone: 'error',
        title: copy.clearErrorTitle,
        description: error instanceof Error ? error.message : copy.unknownError,
      });
    }
  };

  const validationMessages = Object.values(form.formState.errors)
    .map((entry) => entry?.message)
    .filter((message): message is string => typeof message === 'string');

  const showValidationSummary = form.formState.submitCount > 0 && validationMessages.length > 0;

  const mutationError = updateMutation.error ?? setCredentialsMutation.error;
  const isSaving = updateMutation.isPending || setCredentialsMutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent>
        {/* No help icon: the docs have no mailer section to point at, and a
            link to a page's top answers nothing (#81, help-links.ts). */}
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>

        {mutationError ? (
          <Alert tone="error" title={copy.saveErrorTitle}>
            {mutationError.message}
          </Alert>
        ) : null}

        <form
          onSubmit={(event) => {
            void onSubmit(event);
          }}
          noValidate
        >
          {showValidationSummary ? <FormErrorSummary errors={validationMessages} /> : null}

          <FormField label={copy.transportLabel} name="transport">
            <Select {...form.register('transport')}>
              {MailerTransportValues.map((value) => (
                <option key={value} value={value}>
                  {copy.transport[value]}
                </option>
              ))}
            </Select>
          </FormField>

          {transport === 'smtp' ? (
            <>
              <FormField
                label={copy.hostLabel}
                name="smtpHost"
                error={form.formState.errors.smtpHost?.message}
              >
                <Input placeholder={copy.hostPlaceholder} {...form.register('smtpHost')} />
              </FormField>

              <FormField
                label={copy.portLabel}
                name="smtpPort"
                error={form.formState.errors.smtpPort?.message}
              >
                <Input inputMode="numeric" placeholder={copy.portPlaceholder} {...form.register('smtpPort')} />
              </FormField>

              <label className="mailer-settings-checkbox">
                <input type="checkbox" {...form.register('smtpSecure')} />
                <span>{copy.secureLabel}</span>
              </label>

              <FormField
                label={copy.fromLabel}
                name="fromAddress"
                description={copy.fromDescription}
                error={form.formState.errors.fromAddress?.message}
              >
                <Input type="text" placeholder={copy.fromPlaceholder} {...form.register('fromAddress')} />
              </FormField>

              <FormField
                label={copy.passwordLabel}
                name="password"
                description={
                  view.smtpPasswordConfigured
                    ? copy.passwordConfigured
                    : copy.passwordNotSet
                }
                error={form.formState.errors.password?.message}
              >
                <Input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={copy.passwordPlaceholder}
                  {...form.register('password')}
                />
              </FormField>

              {view.smtpPasswordConfigured ? (
                <Button
                  type="button"
                  tone="ghost"
                  className="button--sm"
                  disabled={clearCredentialsMutation.isPending}
                  onClick={() => {
                    void handleClearPassword();
                  }}
                >
                  {clearCredentialsMutation.isPending ? copy.clearing : copy.clearPassword}
                </Button>
              ) : null}
            </>
          ) : null}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" tone="ghost">
                {copy.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? copy.saving : copy.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

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
import { useEffect, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
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
  mailerSettingsFormSchema,
  type MailerSettingsFormSubmission,
  type MailerSettingsFormValues,
} from './mailer-settings-form.schema';

interface MailerSettingsDialogProps {
  open: boolean;
  view: MailerSettingsView;
  onClose: () => void;
}

const TRANSPORT_LABEL: Record<(typeof MailerTransportValues)[number], string> = {
  console: 'Console (log only, no email sent)',
  smtp: 'SMTP',
};

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
  const updateMutation = useUpdateMailerSettingsMutation();
  const setCredentialsMutation = useSetMailerCredentialsMutation();
  const clearCredentialsMutation = useClearMailerCredentialsMutation();

  const form = useForm<MailerSettingsFormValues, undefined, MailerSettingsFormSubmission>({
    defaultValues: toFormValues(view),
    resolver: zodResolver(mailerSettingsFormSchema),
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
        title: 'Mailer settings saved',
        description: 'Outbound mail will use the updated configuration.',
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
        title: 'SMTP password cleared',
        description: 'The server falls back to env or none until a new password is set.',
      });
    } catch (error) {
      showToast({
        tone: 'error',
        title: 'Could not clear the password',
        description: error instanceof Error ? error.message : 'Unknown error',
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
        <DialogTitle>Edit mailer settings</DialogTitle>
        <DialogDescription>
          Choose how outbound mail is sent. The SMTP password is write-only — it is never returned by
          the API.
        </DialogDescription>

        {mutationError ? (
          <Alert tone="error" title="Could not save mailer settings">
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

          <FormField label="Transport" name="transport">
            <Select {...form.register('transport')}>
              {MailerTransportValues.map((value) => (
                <option key={value} value={value}>
                  {TRANSPORT_LABEL[value]}
                </option>
              ))}
            </Select>
          </FormField>

          {transport === 'smtp' ? (
            <>
              <FormField
                label="SMTP host"
                name="smtpHost"
                error={form.formState.errors.smtpHost?.message}
              >
                <Input placeholder="smtp.example.com" {...form.register('smtpHost')} />
              </FormField>

              <FormField
                label="SMTP port"
                name="smtpPort"
                error={form.formState.errors.smtpPort?.message}
              >
                <Input inputMode="numeric" placeholder="587" {...form.register('smtpPort')} />
              </FormField>

              <label className="mailer-settings-checkbox">
                <input type="checkbox" {...form.register('smtpSecure')} />
                <span>Use implicit TLS (leave unchecked for STARTTLS/plain)</span>
              </label>

              <FormField
                label="From address"
                name="fromAddress"
                error={form.formState.errors.fromAddress?.message}
              >
                <Input type="email" placeholder="orders@example.com" {...form.register('fromAddress')} />
              </FormField>

              <FormField
                label="SMTP password"
                name="password"
                description={
                  view.smtpPasswordConfigured
                    ? 'Password configured. Leave blank to keep it, or enter a new value to rotate it.'
                    : 'No password set. Enter a value to configure one.'
                }
                error={form.formState.errors.password?.message}
              >
                <Input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Leave blank to keep current password"
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
                  {clearCredentialsMutation.isPending ? 'Clearing…' : 'Clear stored password'}
                </Button>
              ) : null}
            </>
          ) : null}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" tone="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

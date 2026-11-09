/**
 * AI Provider Key Dialog
 *
 * Per-provider modal for setting/rotating an API key. Wraps the existing
 * Dialog primitive + the legacy single-key form schema (the field-level
 * validation is unchanged across providers — only the surrounding context
 * changes). Toast on success; API errors surface in an `<Alert>` at the
 * top of the form.
 *
 * @module apps/web/src/features/ai-provider-settings/components
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { interpolate, useMessages } from '../../../shared/i18n';
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
import { useToast } from '../../../shared/ui/toast-provider';
import type { AiProvider } from '../api/ai-provider-settings.types';
import { useUpdateAiProviderSettingsMutation } from '../hooks/use-update-ai-provider-settings-mutation';
import {
  createAiProviderSettingsFormSchema,
  type AiProviderSettingsFormSubmission,
  type AiProviderSettingsFormValues,
} from './ai-provider-settings-form.schema';

interface AiProviderKeyDialogProps {
  /** When set, renders the dialog open and pinned to this provider. */
  provider: AiProvider | null;
  onClose: () => void;
}

export function AiProviderKeyDialog({ provider, onClose }: AiProviderKeyDialogProps): ReactElement {
  const messages = useMessages('ai-provider-settings');
  const copy = messages.aiProviderKeyDialog;
  const schemaCopy = messages.aiProviderSettingsFormSchema;
  const schema = useMemo(() => createAiProviderSettingsFormSchema(schemaCopy), [schemaCopy]);
  const { showToast } = useToast();
  const mutation = useUpdateAiProviderSettingsMutation();

  const form = useForm<
    AiProviderSettingsFormValues,
    undefined,
    AiProviderSettingsFormSubmission
  >({
    defaultValues: { apiKey: '' },
    resolver: zodResolver(schema),
  });

  // Reset the form (and any prior mutation error) when the dialog opens or
  // is reassigned to a different provider — operators rotating multiple
  // keys back-to-back should never see a stale field value or banner.
  // #478: depend on the destructured stable methods, not the wrapping
  // `form` / `mutation` objects — `useMutation` returns a fresh wrapper
  // each render, which loops the effect.
  const { reset: resetForm } = form;
  const { reset: resetMutation } = mutation;
  useEffect(() => {
    if (provider !== null) {
      resetForm({ apiKey: '' });
      resetMutation();
    }
  }, [provider, resetForm, resetMutation]);

  const onSubmit = form.handleSubmit(async (values) => {
    if (provider === null || provider === 'fake') return;
    try {
      await mutation.mutateAsync({ provider, input: { apiKey: values.apiKey } });
      showToast({
        tone: 'success',
        title: copy.savedToastTitle,
        description: interpolate(copy.savedToastDescription, {
          provider: copy.providers[provider],
        }),
      });
      onClose();
    } catch {
      // Surfaced via mutation.error → <Alert> below.
    }
  });

  const validationMessages = Object.values(form.formState.errors)
    .map((entry) => entry?.message)
    .filter((message): message is string => typeof message === 'string');

  const showValidationSummary =
    form.formState.submitCount > 0 && validationMessages.length > 0;

  const open = provider !== null;
  const placeholder =
    provider !== null && provider !== 'fake' ? copy.placeholders[provider] : '';

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>
          {provider !== null
            ? interpolate(copy.title, { provider: copy.providers[provider] })
            : copy.titleGeneric}
        </DialogTitle>
        <DialogDescription>
          {copy.description}
        </DialogDescription>

        {mutation.error ? (
          <Alert tone="error" title={copy.saveErrorTitle}>
            {mutation.error.message}
          </Alert>
        ) : null}

        <form
          onSubmit={(event) => {
            void onSubmit(event);
          }}
          noValidate
        >
          {showValidationSummary ? <FormErrorSummary errors={validationMessages} /> : null}

          <FormField label={copy.apiKeyLabel} name="apiKey" error={form.formState.errors.apiKey?.message}>
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={placeholder}
              {...form.register('apiKey')}
            />
          </FormField>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" tone="ghost">
                {copy.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? copy.saving : copy.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

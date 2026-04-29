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
import { useToast } from '../../../shared/ui/toast-provider';
import type { AiProvider } from '../api/ai-provider-settings.types';
import { useUpdateAiProviderSettingsMutation } from '../hooks/use-update-ai-provider-settings-mutation';
import {
  aiProviderSettingsFormSchema,
  type AiProviderSettingsFormSubmission,
  type AiProviderSettingsFormValues,
} from './ai-provider-settings-form.schema';

interface AiProviderKeyDialogProps {
  /** When set, renders the dialog open and pinned to this provider. */
  provider: AiProvider | null;
  onClose: () => void;
}

/**
 * Provider-specific key placeholder. Anthropic keys begin `sk-ant-`,
 * OpenAI keys begin `sk-`. Showing the right hint reduces operator
 * confusion when switching between providers.
 */
const PLACEHOLDER_BY_PROVIDER: Record<Exclude<AiProvider, 'fake'>, string> = {
  anthropic: 'sk-ant-...',
  openai: 'sk-...',
};

const PROVIDER_LABEL: Record<AiProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  fake: 'Fake',
};

export function AiProviderKeyDialog({ provider, onClose }: AiProviderKeyDialogProps): ReactElement {
  const { showToast } = useToast();
  const mutation = useUpdateAiProviderSettingsMutation();

  const form = useForm<
    AiProviderSettingsFormValues,
    undefined,
    AiProviderSettingsFormSubmission
  >({
    defaultValues: { apiKey: '' },
    resolver: zodResolver(aiProviderSettingsFormSchema),
  });

  // Reset the form (and any prior mutation error) when the dialog opens or
  // is reassigned to a different provider — operators rotating multiple
  // keys back-to-back should never see a stale field value or banner.
  useEffect(() => {
    if (provider !== null) {
      form.reset({ apiKey: '' });
      mutation.reset();
    }
  }, [provider, form, mutation]);

  const onSubmit = form.handleSubmit(async (values) => {
    if (provider === null || provider === 'fake') return;
    try {
      await mutation.mutateAsync({ provider, input: { apiKey: values.apiKey } });
      showToast({
        tone: 'success',
        title: 'API key saved',
        description: `Subsequent ${PROVIDER_LABEL[provider]} requests will use the new key.`,
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
    provider !== null && provider !== 'fake' ? PLACEHOLDER_BY_PROVIDER[provider] : '';

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>
          {provider !== null ? `Set ${PROVIDER_LABEL[provider]} API key` : 'Set API key'}
        </DialogTitle>
        <DialogDescription>
          Stored encrypted at rest. Server-side only — never returned by the API.
        </DialogDescription>

        {mutation.error ? (
          <Alert tone="error" title="Could not save the key">
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

          <FormField label="API key" name="apiKey" error={form.formState.errors.apiKey?.message}>
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
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save key'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

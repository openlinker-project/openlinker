/**
 * AI Provider Settings Form
 *
 * Single-field RHF + Zod form for setting the AI provider API key. Renders
 * a destructive "Clear stored key" affordance when the current source is
 * `db` (gated behind a `ConfirmDialog`).
 *
 * UX wiring per `.claude/rules/fe-pages.md`:
 *  - API errors surface in `<Alert>` at the form top
 *  - Validation summary appears only after the first submit
 *  - Submit / clear buttons disable while the relevant mutation is pending
 *  - Toast on success; `form.reset()` after a successful save
 *
 * @module apps/web/src/features/ai-provider-settings/components
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useState, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { useToast } from '../../../shared/ui/toast-provider';
import type { AiProviderKeySource } from '../api/ai-provider-settings.types';
import { useClearAiProviderSettingsMutation } from '../hooks/use-clear-ai-provider-settings-mutation';
import { useUpdateAiProviderSettingsMutation } from '../hooks/use-update-ai-provider-settings-mutation';
import {
  aiProviderSettingsFormSchema,
  type AiProviderSettingsFormSubmission,
  type AiProviderSettingsFormValues,
} from './ai-provider-settings-form.schema';

interface AiProviderSettingsFormProps {
  currentSource: AiProviderKeySource;
}

export function AiProviderSettingsForm({
  currentSource,
}: AiProviderSettingsFormProps): ReactElement {
  const { showToast } = useToast();
  const [clearOpen, setClearOpen] = useState(false);

  const updateMutation = useUpdateAiProviderSettingsMutation();
  const clearMutation = useClearAiProviderSettingsMutation();

  const form = useForm<
    AiProviderSettingsFormValues,
    undefined,
    AiProviderSettingsFormSubmission
  >({
    defaultValues: { apiKey: '' },
    resolver: zodResolver(aiProviderSettingsFormSchema),
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await updateMutation.mutateAsync({ apiKey: values.apiKey });
      form.reset();
      showToast({
        tone: 'success',
        title: 'API key saved',
        description: 'Subsequent AI requests will use the new key.',
      });
    } catch {
      // surfaced via updateMutation.error → <Alert> below
    }
  });

  const onClearConfirm = async (): Promise<void> => {
    try {
      await clearMutation.mutateAsync();
      setClearOpen(false);
      showToast({
        tone: 'success',
        title: 'API key cleared',
        description: 'Server falls back to the env variable, or none.',
      });
    } catch {
      // surfaced via clearMutation.error → <Alert> below
    }
  };

  const validationMessages = Object.values(form.formState.errors)
    .map((entry) => entry?.message)
    .filter((message): message is string => typeof message === 'string');

  const showValidationSummary =
    form.formState.submitCount > 0 && validationMessages.length > 0;

  const apiError = updateMutation.error ?? clearMutation.error;

  return (
    <section aria-labelledby="ai-provider-form-heading">
      <h2 id="ai-provider-form-heading" className="section-title">
        Set or rotate API key
      </h2>

      {apiError ? (
        <Alert tone="error" title="Could not save the key">
          {apiError.message}
        </Alert>
      ) : null}

      <form
        onSubmit={(event) => {
          void onSubmit(event);
        }}
        noValidate
      >
        {showValidationSummary ? <FormErrorSummary errors={validationMessages} /> : null}

        <FormField
          label="API key"
          name="apiKey"
          description="Stored encrypted at rest. Server-side only — never returned by the API."
          error={form.formState.errors.apiKey?.message}
        >
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-..."
            {...form.register('apiKey')}
          />
        </FormField>

        <div className="form-actions">
          <Button type="submit" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? 'Saving…' : 'Save key'}
          </Button>
          {currentSource === 'db' ? (
            <Button
              type="button"
              tone="danger"
              onClick={() => setClearOpen(true)}
              disabled={clearMutation.isPending}
            >
              Clear stored key
            </Button>
          ) : null}
        </div>
      </form>

      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title="Clear stored API key?"
        description="The server will fall back to the env variable (if set) or report no key configured. AI requests will fail until a new key is saved."
        confirmLabel="Clear key"
        cancelLabel="Cancel"
        tone="danger"
        isConfirming={clearMutation.isPending}
        onConfirm={() => {
          void onClearConfirm();
        }}
      />
    </section>
  );
}

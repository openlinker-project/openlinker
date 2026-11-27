/**
 * New Prompt Template Dialog
 *
 * Admin-only on-ramp for authoring a brand-new draft template (#488).
 * Backend `POST /prompt-templates` already exists — this dialog provides
 * the missing UI surface. Submitting a valid form creates the draft and
 * navigates the operator to the detail editor at `/ai/prompt-templates/{newId}`,
 * where the richer editor (variables editor, render preview) takes over.
 *
 * @module apps/web/src/features/prompt-templates/components
 */
import { useMemo, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { interpolate, renderRich, useMessages, usePlural } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../shared/ui/dialog';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { Textarea } from '../../../shared/ui/textarea';
import { useToast } from '../../../shared/ui/toast-provider';
import { useCreatePromptTemplateMutation } from '../hooks/use-prompt-template-mutations';
import {
  MASTER_CHANNEL_SENTINEL,
  toApiInput,
  useChannelSelectOptions,
  useNewPromptTemplateSchema,
  type NewPromptTemplateFormValues,
} from './new-prompt-template.schema';
import { describeApiError } from '../../../shared/api/describe-api-error';

interface NewPromptTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DEFAULT_VALUES: NewPromptTemplateFormValues = {
  key: '',
  channel: MASTER_CHANNEL_SENTINEL,
  systemPrompt: '',
  userPromptTemplate: '',
  variablesJson: '[]',
};

export function NewPromptTemplateDialog({
  open,
  onOpenChange,
}: NewPromptTemplateDialogProps): ReactElement {
  const messages = useMessages('prompt-templates');
  const copy = messages.newPromptTemplateDialog;
  const plural = usePlural();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const mutation = useCreatePromptTemplateMutation();
  const { mutateAsync: createTemplate, reset: resetMutation } = mutation;

  // Channel options + schema are derived from the live plugin registry
  // (#580). Both hooks are useMemo-stable across renders while the plugin
  // set is — the resolver passed to react-hook-form is therefore safe to
  // create inline.
  const schema = useNewPromptTemplateSchema();
  const channelOptions = useChannelSelectOptions();

  const form = useForm<NewPromptTemplateFormValues>({
    defaultValues: DEFAULT_VALUES,
    resolver: zodResolver(schema),
  });

  const validationMessages = Object.values(form.formState.errors).flatMap((fieldError) =>
    fieldError?.message ? [String(fieldError.message)] : [],
  );

  // Live JSON-status indicator below the variables textarea — cockpit
  // principle "status-first, fast to scan." Tells the operator instantly
  // whether their JSON parses without waiting for submit.
  const variablesJsonValue = form.watch('variablesJson');
  const variablesStatus = useMemo<
    | { tone: 'ok'; count: number }
    | { tone: 'error'; message: string }
    | null
  >(() => {
    const trimmed = variablesJsonValue.trim();
    if (trimmed === '') return { tone: 'ok', count: 0 };
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!Array.isArray(parsed)) {
        return { tone: 'error', message: copy.jsonStatus.notArray };
      }
      return { tone: 'ok', count: parsed.length };
    } catch {
      return { tone: 'error', message: copy.jsonStatus.invalidSyntax };
    }
  }, [variablesJsonValue, copy]);

  const handleOpenChange = (next: boolean): void => {
    onOpenChange(next);
    if (!next) {
      form.reset(DEFAULT_VALUES);
      resetMutation();
    }
  };

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const created = await createTemplate(toApiInput(values));
      showToast({
        tone: 'success',
        title: copy.createdToastTitle,
        description: interpolate(copy.createdToastDescription, {
          key: created.key,
          version: created.version,
        }),
      });
      handleOpenChange(false);
      void navigate(`/ai/prompt-templates/${created.id}`);
    } catch {
      // surfaced inline via mutation.error
    }
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="new-prompt-template-dialog">
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>
          {renderRich(copy.description, {
            code: (text) => <span className="mono-text">{text}</span>,
          })}
        </DialogDescription>

        <form
          id="new-prompt-template-form"
          onSubmit={(e) => void onSubmit(e)}
          noValidate
          className="new-prompt-template-form"
        >
          {mutation.error ? (
            <Alert tone="error">{describeApiError(mutation.error, 'prompt-templates')}</Alert>
          ) : null}

          {form.formState.submitCount > 0 && validationMessages.length > 0 ? (
            <FormErrorSummary errors={validationMessages} />
          ) : null}

          <FormField
            label={copy.fields.key.label}
            name="key"
            description={copy.fields.key.description}
            error={form.formState.errors.key?.message}
          >
            <Input
              {...form.register('key')}
              placeholder={copy.fields.key.placeholder}
              maxLength={128}
              className="mono-text new-prompt-template-dialog__key-input"
            />
          </FormField>

          <FormField
            label={copy.fields.channel.label}
            name="channel"
            description={copy.fields.channel.description}
            error={form.formState.errors.channel?.message}
          >
            <Select {...form.register('channel')}>
              {channelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField
            label={copy.fields.systemPrompt.label}
            name="systemPrompt"
            description={copy.fields.systemPrompt.description}
            error={form.formState.errors.systemPrompt?.message}
          >
            <Textarea
              {...form.register('systemPrompt')}
              rows={6}
              maxLength={65536}
              placeholder={copy.fields.systemPrompt.placeholder}
            />
          </FormField>

          <FormField
            label={copy.fields.userPromptTemplate.label}
            name="userPromptTemplate"
            description={copy.fields.userPromptTemplate.description}
            error={form.formState.errors.userPromptTemplate?.message}
          >
            <Textarea
              {...form.register('userPromptTemplate')}
              rows={6}
              maxLength={65536}
              placeholder={copy.fields.userPromptTemplate.placeholder}
            />
          </FormField>

          <FormField
            label={copy.fields.variablesJson.label}
            name="variablesJson"
            description={copy.fields.variablesJson.description}
            error={form.formState.errors.variablesJson?.message}
          >
            <Textarea
              {...form.register('variablesJson')}
              rows={5}
              className="mono-text"
              placeholder={copy.fields.variablesJson.placeholder}
            />
          </FormField>
          {variablesStatus !== null ? (
            <p
              className={`new-prompt-template-dialog__json-status new-prompt-template-dialog__json-status--${
                variablesStatus.tone === 'ok' ? 'ok' : 'error'
              }`}
              aria-live="polite"
            >
              {variablesStatus.tone === 'ok'
                ? plural(variablesStatus.count, copy.jsonStatus.valid)
                : interpolate(copy.jsonStatus.invalid, { message: variablesStatus.message })}
            </p>
          ) : null}
        </form>

        <DialogFooter>
          <Button type="button" tone="secondary" onClick={() => handleOpenChange(false)}>
            {messages.common.cancel}
          </Button>
          <Button
            type="submit"
            form="new-prompt-template-form"
            tone="primary"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? copy.creating : copy.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

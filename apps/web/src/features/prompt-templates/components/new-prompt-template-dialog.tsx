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
  newPromptTemplateSchema,
  toApiInput,
  type NewPromptTemplateFormValues,
} from './new-prompt-template.schema';

interface NewPromptTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DEFAULT_VALUES: NewPromptTemplateFormValues = {
  key: '',
  channel: 'master',
  systemPrompt: '',
  userPromptTemplate: '',
  variablesJson: '[]',
};

export function NewPromptTemplateDialog({
  open,
  onOpenChange,
}: NewPromptTemplateDialogProps): ReactElement {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const mutation = useCreatePromptTemplateMutation();
  const { mutateAsync: createTemplate, reset: resetMutation } = mutation;

  const form = useForm<NewPromptTemplateFormValues>({
    defaultValues: DEFAULT_VALUES,
    resolver: zodResolver(newPromptTemplateSchema),
  });

  const validationMessages = Object.values(form.formState.errors).flatMap((error) =>
    error?.message ? [String(error.message)] : [],
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
        return { tone: 'error', message: 'must be a JSON array' };
      }
      return { tone: 'ok', count: parsed.length };
    } catch {
      return { tone: 'error', message: 'invalid JSON syntax' };
    }
  }, [variablesJsonValue]);

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
        title: 'Draft created',
        description: `${created.key} v${created.version}`,
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
        <DialogTitle>New prompt template</DialogTitle>
        <DialogDescription>
          Create a draft template for a new <span className="mono-text">(key, channel)</span> pair.
          Use the editor on the next page to refine the prompts and publish.
        </DialogDescription>

        <form
          id="new-prompt-template-form"
          onSubmit={(e) => void onSubmit(e)}
          noValidate
          className="new-prompt-template-form"
        >
          {mutation.error ? (
            <Alert tone="error">{mutation.error.message}</Alert>
          ) : null}

          {form.formState.submitCount > 0 && validationMessages.length > 0 ? (
            <FormErrorSummary errors={validationMessages} />
          ) : null}

          <FormField
            label="Key"
            name="key"
            description="Stable identifier the suggestion service looks up. Lowercase, dot- or dash-separated. Cannot change after publish."
            error={form.formState.errors.key?.message}
          >
            <Input
              {...form.register('key')}
              placeholder="offer.description.suggest"
              maxLength={128}
              className="mono-text new-prompt-template-dialog__key-input"
            />
          </FormField>

          <FormField
            label="Channel"
            name="channel"
            description="Master = generic fallback for any platform. Channel-specific overrides win when published."
            error={form.formState.errors.channel?.message}
          >
            <Select {...form.register('channel')}>
              <option value="master">Master (generic)</option>
              <option value="prestashop">PrestaShop</option>
              <option value="allegro">Allegro</option>
            </Select>
          </FormField>

          <FormField
            label="System prompt"
            name="systemPrompt"
            description="Sent as the model's system message. Use {{dotted.path}} placeholders for variables."
            error={form.formState.errors.systemPrompt?.message}
          >
            <Textarea
              {...form.register('systemPrompt')}
              rows={6}
              maxLength={65536}
              placeholder="You are an assistant that writes marketplace product descriptions…"
            />
          </FormField>

          <FormField
            label="User prompt template"
            name="userPromptTemplate"
            description="Sent as the user message. Use {{dotted.path}} placeholders for variables."
            error={form.formState.errors.userPromptTemplate?.message}
          >
            <Textarea
              {...form.register('userPromptTemplate')}
              rows={6}
              maxLength={65536}
              placeholder="Write a description for {{product.name}} ({{product.category}})…"
            />
          </FormField>

          <FormField
            label="Variables (JSON)"
            name="variablesJson"
            description='JSON array of declared variables. Use [] for none. Example: [{"name":"product.name","type":"string","required":true}]'
            error={form.formState.errors.variablesJson?.message}
          >
            <Textarea
              {...form.register('variablesJson')}
              rows={5}
              className="mono-text"
              placeholder="[]"
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
                ? `✓ valid JSON · ${variablesStatus.count} variable${variablesStatus.count === 1 ? '' : 's'}`
                : `✗ ${variablesStatus.message}`}
            </p>
          ) : null}
        </form>

        <DialogFooter>
          <Button type="button" tone="secondary" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="new-prompt-template-form"
            tone="primary"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? 'Creating…' : 'Create draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

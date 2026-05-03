/**
 * New Prompt Template — Form Schema
 *
 * Zod schema for the "create draft" dialog (#488). Mirrors the backend
 * `CreatePromptTemplateDto`. The `channel` field surfaces a literal
 * `'master'` option in the UI and is mapped to `null` at submit time
 * (matching the wire contract). The `variablesJson` field is a free-form
 * JSON textarea that's parsed and validated against the variables schema
 * during `transform` — failures surface inline as form-validation errors,
 * not as API errors after a round-trip.
 *
 * @module apps/web/src/features/prompt-templates/components
 */
import { z } from 'zod';
import {
  PromptTemplateChannelValues,
  PromptTemplateVariableTypeValues,
  type PromptTemplateChannel,
  type PromptTemplateVariable,
} from '../api/prompt-templates.types';

const KEY_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

const MAX_PROMPT_LENGTH = 65536;
const MAX_VARIABLES = 64;

// Safer Zod enum: build a readonly tuple via `as const` so the spread
// preserves literal types. Leading 'master' represents the null channel.
const ChannelSelectValues = ['master', ...PromptTemplateChannelValues] as const;

const variableSchema = z.object({
  name: z.string().trim().min(1, 'Variable name is required').max(128),
  type: z.enum(PromptTemplateVariableTypeValues),
  required: z.boolean(),
  description: z.string().trim().max(256).optional(),
});

export const newPromptTemplateSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1, 'Key is required')
      .max(128)
      .regex(
        KEY_PATTERN,
        'Use lowercase letters, digits, dots, and dashes only (e.g. "offer.description.suggest")',
      ),
    channel: z.enum(ChannelSelectValues),
    systemPrompt: z
      .string()
      .min(1, 'System prompt is required')
      .max(MAX_PROMPT_LENGTH, `System prompt must be ${MAX_PROMPT_LENGTH} characters or fewer`),
    userPromptTemplate: z
      .string()
      .min(1, 'User prompt is required')
      .max(MAX_PROMPT_LENGTH, `User prompt must be ${MAX_PROMPT_LENGTH} characters or fewer`),
    /**
     * Free-form JSON textarea. Parsed + validated during `superRefine`
     * below — keeps the FE error path off the BE round-trip.
     */
    variablesJson: z.string(),
  })
  .superRefine((value, ctx) => {
    let parsed: unknown;
    try {
      parsed = value.variablesJson.trim() === '' ? [] : JSON.parse(value.variablesJson);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['variablesJson'],
        message: `Invalid JSON: ${err instanceof Error ? err.message : 'parse error'}`,
      });
      return;
    }
    if (!Array.isArray(parsed)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['variablesJson'],
        message: 'Variables must be a JSON array (use [] for none).',
      });
      return;
    }
    if (parsed.length > MAX_VARIABLES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['variablesJson'],
        message: `At most ${MAX_VARIABLES} variables allowed`,
      });
      return;
    }
    const variablesResult = z.array(variableSchema).safeParse(parsed);
    if (!variablesResult.success) {
      const firstIssue = variablesResult.error.issues[0];
      const path = firstIssue.path.length > 0 ? `[${firstIssue.path.join('.')}] ` : '';
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['variablesJson'],
        message: `Invalid variables: ${path}${firstIssue.message}`,
      });
    }
  });

export type NewPromptTemplateFormValues = z.input<typeof newPromptTemplateSchema>;
type NewPromptTemplateOutput = z.output<typeof newPromptTemplateSchema>;

export interface NewPromptTemplateApiInput {
  key: string;
  channel: PromptTemplateChannel | null;
  systemPrompt: string;
  userPromptTemplate: string;
  variables: PromptTemplateVariable[];
}

/**
 * Map the validated form values to the `CreatePromptTemplateDto` wire
 * shape: `master` → `null` channel, parsed `variablesJson` → typed array.
 *
 * The `JSON.parse` repeats the work `superRefine` already did. We keep
 * the redundancy on purpose — `superRefine` is validation-only (cannot
 * transform without changing the schema's output type) and the cost
 * (one parse of a tiny string per submit) is negligible vs. the
 * complexity of switching to `.transform()`. Caller must invoke this
 * only after `safeParse(success)` — the cast below is safe because
 * `superRefine` already rejected any non-conforming variable shape.
 */
export function toApiInput(values: NewPromptTemplateOutput): NewPromptTemplateApiInput {
  const variables = (
    values.variablesJson.trim() === ''
      ? []
      : (JSON.parse(values.variablesJson) as PromptTemplateVariable[])
  );
  return {
    key: values.key,
    channel: values.channel === 'master' ? null : values.channel,
    systemPrompt: values.systemPrompt,
    userPromptTemplate: values.userPromptTemplate,
    variables,
  };
}

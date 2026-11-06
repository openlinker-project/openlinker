/**
 * New Prompt Template — Form Schema
 *
 * Zod schema for the "create draft" dialog (#488). Mirrors the backend
 * `CreatePromptTemplateDto`. The `channel` field surfaces a literal
 * `'master'` option in the UI and is mapped to `null` at submit time
 * (matching the wire contract). The `variablesJson` field is a free-form
 * JSON textarea that's parsed and validated against the variables schema
 * during `superRefine` — failures surface inline as form-validation errors,
 * not as API errors after a round-trip.
 *
 * Channel is open-world per #580 — the schema and the picker's option
 * list are derived from the plugin registry at render time via
 * `usePlatforms()`. A plugin that ships its own `platform` contribution is
 * automatically a valid channel target with no further edits here.
 *
 * @module apps/web/src/features/prompt-templates/components
 */
import { useMemo } from 'react';
import { z } from 'zod';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import { usePlatforms } from '../../../shared/plugins';
import {
  PromptTemplateVariableTypeValues,
  type PromptTemplateChannel,
  type PromptTemplateVariable,
} from '../api/prompt-templates.types';

const KEY_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

const MAX_PROMPT_LENGTH = 65536;
const MAX_VARIABLES = 64;

/**
 * UI sentinel for "no channel — the master / generic template". The wire
 * contract uses `channel: null` for the same concept; `toApiInput` does
 * the mapping at submit time. Kept as a constant so the dialog component
 * and the schema's allowlist agree on the string by construction.
 */
export const MASTER_CHANNEL_SENTINEL = 'master';

export interface NewPromptTemplateFormValues {
  key: string;
  channel: string;
  systemPrompt: string;
  userPromptTemplate: string;
  variablesJson: string;
}

export interface NewPromptTemplateApiInput {
  key: string;
  channel: PromptTemplateChannel | null;
  systemPrompt: string;
  userPromptTemplate: string;
  variables: PromptTemplateVariable[];
}

/**
 * Registry-driven Zod schema for the create-prompt-template form. Channel
 * is validated against the live platform set (`usePlatforms()`) plus the
 * `'master'` sentinel — so adding a new plugin (e.g. Shopify) automatically
 * opens up authoring a `'shopify'`-channel template with zero schema edits.
 *
 * Wrapped in `useMemo([plugins])` so the resolver passed to
 * react-hook-form is stable across renders. The plugin manifest is
 * static-at-import-time today (see `plugins` in
 * `apps/web/src/plugins/index.ts`) — the memo guards against future
 * dynamic-registry shapes regenerating the schema needlessly.
 */
export function useNewPromptTemplateSchema(): z.ZodType<
  NewPromptTemplateFormValues,
  NewPromptTemplateFormValues
> {
  const plugins = usePlatforms();
  const copy = useMessages('prompt-templates').newPromptTemplateSchema;
  const format = useFormat();
  return useMemo(() => {
    const variableSchema = z.object({
      name: z.string().trim().min(1, copy.variableNameRequired).max(128),
      type: z.enum(PromptTemplateVariableTypeValues),
      required: z.boolean(),
      description: z.string().trim().max(256).optional(),
    });
    const maxPromptLength = format.number(MAX_PROMPT_LENGTH);
    // Guard the reserved `'master'` sentinel — a plugin that registered
    // `platformType: 'master'` would conflate the master template with itself
    // in the schema's allow-set and the picker. Vanishingly unlikely, but the
    // filter is cheap insurance.
    const allowedChannels = new Set<string>([
      MASTER_CHANNEL_SENTINEL,
      ...plugins
        .filter((plugin) => plugin.platformType !== MASTER_CHANNEL_SENTINEL)
        .map((plugin) => plugin.platformType),
    ]);
    return z
      .object({
        key: z
          .string()
          .trim()
          .min(1, copy.keyRequired)
          .max(128)
          .regex(KEY_PATTERN, copy.keyPattern),
        channel: z.string().refine((value) => allowedChannels.has(value), {
          message: copy.channelInvalid,
        }),
        systemPrompt: z
          .string()
          .min(1, copy.systemPromptRequired)
          .max(
            MAX_PROMPT_LENGTH,
            interpolate(copy.systemPromptTooLong, { max: maxPromptLength }),
          ),
        userPromptTemplate: z
          .string()
          .min(1, copy.userPromptRequired)
          .max(
            MAX_PROMPT_LENGTH,
            interpolate(copy.userPromptTooLong, { max: maxPromptLength }),
          ),
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
            message: interpolate(copy.invalidJson, {
              error: err instanceof Error ? err.message : copy.parseError,
            }),
          });
          return;
        }
        if (!Array.isArray(parsed)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['variablesJson'],
            message: copy.notArray,
          });
          return;
        }
        if (parsed.length > MAX_VARIABLES) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['variablesJson'],
            message: interpolate(copy.tooManyVariables, { max: format.number(MAX_VARIABLES) }),
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
            message: interpolate(copy.invalidVariables, { path, message: firstIssue.message }),
          });
        }
      });
  }, [plugins, copy, format]);
}

/**
 * Option list for the channel `<Select>`, derived from the same plugin
 * manifest the schema validates against. Stays in sync by construction
 * — there is only one source of truth for which channels exist.
 */
export interface ChannelSelectOption {
  value: string;
  label: string;
}

export function useChannelSelectOptions(): readonly ChannelSelectOption[] {
  const plugins = usePlatforms();
  const masterGeneric = useMessages('prompt-templates').common.masterGeneric;
  return useMemo(
    () => [
      { value: MASTER_CHANNEL_SENTINEL, label: masterGeneric },
      // Same `'master'` reservation as `useNewPromptTemplateSchema` — see
      // the rationale comment there.
      ...plugins
        .filter((plugin) => plugin.platformType !== MASTER_CHANNEL_SENTINEL)
        .map((plugin) => ({
          value: plugin.platformType,
          label: plugin.displayName,
        })),
    ],
    [plugins, masterGeneric],
  );
}

/**
 * Map the validated form values to the `CreatePromptTemplateDto` wire
 * shape: the `'master'` UI sentinel → `null` channel, parsed
 * `variablesJson` → typed array.
 *
 * The `JSON.parse` repeats the work `superRefine` already did. We keep
 * the redundancy on purpose — `superRefine` is validation-only (cannot
 * transform without changing the schema's output type) and the cost
 * (one parse of a tiny string per submit) is negligible vs. the
 * complexity of switching to `.transform()`. Caller must invoke this
 * only after `safeParse(success)` — the cast below is safe because
 * `superRefine` already rejected any non-conforming variable shape.
 */
export function toApiInput(values: NewPromptTemplateFormValues): NewPromptTemplateApiInput {
  const variables =
    values.variablesJson.trim() === ''
      ? []
      : (JSON.parse(values.variablesJson) as PromptTemplateVariable[]);
  return {
    key: values.key,
    channel: values.channel === MASTER_CHANNEL_SENTINEL ? null : values.channel,
    systemPrompt: values.systemPrompt,
    userPromptTemplate: values.userPromptTemplate,
    variables,
  };
}

import { z } from 'zod';
import type { CreateConnectionInput } from '../api/connections.types';

/**
 * `platformType` is an opaque string post-#578 — membership is enforced at
 * the registry boundary, not the schema. The schema only ensures the field
 * is non-empty; an unknown platform falls through to a clear runtime error
 * from `usePlatform()` consumers or the BE registry.
 */
export const platformTypeFormSchema = z
  .string()
  .trim()
  .min(1, 'Platform type is required');

export const createConnectionSchema = z
  .object({
    adapterKey: z.string().trim().optional(),
    configText: z
      .string()
      .trim()
      .min(2, 'Configuration JSON is required')
      .refine((value) => {
        try {
          JSON.parse(value);
          return true;
        } catch {
          return false;
        }
      }, 'Configuration must be valid JSON'),
    // Either an existing `db:` reference OR a raw credentials JSON payload
    // (encrypted server-side). Exactly one must be supplied — enforced in the
    // cross-field refine below so platforms without a guided wizard (e.g.
    // Subiekt) can be created from scratch with a bridge token.
    credentialsRef: z
      .string()
      .trim()
      .optional()
      .refine(
        (value) => value === undefined || value.length === 0 || value.startsWith('db:'),
        'Credentials reference must start with "db:" — raw keys are no longer accepted',
      ),
    credentialsJson: z
      .string()
      .trim()
      .optional()
      .refine((value) => {
        if (value === undefined || value.length === 0) return true;
        try {
          const parsed = JSON.parse(value);
          return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
        } catch {
          return false;
        }
      }, 'Credentials must be a valid JSON object'),
    enabledCapabilities: z.string().trim().optional(),
    name: z.string().trim().min(1, 'Connection name is required'),
    platformType: platformTypeFormSchema,
  })
  .refine(
    (values) => {
      const hasRef = Boolean(values.credentialsRef && values.credentialsRef.length > 0);
      const hasJson = Boolean(values.credentialsJson && values.credentialsJson.length > 0);
      return hasRef !== hasJson;
    },
    {
      message:
        'Provide exactly one of: a `db:` credentials reference OR a raw credentials JSON object',
      path: ['credentialsRef'],
    },
  );

export type CreateConnectionFormValues = z.input<typeof createConnectionSchema>;
export type CreateConnectionFormSubmission = z.output<typeof createConnectionSchema>;

export function toCreateConnectionInput(values: CreateConnectionFormSubmission): CreateConnectionInput {
  const caps = (values.enabledCapabilities ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  const hasJson = Boolean(values.credentialsJson && values.credentialsJson.length > 0);
  return {
    name: values.name,
    platformType: values.platformType,
    ...(hasJson
      ? { credentials: JSON.parse(values.credentialsJson as string) as Record<string, unknown> }
      : { credentialsRef: values.credentialsRef }),
    adapterKey: values.adapterKey ? values.adapterKey : undefined,
    config: JSON.parse(values.configText) as Record<string, unknown>,
    ...(caps.length > 0 ? { enabledCapabilities: caps as CreateConnectionInput['enabledCapabilities'] } : {}),
  };
}

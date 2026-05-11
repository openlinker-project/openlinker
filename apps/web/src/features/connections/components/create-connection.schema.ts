import { z } from 'zod';
import type { CreateConnectionInput } from '../api/connections.types';

/**
 * `platformType` is an opaque string post-#578 — membership is enforced at
 * the registry boundary, not the schema. The schema only ensures the field
 * is non-empty; an unknown platform falls through to a clear runtime error
 * from `usePlugin()` consumers or the BE registry.
 */
export const platformTypeFormSchema = z
  .string()
  .trim()
  .min(1, 'Platform type is required');

export const createConnectionSchema = z.object({
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
  credentialsRef: z
    .string()
    .trim()
    .min(1, 'Credentials reference is required')
    .refine(
      (value) => value.startsWith('db:'),
      'Credentials reference must start with "db:" — raw keys are no longer accepted',
    ),
  name: z.string().trim().min(1, 'Connection name is required'),
  platformType: platformTypeFormSchema,
});

export type CreateConnectionFormValues = z.input<typeof createConnectionSchema>;
export type CreateConnectionFormSubmission = z.output<typeof createConnectionSchema>;

export function toCreateConnectionInput(values: CreateConnectionFormSubmission): CreateConnectionInput {
  return {
    name: values.name,
    platformType: values.platformType,
    credentialsRef: values.credentialsRef,
    adapterKey: values.adapterKey ? values.adapterKey : undefined,
    config: JSON.parse(values.configText) as Record<string, unknown>,
  };
}

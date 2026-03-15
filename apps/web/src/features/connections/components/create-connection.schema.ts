import { z } from 'zod';
import { PLATFORM_TYPES, type CreateConnectionInput, type PlatformType } from '../api/connections.types';

export const platformTypeFormSchema = z
  .enum([...PLATFORM_TYPES, ''] as const)
  .refine((value): value is PlatformType => value !== '', 'Platform type is required');

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
  credentialsRef: z.string().trim().min(1, 'Credentials reference is required'),
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

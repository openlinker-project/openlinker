import { z } from 'zod';
import type { CreateConnectionInput } from '../api/connections.types';

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
  platformType: z.string().trim().min(1, 'Platform type is required'),
});

export type CreateConnectionFormValues = z.infer<typeof createConnectionSchema>;

export function toCreateConnectionInput(values: CreateConnectionFormValues): CreateConnectionInput {
  return {
    name: values.name,
    platformType: values.platformType,
    credentialsRef: values.credentialsRef,
    adapterKey: values.adapterKey ? values.adapterKey : undefined,
    config: JSON.parse(values.configText) as Record<string, unknown>,
  };
}

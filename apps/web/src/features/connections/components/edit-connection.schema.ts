import { z } from 'zod';
import type { UpdateConnectionInput } from '../api/connections.types';

export const editConnectionSchema = z.object({
  name: z.string().trim().min(1, 'Connection name is required'),
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
  adapterKey: z.string().trim().optional(),
});

export type EditConnectionFormValues = z.input<typeof editConnectionSchema>;
export type EditConnectionFormSubmission = z.output<typeof editConnectionSchema>;

export function toUpdateConnectionInput(values: EditConnectionFormSubmission): UpdateConnectionInput {
  return {
    name: values.name,
    adapterKey: values.adapterKey ? values.adapterKey : undefined,
    config: JSON.parse(values.configText) as Record<string, unknown>,
  };
}

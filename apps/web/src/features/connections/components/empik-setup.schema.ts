/**
 * Empik Setup Form Schema
 *
 * Zod schema and form-to-API mapping for the guided Empik Marketplace wizard.
 * Empik runs on Mirakl and authenticates a shop with one static API key, sent
 * raw in the `Authorization` header by the backend plugin (#4274). The form
 * collects a connection name, the key, the environment (Production or
 * Staging) and an optional shop id.
 *
 * The payload persists the neutral `config.environment` choice; the backend
 * maps it to the operator's host, so no Empik URL is stored on the connection.
 * `enabledCapabilities` is omitted so the API defaults it to the manifest's
 * supported set.
 *
 * @module features/connections/components
 */
import { z } from 'zod';
import type { CreateConnectionInput } from '../api/connections.types';
import { schemaMessage } from '../lib/schema-message';

const msg = schemaMessage('empikSetupSchema');

export const EMPIK_ADAPTER_KEY = 'empik.mirakl.v1';

export const EmpikEnvironmentValues = ['production', 'staging'] as const;
export type EmpikEnvironment = (typeof EmpikEnvironmentValues)[number];

export const empikSetupSchema = z.object({
  name: z.string().trim().min(1, msg('nameRequired')),
  apiKey: z.string().trim().min(1, msg('apiKeyRequired')),
  environment: z.enum(EmpikEnvironmentValues),
  shopId: z
    .string()
    .trim()
    .refine((value) => value === '' || /^[1-9]\d{0,15}$/.test(value), msg('shopIdInvalid')),
});

export type EmpikSetupFormValues = z.input<typeof empikSetupSchema>;
export type EmpikSetupFormSubmission = z.output<typeof empikSetupSchema>;

export const EMPIK_SETUP_DEFAULT_VALUES: EmpikSetupFormValues = {
  name: '',
  apiKey: '',
  environment: 'production',
  shopId: '',
};

export function toCreateConnectionInput(values: EmpikSetupFormSubmission): CreateConnectionInput {
  return {
    name: values.name,
    platformType: 'empik',
    adapterKey: EMPIK_ADAPTER_KEY,
    credentials: { apiKey: values.apiKey },
    config: {
      environment: values.environment,
      ...(values.shopId === '' ? {} : { shopId: values.shopId }),
    },
  };
}

/**
 * Shoper Setup Form Schema
 *
 * Zod schema + form → API payload mapping for the guided Shoper connection
 * wizard. Shoper is authenticated with a single static Bearer token ("Token
 * API", issued by the shop's own admin panel). The form collects a connection
 * name, the shop host (`baseUrl`) and the token.
 *
 * Host rules (https only, no path / port / IP) are enforced by the BE shape
 * validator and surfaced through the create error Alert - the FE does not
 * mirror them, so the two cannot drift.
 *
 * @module features/connections/components
 */
import { z } from 'zod';
import type { CreateConnectionInput } from '../api/connections.types';

export const SHOPER_ADAPTER_KEY = 'shoper.restapi.v1';

export const shoperSetupSchema = z.object({
  name: z.string().trim().min(1, 'Connection name is required'),
  baseUrl: z.string().trim().min(1, 'Shop address is required'),
  token: z.string().trim().min(1, 'API token is required'),
});

export type ShoperSetupFormValues = z.input<typeof shoperSetupSchema>;
export type ShoperSetupFormSubmission = z.output<typeof shoperSetupSchema>;

export const SHOPER_SETUP_DEFAULT_VALUES: ShoperSetupFormValues = {
  name: '',
  baseUrl: '',
  token: '',
};

export function toCreateConnectionInput(values: ShoperSetupFormSubmission): CreateConnectionInput {
  return {
    name: values.name,
    platformType: 'shoper',
    adapterKey: SHOPER_ADAPTER_KEY,
    credentials: { token: values.token },
    config: { baseUrl: values.baseUrl },
    // enabledCapabilities is OMITTED on purpose: the connection lands with the
    // adapter manifest's defaults (OrderProcessorManager is deliberately not one
    // of them; an operator enables it explicitly).
  };
}

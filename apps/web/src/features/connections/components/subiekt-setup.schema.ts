/**
 * Subiekt Setup Form Schema
 *
 * Zod schema + form → API payload mapping for the guided Subiekt connection
 * wizard (#1199). Subiekt nexo is reached through the OpenLinker Sfera bridge —
 * a LAN service — so the operator supplies the bridge base URL (`http` allowed,
 * the bridge is local) and, optionally, a shared bridge token for a hardened
 * deployment. `timeoutMs` is an optional advanced override.
 *
 * Mirrors the merged BE contract (`SubiektConnectionConfigDto`: `bridgeBaseUrl`
 * required, `timeoutMs` 1000–120000; credentials `{ bridgeToken? }`). The IMDS
 * safety guard on the bridge URL is BE-authoritative — a rejected URL surfaces
 * as a create-error Alert; the FE only enforces structural validity.
 * `enabledCapabilities` is intentionally omitted from the payload so the API
 * defaults it to the adapter manifest's supported set (`['Invoicing']`).
 *
 * @module features/connections/components
 */
import { z } from 'zod';
import type { CreateConnectionInput } from '../api/connections.types';

export const SUBIEKT_ADAPTER_KEY = 'subiekt.invoicing.v1';

const startsWithHttpProtocol = (value: string): boolean =>
  value.startsWith('http://') || value.startsWith('https://');

export const subiektSetupSchema = z.object({
  name: z.string().trim().min(1, 'Connection name is required'),
  bridgeBaseUrl: z
    .string()
    .trim()
    .min(1, 'Bridge URL is required')
    .url('Bridge URL must be a valid URL (e.g. http://127.0.0.1:5000)')
    .refine(startsWithHttpProtocol, 'Bridge URL must start with http:// or https://'),
  // RHF text inputs emit strings; the BE validates `@IsInt() @Min(1000) @Max(120000)`.
  // Blank → omitted; a typed value → coerced to a number (TR-IMPORTANT, #1199).
  timeoutMs: z
    .union([
      z.literal(''),
      z.coerce
        .number()
        .int('Request timeout must be a whole number of milliseconds')
        .min(1000, 'Request timeout must be at least 1000 ms')
        .max(120000, 'Request timeout must be at most 120000 ms'),
    ])
    .optional(),
  bridgeToken: z.string().trim().optional(),
});

export type SubiektSetupFormValues = z.input<typeof subiektSetupSchema>;
export type SubiektSetupFormSubmission = z.output<typeof subiektSetupSchema>;

export const SUBIEKT_SETUP_DEFAULT_VALUES: SubiektSetupFormValues = {
  name: '',
  bridgeBaseUrl: '',
  timeoutMs: '',
  bridgeToken: '',
};

export function toCreateConnectionInput(
  values: SubiektSetupFormSubmission,
): CreateConnectionInput {
  const config: Record<string, unknown> = { bridgeBaseUrl: values.bridgeBaseUrl };
  if (typeof values.timeoutMs === 'number') {
    config.timeoutMs = values.timeoutMs;
  }

  const input: CreateConnectionInput = {
    name: values.name,
    platformType: 'subiekt',
    adapterKey: SUBIEKT_ADAPTER_KEY,
    config,
    // enabledCapabilities OMITTED on purpose — `ConnectionService.create`
    // defaults to the adapter manifest's supported set (`['Invoicing']`).
  };

  // Optional shared bridge token — only sent when the operator provides one
  // (the common unauthenticated-LAN-bridge path carries no credentials).
  if (values.bridgeToken && values.bridgeToken.length > 0) {
    input.credentials = { bridgeToken: values.bridgeToken };
  }

  return input;
}

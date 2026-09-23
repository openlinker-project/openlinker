/**
 * Subiekt Setup Form Schema
 *
 * Zod schema + form → API payload mapping for the guided Subiekt connection
 * wizard (#1199). Subiekt GT is reached through the OpenLinker Sfera bridge —
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

/**
 * Which Subiekt product a connection is being created for.
 *
 * Subiekt GT and Subiekt nexo are two different InsERT products with two
 * different bridges, and ONE setup form serves both - so the identity is
 * supplied by the caller rather than baked in. There is deliberately NO
 * default: a default is exactly how an operator ends up creating the wrong
 * product silently, and the wrong product means a connection pointed at an
 * adapter that speaks a different bridge's contract.
 */
export interface SubiektProductIdentity {
  readonly platformType: string;
  readonly adapterKey: string;
}

/**
 * Each value must stay byte-identical to the `adapterKey` / `platformType` of
 * the matching adapter manifest - `libs/integrations/subiekt` for GT,
 * `libs/integrations/subiekt-nexo` for nexo. The browser cannot import
 * `@openlinker/core` (#591), so these are mirrors; a drift does not fail at
 * boot or at type-check - it fails silently the moment an operator clicks "add
 * connection", minting a connection no adapter recognises.
 * `scripts/check-subiekt-identity-mirror.mjs` guards both pairs.
 */
export const SUBIEKT_GT_IDENTITY: SubiektProductIdentity = {
  platformType: 'subiekt-gt',
  adapterKey: 'subiekt.gt.v1',
};

export const SUBIEKT_NEXO_IDENTITY: SubiektProductIdentity = {
  platformType: 'subiekt-nexo',
  adapterKey: 'subiekt.nexo.v1',
};

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
  identity: SubiektProductIdentity,
): CreateConnectionInput {
  const config: Record<string, unknown> = { bridgeBaseUrl: values.bridgeBaseUrl };
  if (typeof values.timeoutMs === 'number') {
    config.timeoutMs = values.timeoutMs;
  }

  const input: CreateConnectionInput = {
    name: values.name,
    platformType: identity.platformType,
    adapterKey: identity.adapterKey,
    config,
    // enabledCapabilities OMITTED on purpose — `ConnectionService.create`
    // defaults to the adapter manifest's full supported-capability set
    // (Invoicing included), since Subiekt declares no
    // `defaultEnabledCapabilities` override (#3350) — only a manifest that
    // needs a NARROWER default (eparagony's dual invoicing/fiscalization
    // wizard) declares one.
  };

  // Optional shared bridge token — only sent when the operator provides one
  // (the common unauthenticated-LAN-bridge path carries no credentials).
  if (values.bridgeToken && values.bridgeToken.length > 0) {
    input.credentials = { bridgeToken: values.bridgeToken };
  }

  return input;
}

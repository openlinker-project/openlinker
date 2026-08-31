import { z } from 'zod';
import type { CreateConnectionInput } from '../api/connections.types';

/**
 * `platformType` is an opaque string post-#578 — membership is enforced at
 * the registry boundary, not the schema. The schema only ensures the field
 * is non-empty; an unknown platform falls through to a clear runtime error
 * from `usePlatform()` consumers or the BE registry.
 */
export const platformTypeFormSchema = z.string().trim().min(1, 'Platform type is required');

/**
 * Build the create-connection schema.
 *
 * `requiresCredentials` mirrors the destination adapter's own
 * `AdapterMetadata.requiresCredentials` declaration (#2405, ADR-055), read
 * from `GET /adapters`. When an adapter declares `false` — the OL-OMS, which
 * crosses no network boundary and therefore holds no credentials — the
 * exactly-one-of refine is dropped, because "neither" is then a valid
 * submission.
 *
 * Keyed on the declared capability, never on `platformType`: a literal
 * platform check here would be both an ESLint violation (#578/#579) and
 * unavailable to any third-party OMS adapter.
 */
export function buildCreateConnectionSchema(options?: { requiresCredentials?: boolean }) {
  const requiresCredentials = options?.requiresCredentials !== false;
  const shape = z
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
          'Credentials reference must start with "db:" — raw keys are no longer accepted'
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
        // Dropped entirely for a credential-less adapter: "neither" is the
        // correct submission there, and refusing it would make the OMS
        // connection uncreatable from the UI.
        if (!requiresCredentials) return true;
        const hasRef = Boolean(values.credentialsRef && values.credentialsRef.length > 0);
        const hasJson = Boolean(values.credentialsJson && values.credentialsJson.length > 0);
        return hasRef !== hasJson;
      },
      {
        message:
          'Provide exactly one of: a `db:` credentials reference OR a raw credentials JSON object',
        path: ['credentialsRef'],
      }
    );
  return shape;
}

/**
 * The default (credential-requiring) schema. Retained as a named export so
 * every pre-#2405 consumer keeps working unchanged.
 */
export const createConnectionSchema = buildCreateConnectionSchema();

export type CreateConnectionFormValues = z.input<typeof createConnectionSchema>;
export type CreateConnectionFormSubmission = z.output<typeof createConnectionSchema>;

export function toCreateConnectionInput(
  values: CreateConnectionFormSubmission,
  options?: { requiresCredentials?: boolean }
): CreateConnectionInput {
  const caps = (values.enabledCapabilities ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  // A credential-less adapter never sends credentials, whatever is sitting in
  // form state. React Hook Form KEEPS a field's value when the input unmounts
  // (no `shouldUnregister`), so an operator who typed a credentials JSON for
  // one platform and then switched to the OMS would otherwise strand that
  // value and submit it — and because the relaxed schema drops the
  // exactly-one-of refine, nothing would complain. The service would then take
  // its `if (credentials)` branch and persist a credential row nothing reads,
  // reporting `credentialsBacked: true` for a connection that holds none.
  // The form also clears both fields on platform change; this is the belt to
  // that pair of braces, and the one that survives a future caller.
  //
  // Note the deliberate asymmetry with `buildCreateConnectionSchema`, which
  // still ACCEPTS a `db:` ref for a credential-less adapter (a ref is not
  // invalid, merely unnecessary) while this drops it. Unreachable through the
  // form, whose credential inputs are not rendered for such an adapter — but
  // if they ever are, the schema must refuse the value rather than let this
  // discard it silently.
  const credentialLess = options?.requiresCredentials === false;
  const hasJson =
    !credentialLess && Boolean(values.credentialsJson && values.credentialsJson.length > 0);
  const hasRef =
    !credentialLess && Boolean(values.credentialsRef && values.credentialsRef.length > 0);
  return {
    name: values.name,
    platformType: values.platformType,
    // BOTH keys are omitted when neither field was filled in (#2405). Sending
    // `credentialsRef: ''` — which is what an untouched RHF text input yields
    // — is a 400 at the DTO: `@IsOptional()` skips only null/undefined, so an
    // empty string is validated and fails `@IsNotEmpty()` and `@Matches(/^db:/)`.
    // Pinned by `create-connection.dto.spec.ts`.
    ...(hasJson
      ? { credentials: JSON.parse(values.credentialsJson as string) as Record<string, unknown> }
      : hasRef
        ? { credentialsRef: values.credentialsRef }
        : {}),
    adapterKey: values.adapterKey ? values.adapterKey : undefined,
    config: JSON.parse(values.configText) as Record<string, unknown>,
    ...(caps.length > 0
      ? { enabledCapabilities: caps as CreateConnectionInput['enabledCapabilities'] }
      : {}),
  };
}

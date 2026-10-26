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

  /** Operator-facing product name, used in the page title and in form copy. */
  readonly productName: string;

  /**
   * A real address for THIS product's bridge, shown as the placeholder and in
   * the validation message.
   *
   * It has to be per product because the two bridges listen on different ports
   * — nexo on 5005, GT on 5056 (plain HTTP) with 5055 for TLS. The wizard used
   * to suggest `127.0.0.1:5000`, which is neither, so every operator who
   * trusted the hint got a connection that could not reach anything.
   */
  readonly bridgeUrlExample: string;

  /**
   * Whether the guided wizard REFUSES to create this product's connection
   * without a bridge token.
   *
   * `true` for both products today, and the axis exists because the two bridges
   * differ in whether that can ever be false. GT has no off switch at all: an
   * unset `InvoiceToken` closes every `/api/*` route, so a tokenless connection
   * is a connection that cannot work. nexo has `Auth.Enabled`, but it defaults
   * on and the bridge REFUSES TO START with auth off on a non-loopback bind —
   * so the only configuration that could set this `false` is a strict-loopback
   * development bridge, which is not what a guided wizard is for. Such a setup
   * can still be created through advanced mode or the API, where the schema's
   * own `optional` still holds.
   */
  readonly tokenRequired: boolean;

  /**
   * Where the operator SETS the value they are being asked to paste here.
   *
   * Per product because the two bridges name the setting differently — GT reads
   * `InvoiceToken`, nexo reads `Auth:ApiKey` — and because the documentation
   * used to claim the credential was "hardcoded in the bridge, consult your
   * bridge operator", which is false for both: the operator chooses it, and
   * until they do, the bridge serves nothing.
   */
  readonly tokenConfigHint: string;
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
  productName: 'Subiekt GT',
  // BridgeConfig.cs: HttpPort 5056, HttpsPort 5055. The plain-HTTP port is the
  // one OpenLinker reaches the bridge on when no certificate is configured.
  bridgeUrlExample: 'http://127.0.0.1:5056',
  tokenRequired: true,
  tokenConfigHint:
    'Set it as InvoiceToken in the bridge\u2019s appsettings.json, or as the OL_BRIDGE_INVOICE_TOKEN environment variable.',
};

export const SUBIEKT_NEXO_IDENTITY: SubiektProductIdentity = {
  platformType: 'subiekt-nexo',
  adapterKey: 'subiekt.nexo.v1',
  productName: 'Subiekt nexo',
  // appsettings.example.json: "Port": 5005 — one port, not a pair.
  bridgeUrlExample: 'http://127.0.0.1:5005',
  tokenRequired: true,
  tokenConfigHint:
    'Set it as Auth:ApiKey in the bridge\u2019s appsettings.json, or as the Auth__ApiKey environment variable.',
};

const startsWithHttpProtocol = (value: string): boolean =>
  value.startsWith('http://') || value.startsWith('https://');

/**
 * Builds the wizard schema for ONE Subiekt product.
 *
 * It is a factory rather than a module-level constant because two rules differ
 * per product: the bridge-URL example in the validation message, and whether a
 * bridge token is required. Both used to be one global answer, and both were
 * wrong for at least one product.
 *
 * `bridgeToken` stays `.optional()` on the object and its requiredness lives in
 * `superRefine`. That is the `mailer-settings-form.schema.ts` shape, and it is
 * deliberate rather than incidental: a connection saved before this rule
 * existed, and one created through advanced mode or the API, must still be
 * describable by this type. The wizard is where the refusal belongs, because
 * the wizard is where there is an operator to tell.
 */
export function buildSubiektSetupSchema(identity: SubiektProductIdentity) {
  return z
    .object({
      name: z.string().trim().min(1, 'Connection name is required'),
      bridgeBaseUrl: z
        .string()
        .trim()
        .min(1, 'Bridge URL is required')
        .url(`Bridge URL must be a valid URL (e.g. ${identity.bridgeUrlExample})`)
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
      // Only the two usable values: `batched` throws
      // `BatchedTriggerNotImplementedError`, and `auto-on-shipped` is
      // meaningless for a connection that issues the document rather than
      // shipping the parcel.
      triggerModel: z.enum(['manual', 'auto-on-paid']),
    })
    // Always attached, branching INSIDE, so the return type does not depend on
    // `tokenRequired` and the exported form types stay single.
    .superRefine((values, ctx) => {
      if (!identity.tokenRequired) return;
      if (values.bridgeToken !== undefined && values.bridgeToken.length > 0) return;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bridgeToken'],
        message: `Bridge token is required — ${identity.productName}'s bridge rejects every request without it.`,
      });
    });
}

/**
 * Canonical instance used only to derive the form types. Every product's schema
 * has the same input and output shape; only the messages and the token rule
 * differ, and neither changes the type.
 */
const subiektSetupSchemaForTypes = buildSubiektSetupSchema(SUBIEKT_GT_IDENTITY);

export type SubiektSetupFormValues = z.input<typeof subiektSetupSchemaForTypes>;
export type SubiektSetupFormSubmission = z.output<typeof subiektSetupSchemaForTypes>;

export const SUBIEKT_SETUP_DEFAULT_VALUES: SubiektSetupFormValues = {
  name: '',
  bridgeBaseUrl: '',
  timeoutMs: '',
  bridgeToken: '',
  // Defaulting to `auto-on-paid` would start issuing fiscal documents nobody
  // asked for on the very first paid order. The control is rendered, not
  // assumed.
  triggerModel: 'manual',
};

export function toCreateConnectionInput(
  values: SubiektSetupFormSubmission,
  identity: SubiektProductIdentity,
): CreateConnectionInput {
  const config: Record<string, unknown> = {
    bridgeBaseUrl: values.bridgeBaseUrl,
    // WITHOUT these two keys a Subiekt connection auto-issues nothing, ever,
    // and says nothing about it. `readSalesDocumentRouting` reads
    // `config.salesDocument.documentKind`; absent, the connection is not a
    // routing candidate at all, `chooseSalesDocumentDecision` answers null and
    // `AutoIssueTriggerService` returns `{kind:'none'}`. An order then carries
    // a ZK in Subiekt and no document, with no badge, no failed job and no log
    // line an operator would read. `triggerModel` is the second gate:
    // `parseTriggerModel` defaults to `manual`, so even a connection carrying
    // the kind issues only by hand.
    //
    // No backend change is needed to write them - the Subiekt config-shape
    // validator runs `whitelist: false` and `CreateConnectionDto.config` is a
    // bare `@IsObject()` - and the settings panel writes the identical shape
    // through `mergeSalesDocumentConfig`, so the two surfaces stay one.
    //
    // `documentKind` is pinned rather than offered: neither Subiekt manifest
    // advertises `Fiscalization`, so `fiscal-receipt` (and `both`) would
    // resolve to `unsupported-document-kind-on-connection` - a picker offering
    // a value that cannot work.
    salesDocument: { documentKind: 'invoice' },
    invoicing: { triggerModel: values.triggerModel },
  };
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

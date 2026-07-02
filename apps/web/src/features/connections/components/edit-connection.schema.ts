import { z } from 'zod';
import type {
  ConnectionConfigContribution,
  PluginEditConnectionFields,
} from '../../../shared/plugins';
import type { UpdateConnectionInput } from '../api/connections.types';
import { POLISH_VOIVODESHIP_VALUES } from '../types/polish-voivodeship.types';
import { INVOICE_TRIGGER_MODEL_VALUES } from '../types/invoice-trigger-model.types';

/**
 * Connection-level seller-defaults schema (#430 / #445). Each sub-field is
 * optional at the FE level so the operator can save incremental progress
 * (e.g. fill location now, return for safety info later); the BE DTO
 * validator at `apps/api/src/integrations/application/dto/allegro-connection-config.dto.ts`
 * is the strict gate.
 *
 * `safetyInformation` is a discriminated union — when `type` is `TEXT`,
 * `description` becomes required server-side (1–5000 chars per Allegro).
 * `ATTACHMENTS` carries `attachments[].id`; the FE upload UI for that
 * variant is out of scope for #445 — operators can still target it via
 * the JSON view if they have pre-uploaded attachment ids.
 */
const allegroSellerLocationSchema = z.object({
  countryCode: z.literal('PL').optional(),
  province: z.union([z.enum(POLISH_VOIVODESHIP_VALUES), z.literal('')]).optional(),
  city: z.string().trim().max(200).optional(),
  postCode: z
    .union([
      z.string().regex(/^\d{2}-\d{3}$/, 'Postcode must use the PL format NN-NNN'),
      z.literal(''),
    ])
    .optional(),
});

// FE schema is permissive (optional everywhere) so the operator can save
// incremental progress. The BE DTO is the strict gate — see #445. The one
// cross-field check added for #449 surfaces a clear error when the operator
// has actively selected ATTACHMENTS but hasn't uploaded any file yet — the
// BE DTO would reject this anyway, but catching it client-side gives a
// targeted error next to the file-upload field rather than a generic
// 400. We deliberately don't migrate to `z.discriminatedUnion` here because
// it would force `attachments` to be required up-front and break the
// incremental-progress contract.
const allegroSafetyInformationSchema = z
  .object({
    type: z.enum(['NO_SAFETY_INFORMATION', 'TEXT', 'ATTACHMENTS']).optional(),
    description: z.string().trim().max(5000).optional(),
    attachments: z
      .array(z.object({ id: z.string().trim().min(1) }))
      .max(20)
      .optional(),
  })
  .superRefine((val, ctx) => {
    if (val.type === 'ATTACHMENTS' && (!val.attachments || val.attachments.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['attachments'],
        message: 'Add at least one attachment when "Provide safety information (file)" is selected.',
      });
    }
  });

const allegroSellerDefaultsSchema = z.object({
  location: allegroSellerLocationSchema.optional(),
  responsibleProducerId: z.string().trim().optional(),
  safetyInformation: allegroSafetyInformationSchema.optional(),
});

export type AllegroSellerDefaultsFormValues = z.input<typeof allegroSellerDefaultsSchema>;

/**
 * InPost sender-address structured schema (#771). Mirrors the shipped backend
 * config DTO (`libs/integrations/inpost/.../inpost-connection-config.dto.ts`):
 * `senderAddress: { name?, email, phone, address: { street, buildingNumber,
 * city, postCode (NN-NNN), countryCode (ISO2) } }`. Every sub-field is optional
 * at the FE level so the operator can save incremental progress; the BE DTO is
 * the strict gate (email/phone/address required). Format IS enforced
 * client-side when a value is present (email shape, PL postcode, ISO2 country)
 * for fast, targeted feedback. Modelled on the `sellerDefaults` whole-object
 * pattern: a nested `inpostSenderAddress` object on the form that the merge
 * helper prunes into `config.senderAddress`.
 */
const inpostAddressSchema = z.object({
  street: z.string().trim().max(200).optional(),
  buildingNumber: z.string().trim().max(50).optional(),
  city: z.string().trim().max(200).optional(),
  postCode: z
    .union([
      z.string().regex(/^\d{2}-\d{3}$/, 'Postcode must use the PL format NN-NNN'),
      z.literal(''),
    ])
    .optional(),
  // Coerce to uppercase before the ISO2 check so a lowercase `pl` is accepted
  // and normalized — parity with the setup wizard's countryCode transform
  // (`inpost-setup.schema.ts`). `z.literal('')` is listed first so an empty
  // value short-circuits before the transform (an uppercased '' would fail the regex).
  countryCode: z
    .union([
      z.literal(''),
      z
        .string()
        .trim()
        .transform((v) => v.toUpperCase())
        .pipe(z.string().regex(/^[A-Z]{2}$/, 'Country must be an ISO 3166-1 alpha-2 code (e.g. PL)')),
    ])
    .optional(),
});

const inpostSenderAddressSchema = z.object({
  name: z.string().trim().max(200).optional(),
  email: z.union([z.string().trim().email('Enter a valid email'), z.literal('')]).optional(),
  phone: z.string().trim().max(30).optional(),
  address: inpostAddressSchema.optional(),
});

export type InpostSenderAddressFormValues = z.input<typeof inpostSenderAddressSchema>;

export const editConnectionSchema = z
  .object({
    name: z.string().trim().min(1, 'Connection name is required'),
    baseUrl: z.string().trim().optional(),
    // WooCommerce-only structured field surfacing `config.siteUrl` — the key
    // the WooCommerce backend config DTO validates (#975). Mirrors the setup
    // wizard's https-only rule (Basic Auth credentials must not travel in
    // cleartext); empty string stays allowed (delete-on-empty merge semantics).
    siteUrl: z
      .union([
        z
          .url('Site URL must be a valid URL (e.g. https://shop.example.com)')
          .refine((value) => value.startsWith('https://'), 'Site URL must use HTTPS'),
        z.literal(''),
      ])
      .optional(),
    shopId: z.string().trim().optional(),
    // Optional override for the split-host case (webservice host ≠ public storefront).
    // Accepts a validated URL or an empty string (to unset). See #271 / #283.
    storefrontBaseUrl: z
      .union([
        z
          .url('Storefront URL must be a valid URL')
          .refine(
            (value) => value.startsWith('http://') || value.startsWith('https://'),
            'Storefront URL must use http:// or https://',
          ),
        z.literal(''),
      ])
      .optional(),
    // OL's URL from PrestaShop's perspective — used by the webhook auto-install
    // flow (#168). FE pre-fills this from `window.location.origin` on first
    // render when empty so most operators don't have to think about it; dev
    // override is `http://host.docker.internal:3000`.
    openlinkerCallbackBaseUrl: z
      .union([
        z
          .url('Callback URL must be a valid URL')
          .refine(
            (value) => value.startsWith('http://') || value.startsWith('https://'),
            'Callback URL must use http:// or https://',
          ),
        z.literal(''),
      ])
      .optional(),
    masterCatalogConnectionId: z
      .union([z.string().uuid('Product catalog must be a valid connection ID'), z.literal('')])
      .optional(),
    // PrestaShop-only structured field surfacing `config.defaultCarrierId`
    // (#517). Stored as a string on the form so the same `<Select>`
    // primitive can serve both this field and the per-method mapping
    // dropdown (which uses string `id_reference` values). `mergeStructuredIntoConfig`
    // coerces to an integer at submit; non-integer/zero/negative input is
    // refused with a Zod refine.
    defaultCarrierId: z
      .union([
        z.string().refine((v) => v === '' || /^[1-9]\d*$/.test(v.trim()), {
          message: 'Default carrier ID must be a positive integer.',
        }),
        z.literal(''),
      ])
      .optional(),
    // WooCommerce-only structured field surfacing `config.inventory.unmanagedStockQuantity`
    // (#969 §7.3). Quantity reported for products with stock management disabled but
    // `stock_status=instock`. String on the form (same shape as defaultCarrierId);
    // `mergeStructuredIntoConfig` coerces to an integer nested under `inventory` at
    // submit. Empty clears the override so the adapter default (1000) applies.
    unmanagedStockQuantity: z
      .union([
        z.string().refine((v) => v === '' || /^[1-9]\d*$/.test(v.trim()), {
          message: 'Unmanaged stock quantity must be a positive integer.',
        }),
        z.literal(''),
      ])
      .optional(),
    // PS-only structured field for the installed InPost PS module type (#767/#1155).
    // Controls whether OL reads the paczkomat locker code from address2 on order
    // ingestion. '' (empty string, select sentinel) = clear the key; 'official_inpost' = enabled.
    inpostPsModuleType: z.union([z.literal('official_inpost'), z.literal('')]).optional(),
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
    // #430 — Allegro-only structured fields. Always optional at the form
    // level; the BE DTO validates strict shape on PATCH.
    sellerDefaults: allegroSellerDefaultsSchema.optional(),
    // #759 — Subiekt-only structured fields.
    // Bridge URL → flat `config.subiektBridgeUrl`. URL-or-empty (empty unsets,
    // delete-on-empty merge). Mirrors `storefrontBaseUrl` (http/https allowed).
    subiektBridgeUrl: z
      .union([
        z
          .url('Bridge URL must be a valid URL')
          .refine(
            (value) => value.startsWith('http://') || value.startsWith('https://'),
            'Bridge URL must use http:// or https://',
          ),
        z.literal(''),
      ])
      .optional(),
    // Invoice trigger model → NESTED `config.invoicing.triggerModel` (NOT flat).
    // Empty allowed for unset. The 4 values mirror the live BE reader
    // `getInvoiceTriggerModel` (see `types/invoice-trigger-model.types.ts`).
    subiektTriggerModel: z.union([z.enum(INVOICE_TRIGGER_MODEL_VALUES), z.literal('')]).optional(),
    // Capability toggles → whole-object `config.capabilities.<key> = boolean`.
    subiektCapabilities: z.record(z.string(), z.boolean()).optional(),
    // Infakt-only structured field surfacing `config.defaultPaymentMethod`
    // (#1303). Empty allowed for unset — the adapter falls back to `'cash'`.
    infaktPaymentMethod: z.union([z.enum(['cash', 'transfer']), z.literal('')]).optional(),
    // InPost-only structured fields (#771). `inpostEnvironment` → flat
    // `config.environment`, `inpostOrganizationId` → flat `config.organizationId`,
    // `inpostSenderAddress` → whole-object `config.senderAddress`. Field names are
    // `inpost*`-prefixed to avoid colliding with DPD's `environment` / other
    // platforms' flat keys; the merge clauses map them to the real config keys.
    // All optional at the FE level for incremental save; the BE DTO is the gate.
    inpostEnvironment: z.union([z.enum(['sandbox', 'production']), z.literal('')]).optional(),
    inpostOrganizationId: z.string().trim().optional(),
    inpostSenderAddress: inpostSenderAddressSchema.optional(),
  });

/**
 * Form value types are widened with `PluginEditConnectionFields` (#1330) — the
 * declaration-merging seam plugins populate with the field names their
 * `ConnectionConfigContribution.schemaShape` adds. All merged fields are
 * optional, so base-only usage (and every non-contributing platform) is
 * unaffected.
 */
export type EditConnectionFormValues = z.input<typeof editConnectionSchema> &
  Partial<PluginEditConnectionFields>;
export type EditConnectionFormSubmission = z.output<typeof editConnectionSchema> &
  Partial<PluginEditConnectionFields>;

/**
 * Compose the edit-connection resolver schema for one connection (#1330). The
 * shared base carries the platform-neutral fields plus the not-yet-migrated
 * inline platform fields; a platform's `ConnectionConfigContribution` (resolved
 * via `usePlatform(connection.platformType)`) extends it with that platform's
 * own field fragment and optional cross-field `superRefine` checks. Only the
 * edited connection's platform matters at edit time, so composition happens at
 * render time — never from a `features → plugins` import.
 */
export function buildEditConnectionSchema(
  contribution?: ConnectionConfigContribution,
): z.ZodType<EditConnectionFormSubmission, EditConnectionFormValues> {
  // `schemaShape` is keyed by `keyof PluginEditConnectionFields` (a mapped
  // type whose values may read as `| undefined`), so it needs a structural
  // cast to the `ZodRawShape` that `.extend()` accepts - key/field agreement
  // is already compiler-enforced at the contribution literal.
  const objectSchema = contribution
    ? editConnectionSchema.extend(contribution.schemaShape as z.ZodRawShape)
    : editConnectionSchema;
  const refine = contribution?.superRefine;
  const composed = refine ? objectSchema.superRefine((values, ctx) => refine(values, ctx)) : objectSchema;
  // The extended shape is opaque to the static base types; the contribution's
  // declaration-merged fields make the runtime and static views agree.
  return composed as unknown as z.ZodType<EditConnectionFormSubmission, EditConnectionFormValues>;
}

export function toUpdateConnectionInput(values: EditConnectionFormSubmission): UpdateConnectionInput {
  return {
    name: values.name,
    adapterKey: values.adapterKey ? values.adapterKey : undefined,
    config: JSON.parse(values.configText) as Record<string, unknown>,
  };
}

/**
 * Structured patch merged into the raw config JSON. Declared as a type alias
 * (not an interface) so it carries an implicit index signature — plugin
 * sections sync their own field names through the same
 * `mergeStructuredIntoConfig` path, and their patches flow through to the
 * platform's `ConnectionConfigContribution.applyToConfig` (#1330).
 */
export type StructuredConfigPatch = {
  baseUrl?: string;
  /** WooCommerce store root URL — `config.siteUrl` (#975). */
  siteUrl?: string;
  shopId?: string;
  storefrontBaseUrl?: string;
  openlinkerCallbackBaseUrl?: string;
  masterCatalogConnectionId?: string;
  /**
   * PrestaShop fallback carrier id (#517). Empty string clears the key;
   * a non-empty value is coerced to a positive integer. Values that fail
   * coercion are filtered out by the Zod refine on the schema, so by the
   * time `mergeStructuredIntoConfig` sees the value it's already either
   * `""` or a valid digit-only string.
   */
  defaultCarrierId?: string;
  /**
   * WooCommerce unmanaged-stock cap — `config.inventory.unmanagedStockQuantity`
   * (#969 §7.3). Empty string clears the key (and drops an emptied `inventory`
   * object); a non-empty value is coerced to a positive integer. Sibling keys
   * under `inventory` are preserved.
   */
  unmanagedStockQuantity?: string;
  /**
   * PS-only: which InPost PS module is installed (#767/#1155). Empty string is the
   * select sentinel — clears the key from config (no locker-code read);
   * 'official_inpost' enables address2 read.
   */
  inpostPsModuleType?: 'official_inpost' | '';
  /**
   * #430 — Allegro seller defaults. The merge helper writes a fully
   * resolved object into `config.sellerDefaults` whenever `sellerDefaults`
   * is supplied; pass `null` to clear the key entirely (operator opting
   * out — rare). Partial updates are not supported here intentionally,
   * because the BE DTO requires the full nested shape on save.
   */
  sellerDefaults?: AllegroSellerDefaultsFormValues | null;
  /**
   * #759 — Subiekt bridge URL → flat `config.subiektBridgeUrl`. Empty string
   * clears the key (delete-on-empty), mirroring `storefrontBaseUrl`.
   */
  subiektBridgeUrl?: string;
  /**
   * #759 — Subiekt invoice trigger model → NESTED `config.invoicing.triggerModel`
   * (NOT a flat key — the live BE reader `getInvoiceTriggerModel` reads the
   * nested path). Empty string clears the key and drops an emptied `invoicing`
   * object; sibling `invoicing` keys are preserved. Mirrors `unmanagedStockQuantity`.
   */
  subiektTriggerModel?: string;
  /**
   * #759 — Subiekt capability toggles → whole-object `config.capabilities`
   * (`Record<string, boolean>`). An empty/undefined record drops the key.
   * Mirrors the `sellerDefaults` whole-object seam.
   */
  subiektCapabilities?: Record<string, boolean>;
  /**
   * Infakt default payment method — `config.defaultPaymentMethod` (#1303).
   * Empty string clears the key (adapter falls back to `'cash'`).
   */
  infaktPaymentMethod?: string;
  /** InPost environment → flat `config.environment` (#771). Empty string clears the key. */
  inpostEnvironment?: 'sandbox' | 'production' | '';
  /** InPost organization id → flat `config.organizationId` (#771). Empty clears. */
  inpostOrganizationId?: string;
  /**
   * InPost sender address → whole-object `config.senderAddress` (#771). The
   * merge helper writes a pruned object whenever a value is supplied (mirrors
   * the `sellerDefaults` whole-object seam); pass `null` to clear the key, and
   * an all-empty pruned object also drops the key (delete-on-empty).
   */
  inpostSenderAddress?: InpostSenderAddressFormValues | null;
};

/**
 * The patch shape `mergeStructuredIntoConfig` accepts: the host's own
 * structured keys plus any plugin-contributed field names (#1330,
 * declaration-merged into `PluginEditConnectionFields`) — those ride through
 * to the platform contribution's `applyToConfig`.
 */
export type EditConnectionStructuredPatch = StructuredConfigPatch &
  Partial<PluginEditConnectionFields>;

/**
 * Merge structured inputs into a raw config object. Preserves unknown keys so
 * operators can still drop in custom config fields via the JSON view without
 * losing them when the structured form re-serializes.
 *
 * When the edited connection's platform ships a
 * `ConnectionConfigContribution` (#1330), its `applyToConfig` runs as the
 * final pass so plugin-owned fields on the patch are assembled by the plugin,
 * with the same partial-patch semantics (untouched siblings preserved).
 */
export function mergeStructuredIntoConfig(
  base: Record<string, unknown>,
  structured: EditConnectionStructuredPatch,
  contribution?: ConnectionConfigContribution,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...base };
  if (structured.baseUrl !== undefined) {
    if (structured.baseUrl.length === 0) {
      delete next.baseUrl;
    } else {
      next.baseUrl = structured.baseUrl;
    }
  }
  if (structured.siteUrl !== undefined) {
    if (structured.siteUrl.length === 0) {
      delete next.siteUrl;
    } else {
      next.siteUrl = structured.siteUrl;
    }
  }
  if (structured.unmanagedStockQuantity !== undefined) {
    // Nested under `config.inventory` — preserve sibling inventory keys, and
    // drop the `inventory` object entirely when clearing leaves it empty.
    const inventory: Record<string, unknown> =
      typeof next.inventory === 'object' && next.inventory !== null
        ? { ...(next.inventory as Record<string, unknown>) }
        : {};
    if (structured.unmanagedStockQuantity.length === 0) {
      delete inventory.unmanagedStockQuantity;
    } else {
      // Schema's Zod refine guarantees this is a positive-integer string.
      inventory.unmanagedStockQuantity = Number.parseInt(structured.unmanagedStockQuantity, 10);
    }
    if (Object.keys(inventory).length === 0) {
      delete next.inventory;
    } else {
      next.inventory = inventory;
    }
  }
  if (structured.shopId !== undefined) {
    if (structured.shopId.length === 0) {
      delete next.shopId;
    } else {
      next.shopId = structured.shopId;
    }
  }
  if (structured.storefrontBaseUrl !== undefined) {
    if (structured.storefrontBaseUrl.length === 0) {
      delete next.storefrontBaseUrl;
    } else {
      next.storefrontBaseUrl = structured.storefrontBaseUrl;
    }
  }
  if (structured.openlinkerCallbackBaseUrl !== undefined) {
    if (structured.openlinkerCallbackBaseUrl.length === 0) {
      delete next.openlinkerCallbackBaseUrl;
    } else {
      next.openlinkerCallbackBaseUrl = structured.openlinkerCallbackBaseUrl;
    }
  }
  // Unlike baseUrl/shopId, masterCatalogConnectionId uses `""` as an explicit
  // opt-out signal (see offer-mapping-sync.service.ts:278 — `""` disables
  // barcode linking, absent key falls back to auto-resolve). So we persist the
  // value verbatim instead of deleting on empty.
  if (structured.masterCatalogConnectionId !== undefined) {
    next.masterCatalogConnectionId = structured.masterCatalogConnectionId;
  }
  if (structured.defaultCarrierId !== undefined) {
    if (structured.defaultCarrierId.length === 0) {
      delete next.defaultCarrierId;
    } else {
      // Schema's Zod refine guarantees this is a positive-integer string.
      next.defaultCarrierId = Number.parseInt(structured.defaultCarrierId, 10);
    }
  }
  if (structured.inpostPsModuleType !== undefined) {
    if (structured.inpostPsModuleType === '') {
      delete next.inpostPsModuleType;
    } else {
      next.inpostPsModuleType = structured.inpostPsModuleType;
    }
  }
  if (structured.sellerDefaults !== undefined) {
    if (structured.sellerDefaults === null) {
      delete next.sellerDefaults;
    } else {
      // Drop empty-string sub-fields so the BE DTO sees a clean shape (the
      // FE schema accepts `''` for incremental editing; the BE rejects it).
      next.sellerDefaults = pruneEmptySellerDefaults(structured.sellerDefaults);
    }
  }
  // #759 — Subiekt bridge URL: flat, delete-on-empty (mirrors storefrontBaseUrl).
  if (structured.subiektBridgeUrl !== undefined) {
    if (structured.subiektBridgeUrl.length === 0) {
      delete next.subiektBridgeUrl;
    } else {
      next.subiektBridgeUrl = structured.subiektBridgeUrl;
    }
  }
  // #759 — Subiekt invoice trigger model: NESTED under `config.invoicing`
  // (clone of the `inventory` block above). Preserve sibling invoicing keys;
  // drop the `invoicing` object entirely when clearing leaves it empty. The
  // BE reader `getInvoiceTriggerModel` reads exactly `config.invoicing.triggerModel`.
  if (structured.subiektTriggerModel !== undefined) {
    const invoicing: Record<string, unknown> =
      typeof next.invoicing === 'object' && next.invoicing !== null
        ? { ...(next.invoicing as Record<string, unknown>) }
        : {};
    if (structured.subiektTriggerModel.length === 0) {
      delete invoicing.triggerModel;
    } else {
      invoicing.triggerModel = structured.subiektTriggerModel;
    }
    if (Object.keys(invoicing).length === 0) {
      delete next.invoicing;
    } else {
      next.invoicing = invoicing;
    }
  }
  // #759 — Subiekt capability toggles: whole-object under `config.capabilities`
  // (clone of the `sellerDefaults` seam). Persist ONLY the enabled (`true`)
  // toggles and drop the key entirely when none are on, so an all-off
  // connection carries no `capabilities` blob — an explicitly-off toggle is
  // absence, not a persisted `{ key: false }` (which a presence-checking BE
  // reader could otherwise misread as enabled).
  if (structured.subiektCapabilities !== undefined) {
    const enabled = Object.fromEntries(
      Object.entries(structured.subiektCapabilities).filter(([, on]) => on === true),
    );
    if (Object.keys(enabled).length === 0) {
      delete next.capabilities;
    } else {
      next.capabilities = enabled;
    }
  }
  // InPost structured fields (#771). `inpostEnvironment`/`inpostOrganizationId`
  // are flat (delete-on-empty); `inpostSenderAddress` is a whole-object pruned
  // into `config.senderAddress` (clone of the `sellerDefaults` seam).
  if (structured.inpostEnvironment !== undefined) {
    if (structured.inpostEnvironment.length === 0) {
      delete next.environment;
    } else {
      next.environment = structured.inpostEnvironment;
    }
  }
  if (structured.inpostOrganizationId !== undefined) {
    if (structured.inpostOrganizationId.length === 0) {
      delete next.organizationId;
    } else {
      next.organizationId = structured.inpostOrganizationId;
    }
  }
  if (structured.inpostSenderAddress !== undefined) {
    if (structured.inpostSenderAddress === null) {
      delete next.senderAddress;
    } else {
      const pruned = pruneEmptyInpostSenderAddress(structured.inpostSenderAddress);
      if (Object.keys(pruned).length === 0) {
        delete next.senderAddress;
      } else {
        next.senderAddress = pruned;
      }
    }
  }
  // Infakt default payment method (#1303) — `config.defaultPaymentMethod`.
  // The form field is named `infaktPaymentMethod` to avoid colliding with a
  // future generic `paymentMethod` field on another platform.
  if (structured.infaktPaymentMethod !== undefined) {
    if (structured.infaktPaymentMethod.length === 0) {
      delete next.defaultPaymentMethod;
    } else {
      next.defaultPaymentMethod = structured.infaktPaymentMethod;
    }
  }
  // Platform-owned assembly pass (#1330): plugin field names on the patch are
  // assembled by the platform contribution with the same partial-patch
  // semantics as the host clauses above.
  return contribution ? contribution.applyToConfig(next, structured) : next;
}

function pruneEmptySellerDefaults(
  values: AllegroSellerDefaultsFormValues,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (values.location) {
    const loc: Record<string, unknown> = {};
    if (values.location.countryCode) loc.countryCode = values.location.countryCode;
    if (values.location.province) loc.province = values.location.province;
    if (values.location.city && values.location.city.length > 0) {
      loc.city = values.location.city;
    }
    if (values.location.postCode && values.location.postCode.length > 0) {
      loc.postCode = values.location.postCode;
    }
    if (Object.keys(loc).length > 0) out.location = loc;
  }
  if (values.responsibleProducerId && values.responsibleProducerId.length > 0) {
    out.responsibleProducerId = values.responsibleProducerId;
  }
  if (values.safetyInformation?.type) {
    const safety: Record<string, unknown> = { type: values.safetyInformation.type };
    if (
      values.safetyInformation.type === 'TEXT' &&
      values.safetyInformation.description &&
      values.safetyInformation.description.length > 0
    ) {
      safety.description = values.safetyInformation.description;
    } else if (
      values.safetyInformation.type === 'ATTACHMENTS' &&
      Array.isArray(values.safetyInformation.attachments) &&
      values.safetyInformation.attachments.length > 0
    ) {
      safety.attachments = values.safetyInformation.attachments;
    }
    out.safetyInformation = safety;
  }
  return out;
}

/**
 * Prune empty-string sub-fields out of the InPost sender address so the BE DTO
 * sees a clean nested shape (the FE schema accepts `''` for incremental
 * editing; the BE rejects it). Clone of `pruneEmptySellerDefaults`. The nested
 * `address` object is dropped entirely when none of its fields are set.
 */
function pruneEmptyInpostSenderAddress(
  values: InpostSenderAddressFormValues,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (values.name && values.name.length > 0) out.name = values.name;
  if (values.email && values.email.length > 0) out.email = values.email;
  if (values.phone && values.phone.length > 0) out.phone = values.phone;
  if (values.address) {
    const addr: Record<string, unknown> = {};
    if (values.address.street && values.address.street.length > 0) {
      addr.street = values.address.street;
    }
    if (values.address.buildingNumber && values.address.buildingNumber.length > 0) {
      addr.buildingNumber = values.address.buildingNumber;
    }
    if (values.address.city && values.address.city.length > 0) addr.city = values.address.city;
    if (values.address.postCode && values.address.postCode.length > 0) {
      addr.postCode = values.address.postCode;
    }
    if (values.address.countryCode && values.address.countryCode.length > 0) {
      addr.countryCode = values.address.countryCode;
    }
    if (Object.keys(addr).length > 0) out.address = addr;
  }
  return out;
}

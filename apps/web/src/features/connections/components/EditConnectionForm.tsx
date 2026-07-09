import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { Connection } from '../api/connections.types';
import { useUpdateConnectionMutation } from '../hooks/use-update-connection-mutation';
import { useProductMasterConnections } from '../hooks/use-product-master-connections';
import {
  buildEditConnectionSchema,
  mergeStructuredIntoConfig,
  toUpdateConnectionInput,
  type EditConnectionFormSubmission,
  type EditConnectionFormValues,
} from './edit-connection.schema';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { Textarea } from '../../../shared/ui/textarea';
import { useToast } from '../../../shared/ui/toast-provider';
import {
  usePlatform,
  readConfigString,
  type PluginEditConnectionFields,
} from '../../../shared/plugins';
import { POLISH_VOIVODESHIP_VALUES } from '../types/polish-voivodeship.types';
import { INVOICE_TRIGGER_MODEL_VALUES } from '../types/invoice-trigger-model.types';

interface EditConnectionFormProps {
  connection: Connection;
}

/**
 * Host-owned structured fields with an explicit merge clause in
 * `mergeStructuredIntoConfig`. Kept as a runtime array (`as const` + derived
 * union) so `syncStructuredToJson` can detect a plugin field synced with no
 * `connectionConfig` contribution to assemble it (or a contribution whose
 * `schemaShape` never declares the field) - the silent-drop misconfiguration
 * #1330 exists to prevent.
 */
const HOST_STRUCTURED_FIELDS = [
  'baseUrl',
  'siteUrl',
  'shopId',
  'storefrontBaseUrl',
  'openlinkerCallbackBaseUrl',
  'masterCatalogConnectionId',
  'defaultCarrierId',
  'unmanagedStockQuantity',
  'inpostPsModuleType',
  'subiektBridgeUrl',
  'subiektTriggerModel',
  'inpostEnvironment',
  'inpostOrganizationId',
  'infaktPaymentMethod',
] as const;

type StructuredField = (typeof HOST_STRUCTURED_FIELDS)[number];

/**
 * Field names accepted by the per-field JSON sync: the host's own structured
 * fields plus any plugin-contributed field names (#1330, declaration-merged
 * into `PluginEditConnectionFields` — e.g. KSeF's seller/payment fields).
 */
type SyncableField = StructuredField | (keyof PluginEditConnectionFields & string);

/**
 * Read the WooCommerce unmanaged-stock cap out of `config.inventory` (#969 §7.3).
 * Persisted as a number nested under `inventory`; the form keeps it as a string
 * (same shape as `defaultCarrierId`). Empty string = no override (adapter default).
 */
function readUnmanagedStockQuantity(config: Record<string, unknown>): string {
  const inventory =
    typeof config.inventory === 'object' && config.inventory !== null
      ? (config.inventory as Record<string, unknown>)
      : {};
  return typeof inventory.unmanagedStockQuantity === 'number'
    ? String(inventory.unmanagedStockQuantity)
    : '';
}

/**
 * #759 — Read the Subiekt invoice trigger model out of NESTED
 * `config.invoicing.triggerModel`. Narrows to a known
 * `INVOICE_TRIGGER_MODEL_VALUES` value; out-of-band / legacy values fall
 * through to `''` (the operator re-picks), exactly as the BE
 * `getInvoiceTriggerModel` warns-and-defaults. Clone of `readUnmanagedStockQuantity`.
 */
function readTriggerModel(
  config: Record<string, unknown>,
): NonNullable<EditConnectionFormValues['subiektTriggerModel']> {
  const invoicing =
    typeof config.invoicing === 'object' && config.invoicing !== null
      ? (config.invoicing as Record<string, unknown>)
      : {};
  const raw = invoicing.triggerModel;
  return typeof raw === 'string' && (INVOICE_TRIGGER_MODEL_VALUES as readonly string[]).includes(raw)
    ? (raw as (typeof INVOICE_TRIGGER_MODEL_VALUES)[number])
    : '';
}

/** Read the InPost environment out of `config.environment` (#771). */
function readInpostEnvironment(config: Record<string, unknown>): '' | 'sandbox' | 'production' {
  const value = config.environment;
  return value === 'sandbox' || value === 'production' ? value : '';
}

/**
 * Read the Infakt default payment method out of `config.defaultPaymentMethod`
 * (#1303). Absent keys hydrate to `'cash'` — the adapter's own fallback — so
 * the select (and the disclosure summary reading it) always reflects what
 * will actually be sent, never a blank/unset state.
 */
function readInfaktPaymentMethod(config: Record<string, unknown>): 'cash' | 'transfer' {
  return config.defaultPaymentMethod === 'transfer' ? 'transfer' : 'cash';
}

/**
 * Read the Infakt bank-account snapshot out of `config.bankAccount` (#1303
 * follow-up). `id` is a string end-to-end (matching the neutral
 * `InvoicingBankAccount.id`); a legacy numeric `id` persisted by an earlier
 * build is coerced so the select still preselects it.
 */
// Exported for unit testing the legacy-id coercion / shape-guard seam
// (#1310 review, finding 6); consumed only via the component's `defaultValues`.
export function readInfaktBankAccount(
  config: Record<string, unknown>,
): { id: string; accountNumber: string; bankName: string } | null {
  const raw = config.bankAccount;
  if (
    typeof raw !== 'object' ||
    raw === null ||
    typeof (raw as { accountNumber?: unknown }).accountNumber !== 'string' ||
    typeof (raw as { bankName?: unknown }).bankName !== 'string'
  ) {
    return null;
  }
  const id = (raw as { id?: unknown }).id;
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  return {
    id: String(id),
    accountNumber: (raw as { accountNumber: string }).accountNumber,
    bankName: (raw as { bankName: string }).bankName,
  };
}

/**
 * Read the InPost sender address out of `config.senderAddress` (#771). Returns
 * a fully-populated form shape — empty-string fields where the operator hasn't
 * filled them yet — so RHF's nested `register()` paths work without per-field
 * undefined guards. Clone of `readSellerDefaults`'s shape-guard discipline.
 */
function readInpostSenderAddress(
  config: Record<string, unknown>,
): NonNullable<EditConnectionFormValues['inpostSenderAddress']> {
  const raw =
    typeof config.senderAddress === 'object' && config.senderAddress !== null
      ? (config.senderAddress as Record<string, unknown>)
      : {};
  const address =
    typeof raw.address === 'object' && raw.address !== null
      ? (raw.address as Record<string, unknown>)
      : {};
  return {
    name: typeof raw.name === 'string' ? raw.name : '',
    email: typeof raw.email === 'string' ? raw.email : '',
    phone: typeof raw.phone === 'string' ? raw.phone : '',
    address: {
      street: typeof address.street === 'string' ? address.street : '',
      buildingNumber: typeof address.buildingNumber === 'string' ? address.buildingNumber : '',
      city: typeof address.city === 'string' ? address.city : '',
      postCode: typeof address.postCode === 'string' ? address.postCode : '',
      countryCode: typeof address.countryCode === 'string' ? address.countryCode : '',
    },
  };
}

/**
 * #759 — Read the Subiekt capability toggles out of whole-object
 * `config.capabilities`. Coerces only boolean-valued entries; a non-object
 * or non-boolean values fall through to `{}` (clone of the `readSellerDefaults`
 * shape-guard discipline).
 */
function readSubiektCapabilities(config: Record<string, unknown>): Record<string, boolean> {
  const raw =
    typeof config.capabilities === 'object' && config.capabilities !== null
      ? (config.capabilities as Record<string, unknown>)
      : {};
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'boolean') out[key] = value;
  }
  return out;
}

/**
 * Read the connection-level Allegro seller defaults out of `config` (#430).
 * Always returns a fully-populated form-shape — empty-string fields where
 * the operator hasn't filled them yet — so RHF's `register()` paths work
 * without per-field undefined guards.
 */
function readSellerDefaults(
  config: Record<string, unknown>,
): NonNullable<EditConnectionFormValues['sellerDefaults']> {
  const raw =
    typeof config.sellerDefaults === 'object' && config.sellerDefaults !== null
      ? (config.sellerDefaults as Record<string, unknown>)
      : {};
  const location =
    typeof raw.location === 'object' && raw.location !== null
      ? (raw.location as Record<string, unknown>)
      : {};
  const safety =
    typeof raw.safetyInformation === 'object' && raw.safetyInformation !== null
      ? (raw.safetyInformation as Record<string, unknown>)
      : {};
  // #445 — discriminator now matches Allegro's actual API: `TEXT` (with
  // `description`) and `ATTACHMENTS` replace the legacy `SAFETY_INFORMATION`
  // shape. Pre-#445 persisted configs may still carry `{ type: 'SAFETY_INFORMATION',
  // content }` if the data migration hasn't run yet on this environment;
  // when seen, we surface them as `TEXT` + `description` so the operator
  // can re-save them in the correct shape.
  const legacySafetyContent =
    safety.type === 'SAFETY_INFORMATION' && typeof safety.content === 'string'
      ? safety.content
      : '';
  // Edge case: a legacy `SAFETY_INFORMATION` row with empty `content` falls
  // through to `NO_SAFETY_INFORMATION` because empty content cannot be a
  // valid `TEXT` value either — the operator would have to re-enter the
  // text anyway. The dedicated migration (#445) rewrites
  // `SAFETY_INFORMATION` → `TEXT` for non-empty content rows in production.
  const safetyType: 'NO_SAFETY_INFORMATION' | 'TEXT' | 'ATTACHMENTS' =
    safety.type === 'TEXT' || (safety.type === 'SAFETY_INFORMATION' && legacySafetyContent.length > 0)
      ? 'TEXT'
      : safety.type === 'ATTACHMENTS'
        ? 'ATTACHMENTS'
        : 'NO_SAFETY_INFORMATION';
  // Narrow `province` to the FE Zod union; out-of-band values fall through
  // as '' so the operator picks again. Mirrors `safetyInformation.type`'s
  // guard above.
  const provinceRaw = typeof location.province === 'string' ? location.province : '';
  const province: NonNullable<
    NonNullable<EditConnectionFormValues['sellerDefaults']>['location']
  >['province'] = (POLISH_VOIVODESHIP_VALUES as readonly string[]).includes(provinceRaw)
    ? (provinceRaw as (typeof POLISH_VOIVODESHIP_VALUES)[number])
    : '';
  return {
    location: {
      countryCode: 'PL',
      province,
      city: typeof location.city === 'string' ? location.city : '',
      postCode: typeof location.postCode === 'string' ? location.postCode : '',
    },
    responsibleProducerId:
      typeof raw.responsibleProducerId === 'string' ? raw.responsibleProducerId : '',
    safetyInformation: {
      type: safetyType,
      description:
        typeof safety.description === 'string'
          ? safety.description
          : legacySafetyContent,
      attachments: Array.isArray(safety.attachments)
        ? (safety.attachments as Array<{ id: string }>)
        : undefined,
    },
  };
}

function isParseableJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export function EditConnectionForm({ connection }: EditConnectionFormProps): ReactElement {
  const apiClient = useApiClient();
  const updateConnection = useUpdateConnectionMutation();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [showRawJson, setShowRawJson] = useState(false);
  const plugin = usePlatform(connection.platformType);
  // #1330 — the platform's non-render structured-config half: Zod schema
  // fragment, read-side hydration, write-side assembly. Memoized on the plugin
  // reference (stable from the registry) so the RHF resolver isn't rebuilt per
  // render.
  const connectionConfig = plugin?.connectionConfig;
  const resolverSchema = useMemo(
    () => buildEditConnectionSchema(connectionConfig),
    [connectionConfig],
  );

  const form = useForm<EditConnectionFormValues, undefined, EditConnectionFormSubmission>({
    defaultValues: {
      name: connection.name,
      baseUrl: readConfigString(connection.config, 'baseUrl'),
      siteUrl: readConfigString(connection.config, 'siteUrl'),
      shopId: readConfigString(connection.config, 'shopId'),
      storefrontBaseUrl: readConfigString(connection.config, 'storefrontBaseUrl'),
      // #168 — pre-fill OL callback URL via the platform plugin when the
      // connection has none yet. Browser-context value, not server-trusted; the
      // BE doesn't derive this from request headers (host-header injection risk),
      // so the FE owns the convenience default. Operator can override for dev
      // (e.g. http://host.docker.internal:3000) by editing the field.
      openlinkerCallbackBaseUrl:
        readConfigString(connection.config, 'openlinkerCallbackBaseUrl') ||
        plugin?.getCallbackUrlDefault?.() ||
        '',
      masterCatalogConnectionId: readConfigString(connection.config, 'masterCatalogConnectionId'),
      // PS `defaultCarrierId` is persisted as a number; the form keeps it
      // as a string so the same `<Select>` primitive serves both this
      // field and the per-method mapping dropdown (#517).
      defaultCarrierId:
        typeof connection.config.defaultCarrierId === 'number'
          ? String(connection.config.defaultCarrierId)
          : '',
      // WC `inventory.unmanagedStockQuantity` is persisted as a number nested
      // under `config.inventory`; the form keeps it as a string (#969 §7.3).
      unmanagedStockQuantity: readUnmanagedStockQuantity(connection.config),
      inpostPsModuleType:
        connection.config.inpostPsModuleType === 'official_inpost' ? 'official_inpost' : '',
      configText: JSON.stringify(connection.config, null, 2),
      adapterKey: connection.adapterKey ?? '',
      sellerDefaults: readSellerDefaults(connection.config),
      // #759 — symmetric read-side hydration for the Subiekt fields, or an
      // existing connection renders empty and an unrelated save blanks the
      // persisted state (reverting the live getInvoiceTriggerModel consumer to 'manual').
      subiektBridgeUrl: readConfigString(connection.config, 'subiektBridgeUrl'),
      subiektTriggerModel: readTriggerModel(connection.config),
      subiektCapabilities: readSubiektCapabilities(connection.config),
      // InPost structured fields (#771) — read from `config.{environment,
      // organizationId,senderAddress}`. Symmetric read-side hydration so an
      // unrelated save doesn't blank the persisted InPost config.
      inpostEnvironment: readInpostEnvironment(connection.config),
      inpostOrganizationId: readConfigString(connection.config, 'organizationId'),
      inpostSenderAddress: readInpostSenderAddress(connection.config),
      // Infakt default payment method (#1303) — `config.defaultPaymentMethod`.
      infaktPaymentMethod: readInfaktPaymentMethod(connection.config),
      infaktBankAccount: readInfaktBankAccount(connection.config),
      // Plugin-owned structured fields (#1330) — the platform's contribution
      // hydrates its own field slice (e.g. KSeF seller/payment) so an
      // unrelated save doesn't blank the persisted platform config.
      ...(connectionConfig?.readConfigToForm(connection.config) ?? {}),
    },
    resolver: zodResolver(resolverSchema),
  });

  const validationMessages = Object.values(form.formState.errors).flatMap((error) =>
    error?.message ? [String(error.message)] : [],
  );

  // Structured-config dispatch (#578/#579):
  //   - A platform plugin may contribute its own structured inputs (today: PS).
  //   - Independently, marketplace-class connections (capability `OfferManager`)
  //     render the generic catalog picker.
  //   - Either / both is "structured"; otherwise the operator only sees raw JSON.
  const StructuredSection = plugin?.StructuredConfigSection;
  const ExtraSection = plugin?.ExtraConfigSection;
  const PluginCredentialsPanel = plugin?.CredentialsPanel;
  // Both marketplace offer connections and shop-publish connections resolve
  // master-catalog product data (name/description/images/price) through
  // `masterCatalogConnectionId` — `OfferBuilderService` and
  // `ProductPublishBuilderService` share the same requirement.
  const isMarketplace = connection.enabledCapabilities.includes('OfferManager');
  const needsMasterCatalog =
    isMarketplace || connection.enabledCapabilities.includes('ProductPublisher');
  const hasStructuredInputs = StructuredSection !== undefined || needsMasterCatalog;

  // Tracks whether the raw JSON currently parses. When it doesn't, we lock the
  // structured inputs so typing in them can't silently drop custom keys that
  // the user added in raw mode — the user must fix the JSON first.
  const configText = form.watch('configText');
  const configIsParseable = isParseableJson(configText);

  const { connectionsQuery, productMasterConnections } = useProductMasterConnections();
  const candidates = useMemo(
    () => productMasterConnections.filter((c) => c.id !== connection.id),
    [productMasterConnections, connection.id],
  );
  const localAutoSelectId = candidates.length === 1 ? candidates[0].id : undefined;

  const masterCatalogValue = form.watch('masterCatalogConnectionId') ?? '';
  const storedMasterRaw = connection.config.masterCatalogConnectionId;
  const hasStoredMaster = typeof storedMasterRaw === 'string';
  const isStaleMaster =
    masterCatalogValue !== '' && !candidates.some((c) => c.id === masterCatalogValue);

  // Operator-touched flag for the catalog picker. Any user-driven change to
  // `masterCatalogConnectionId` flips this to true so auto-select can skip.
  // We do NOT rely on RHF's `dirtyFields`, since RHF clears dirty when a field
  // value matches its default — the operator could legitimately pick "None"
  // (which is the default for a fresh connection) and RHF would report not-dirty.
  const operatorTouchedCatalogRef = useRef(false);

  // Keep the raw configText in sync with structured inputs so the power-user
  // JSON view always reflects the live form state, and submission goes through
  // a single JSON payload. Refuses to write when the JSON is unparseable so we
  // never discard the user's in-progress raw edits.
  function syncStructuredToJson(
    field: SyncableField,
    value: string,
    options: { markDirty?: boolean } = {},
  ): void {
    const markDirty = options.markDirty ?? true;
    if (import.meta.env.DEV && !(HOST_STRUCTURED_FIELDS as readonly string[]).includes(field)) {
      // Dev-only misconfiguration signal (#1330): a plugin section synced a
      // field that has no host merge clause and either (a) its platform ships
      // no `connectionConfig` contribution to assemble it, or (b) the
      // contribution never declares the field in its `schemaShape` (the
      // compiler-enforced key set every contributed field must appear in) -
      // either way the value would be silently dropped from the config JSON.
      if (connectionConfig === undefined) {
        console.warn(
          `[EditConnectionForm] Structured field "${field}" has no host merge clause and platform "${connection.platformType}" contributes no connectionConfig - the value will not be persisted into the config JSON.`,
        );
      } else if (!(field in connectionConfig.schemaShape)) {
        console.warn(
          `[EditConnectionForm] Structured field "${field}" has no host merge clause and is not declared in platform "${connection.platformType}"'s connectionConfig.schemaShape - the value will not be persisted into the config JSON.`,
        );
      }
    }
    if (markDirty && field === 'masterCatalogConnectionId') {
      operatorTouchedCatalogRef.current = true;
    }
    form.setValue(field, value, { shouldDirty: markDirty });
    if (!configIsParseable) return;
    const parsed = JSON.parse(form.getValues('configText')) as Record<string, unknown>;
    const merged = mergeStructuredIntoConfig(parsed, { [field]: value }, connectionConfig);
    form.setValue('configText', JSON.stringify(merged, null, 2), { shouldDirty: markDirty });
  }

  // #430 — re-serialize the entire `sellerDefaults` shape into configText
  // on every sub-field change. Treated as a single structured patch (vs.
  // the per-field syncs above) because the BE DTO requires the full nested
  // shape on save and partial-empty fields would round-trip awkwardly.
  function syncSellerDefaultsToJson(): void {
    if (!configIsParseable) return;
    const parsed = JSON.parse(form.getValues('configText')) as Record<string, unknown>;
    const merged = mergeStructuredIntoConfig(
      parsed,
      { sellerDefaults: form.getValues('sellerDefaults') },
      connectionConfig,
    );
    form.setValue('configText', JSON.stringify(merged, null, 2), { shouldDirty: true });
  }

  // #759 — re-serialize the whole `subiektCapabilities` record into configText.
  // Clone of `syncSellerDefaultsToJson`: reads CURRENT form state, takes NO
  // argument, and KEEPS the `!configIsParseable` early-return (the divergence
  // gate — toggles are rendered disabled in that state so this can't drop a flip).
  // ORDERING: the section MUST setValue('subiektCapabilities', …) BEFORE calling
  // this, or it persists the previous toggle state.
  function syncSubiektCapabilitiesToJson(): void {
    if (!configIsParseable) return;
    const parsed = JSON.parse(form.getValues('configText')) as Record<string, unknown>;
    const merged = mergeStructuredIntoConfig(
      parsed,
      { subiektCapabilities: form.getValues('subiektCapabilities') },
      connectionConfig,
    );
    form.setValue('configText', JSON.stringify(merged, null, 2), { shouldDirty: true });
  }

  // #771 — re-serialize the whole `inpostSenderAddress` object into configText.
  // Clone of `syncSellerDefaultsToJson`: reads CURRENT form state, takes NO
  // argument, and KEEPS the `!configIsParseable` early-return. The InPost
  // section MUST setValue('inpostSenderAddress.*', …) BEFORE calling this.
  function syncInpostSenderAddressToJson(): void {
    if (!configIsParseable) return;
    const parsed = JSON.parse(form.getValues('configText')) as Record<string, unknown>;
    const merged = mergeStructuredIntoConfig(
      parsed,
      { inpostSenderAddress: form.getValues('inpostSenderAddress') },
      connectionConfig,
    );
    form.setValue('configText', JSON.stringify(merged, null, 2), { shouldDirty: true });
  }

  // #1303 follow-up — re-serialize the whole `infaktBankAccount` snapshot into
  // configText. Clone of `syncInpostSenderAddressToJson`: reads CURRENT form
  // state, takes NO argument, and KEEPS the `!configIsParseable` early-return.
  // The Infakt section MUST setValue('infaktBankAccount', …) BEFORE calling this.
  function syncInfaktBankAccountToJson(): void {
    if (!configIsParseable) return;
    const parsed = JSON.parse(form.getValues('configText')) as Record<string, unknown>;
    const merged = mergeStructuredIntoConfig(parsed, {
      infaktBankAccount: form.getValues('infaktBankAccount'),
    });
    form.setValue('configText', JSON.stringify(merged, null, 2), { shouldDirty: true });
  }

  // Auto-select the sole candidate ONCE on mount, only when the server never
  // stored a value (typeof check distinguishes "unset" from an explicit `""`
  // opt-out) and the operator hasn't already touched the picker. Never marks
  // the form dirty so save-without-changes doesn't trigger a confirm-leave.
  const autoSelectFiredRef = useRef(false);
  useEffect(() => {
    if (autoSelectFiredRef.current) return;
    if (!needsMasterCatalog) return;
    if (hasStoredMaster) return;
    if (!localAutoSelectId) return;
    if (connectionsQuery.isLoading) return;
    if (connectionsQuery.error) return;
    if (operatorTouchedCatalogRef.current) return;
    if (form.getValues('masterCatalogConnectionId')) return;
    autoSelectFiredRef.current = true;
    syncStructuredToJson('masterCatalogConnectionId', localAutoSelectId, { markDirty: false });
  }, [
    localAutoSelectId,
    connectionsQuery.isLoading,
    connectionsQuery.error,
    needsMasterCatalog,
    hasStoredMaster,
  ]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const input = toUpdateConnectionInput(values);
      // A sibling plugin-owned panel (e.g. a platform's CredentialsPanel) may
      // have written its own config field independently of this form, at any
      // point after this component mounted — the raw-JSON textarea's snapshot
      // predates that write and knows nothing about it. Refetching the
      // connection right before submit and layering this form's edits on top
      // (rather than sending the load-time snapshot wholesale) means a field
      // the operator never touched survives a concurrent sibling write, while
      // anything the operator actually edited in the raw JSON still wins.
      const fresh = await apiClient.connections.getById(connection.id);
      await updateConnection.mutateAsync({
        connectionId: connection.id,
        input: { ...input, config: { ...fresh.config, ...input.config } },
      });
      showToast({
        tone: 'success',
        title: 'Connection updated',
        description: 'Connection settings have been saved.',
      });
      void navigate(`/connections/${connection.id}`);
    } catch {
      return;
    }
  });

  return (
    <form className="form-card form-narrow" onSubmit={(event) => void onSubmit(event)} noValidate>
      <div className="panel__header">
        <div>
          <p className="eyebrow">Edit connection</p>
          <h3 className="section-title">{connection.name}</h3>
        </div>
        <span className="panel__meta">Update settings</span>
      </div>

      {form.formState.submitCount > 0 && validationMessages.length > 0 ? (
        <FormErrorSummary errors={validationMessages} />
      ) : null}
      {updateConnection.error ? (
        <Alert tone="error" title="Unable to update connection">
          {updateConnection.error.message}
        </Alert>
      ) : null}

      <FormField label="Connection name" name="name" error={form.formState.errors.name?.message}>
        <Input
          {...form.register('name')}
          placeholder="Main PrestaShop Store"
          invalid={Boolean(form.formState.errors.name)}
        />
      </FormField>

      <FormField label="Platform type" name="platformType">
        <Input value={connection.platformType} disabled />
      </FormField>

      {PluginCredentialsPanel ? (
        <PluginCredentialsPanel connection={connection} />
      ) : (
        <FormField label="Credentials" name="credentials">
          <Input
            value={
              connection.credentialsBacked
                ? 'Stored securely (managed by integration)'
                : 'Environment variable (not editable via UI)'
            }
            disabled
          />
        </FormField>
      )}

      <FormField
        label="Adapter key"
        name="adapterKey"
        error={form.formState.errors.adapterKey?.message}
        description="Optional when the default adapter can be inferred from the selected platform."
      >
        <Input
          {...form.register('adapterKey')}
          placeholder="prestashop.webservice.v1"
          invalid={Boolean(form.formState.errors.adapterKey)}
        />
      </FormField>

      {hasStructuredInputs && !configIsParseable ? (
        <Alert tone="warning" title="Raw JSON is invalid">
          Fix the raw config JSON below before editing the structured inputs — they are locked so
          your custom JSON keys are not silently lost.
        </Alert>
      ) : null}

      {StructuredSection ? (
        <StructuredSection
          connection={connection}
          form={form}
          configIsParseable={configIsParseable}
          syncStructuredToJson={(field, value, options) =>
            syncStructuredToJson(field as SyncableField, value, options)
          }
          syncObjectToJson={syncSubiektCapabilitiesToJson}
          syncInpostSenderAddressToJson={syncInpostSenderAddressToJson}
          syncInfaktBankAccountToJson={syncInfaktBankAccountToJson}
        />
      ) : null}

      {needsMasterCatalog ? (
        <MarketplaceCatalogPicker
          value={masterCatalogValue}
          candidates={candidates}
          isLoading={connectionsQuery.isLoading}
          loadError={connectionsQuery.error}
          isStale={isStaleMaster}
          errorMessage={form.formState.errors.masterCatalogConnectionId?.message}
          disabled={!configIsParseable}
          onChange={(value) => syncStructuredToJson('masterCatalogConnectionId', value)}
          onRetry={() => void connectionsQuery.refetch()}
        />
      ) : null}

      {ExtraSection ? (
        <ExtraSection
          connection={connection}
          form={form}
          configIsParseable={configIsParseable}
          syncSellerDefaultsToJson={syncSellerDefaultsToJson}
        />
      ) : null}

      <div className="config-panel__toggle">
        <Button
          tone="secondary"
          type="button"
          onClick={() => setShowRawJson((prev) => !prev)}
          aria-expanded={showRawJson}
        >
          {showRawJson ? 'Hide raw config JSON' : 'Show raw config JSON'}
        </Button>
      </div>

      {showRawJson || !hasStructuredInputs ? (
        <FormField
          label="Config JSON"
          name="configText"
          error={form.formState.errors.configText?.message}
          description="Raw configuration. Edit carefully — secrets must remain outside the browser."
        >
          <Textarea
            {...form.register('configText')}
            rows={10}
            invalid={Boolean(form.formState.errors.configText)}
          />
        </FormField>
      ) : null}

      <div className="form-actions">
        <Button type="submit" disabled={updateConnection.isPending}>
          {updateConnection.isPending ? 'Saving...' : 'Save changes'}
        </Button>
        <Button tone="secondary" onClick={() => void navigate(`/connections/${connection.id}`)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

interface MarketplaceCatalogPickerProps {
  value: string;
  candidates: Connection[];
  isLoading: boolean;
  loadError: Error | null;
  isStale: boolean;
  errorMessage: string | undefined;
  disabled: boolean;
  onChange: (value: string) => void;
  onRetry: () => void;
}

function MarketplaceCatalogPicker({
  value,
  candidates,
  isLoading,
  loadError,
  isStale,
  errorMessage,
  disabled,
  onChange,
  onRetry,
}: MarketplaceCatalogPickerProps): ReactElement {
  const noCandidates = !isLoading && !loadError && candidates.length === 0 && !isStale;

  return (
    <>
      {loadError ? (
        <Alert
          tone="error"
          title="Could not load ProductMaster connections"
          action={
            <Button tone="secondary" type="button" onClick={onRetry}>
              Retry
            </Button>
          }
        >
          {loadError.message}
        </Alert>
      ) : null}

      {noCandidates ? (
        <Alert tone="info" title="No ProductMaster connections yet">
          Barcode linking needs a catalog source.{' '}
          <Link to="/connections/new?platform=prestashop">Add a PrestaShop connection</Link> to
          enable offer-to-product linking.
        </Alert>
      ) : null}

      {isStale ? (
        <Alert tone="error" title="Linked catalog is missing">
          This connection points to a deleted or disabled ProductMaster. Pick a new one below or
          clear the link.
        </Alert>
      ) : null}

      <FormField
        label="Product catalog connection"
        name="masterCatalogConnectionId"
        error={errorMessage}
        description="OpenLinker uses this ProductMaster connection to resolve offer barcodes (EAN/GTIN) to internal product variants. If left empty and exactly one ProductMaster connection exists, it is used automatically."
      >
        {isLoading ? (
          <Select disabled>
            <option>Loading connections…</option>
          </Select>
        ) : loadError ? (
          <Select disabled>
            <option>Failed to load connections</option>
          </Select>
        ) : (
          <Select
            value={value}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled}
            invalid={Boolean(errorMessage) || isStale}
          >
            <option value="">None (barcode linking disabled)</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            {isStale ? (
              <option value={value} disabled>
                Missing: {value}
              </option>
            ) : null}
          </Select>
        )}
      </FormField>
    </>
  );
}


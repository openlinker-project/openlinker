import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import type { Connection } from '../api/connections.types';
import { useUpdateConnectionMutation } from '../hooks/use-update-connection-mutation';
import { useUpdateConnectionCredentialsMutation } from '../hooks/use-update-connection-credentials-mutation';
import { useProductMasterConnections } from '../hooks/use-product-master-connections';
import {
  editConnectionSchema,
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
import { AllegroSellerDefaultsSection } from './allegro-seller-defaults-section';
import { POLISH_VOIVODESHIP_VALUES } from '../types/polish-voivodeship.types';
import { useMappingOptions } from '../../mappings/hooks/use-mapping-options';
import type { MappingOption } from '../../mappings/api/mappings.types';

interface EditConnectionFormProps {
  connection: Connection;
}

type StructuredField =
  | 'baseUrl'
  | 'shopId'
  | 'storefrontBaseUrl'
  | 'openlinkerCallbackBaseUrl'
  | 'masterCatalogConnectionId'
  | 'defaultCarrierId';

/**
 * Mirror of the dropdown decoration in `MappingPanel` (#517). Native
 * `<option>` is text-only so the dynamic-kind cue is encoded as a label
 * suffix; static options stay bare. Kept inline here (rather than
 * imported from `features/mappings`) to keep the cross-feature surface
 * narrow — only the `MappingOption` type is shared.
 */
function carrierOptionLabel(option: MappingOption): string {
  return option.kind === 'dynamic'
    ? `${option.label} — exact Allegro cost`
    : option.label;
}

type PlatformBranch = 'prestashop' | 'marketplace' | 'raw';

function readString(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === 'string' ? value : '';
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
  const updateConnection = useUpdateConnectionMutation();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [showRawJson, setShowRawJson] = useState(false);

  const form = useForm<EditConnectionFormValues, undefined, EditConnectionFormSubmission>({
    defaultValues: {
      name: connection.name,
      baseUrl: readString(connection.config, 'baseUrl'),
      shopId: readString(connection.config, 'shopId'),
      storefrontBaseUrl: readString(connection.config, 'storefrontBaseUrl'),
      // #168 — pre-fill OL callback URL from window.location.origin when the
      // connection has none yet. Browser-context value, not server-trusted; the
      // BE doesn't derive this from request headers (host-header injection risk),
      // so the FE owns the convenience default. Operator can override for dev
      // (e.g. http://host.docker.internal:3000) by editing the field.
      openlinkerCallbackBaseUrl:
        readString(connection.config, 'openlinkerCallbackBaseUrl') ||
        (typeof window !== 'undefined' && connection.platformType === 'prestashop'
          ? window.location.origin
          : ''),
      masterCatalogConnectionId: readString(connection.config, 'masterCatalogConnectionId'),
      // PS `defaultCarrierId` is persisted as a number; the form keeps it
      // as a string so the same `<Select>` primitive serves both this
      // field and the per-method mapping dropdown (#517).
      defaultCarrierId:
        typeof connection.config.defaultCarrierId === 'number'
          ? String(connection.config.defaultCarrierId)
          : '',
      configText: JSON.stringify(connection.config, null, 2),
      adapterKey: connection.adapterKey ?? '',
      sellerDefaults: readSellerDefaults(connection.config),
    },
    resolver: zodResolver(editConnectionSchema),
  });

  const validationMessages = Object.values(form.formState.errors).flatMap((error) =>
    error?.message ? [String(error.message)] : [],
  );

  const platformBranch: PlatformBranch =
    connection.platformType === 'prestashop'
      ? 'prestashop'
      : connection.enabledCapabilities.includes('OfferManager')
        ? 'marketplace'
        : 'raw';
  const hasStructuredInputs = platformBranch !== 'raw';

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
    field: StructuredField,
    value: string,
    options: { markDirty?: boolean } = {},
  ): void {
    const markDirty = options.markDirty ?? true;
    if (markDirty && field === 'masterCatalogConnectionId') {
      operatorTouchedCatalogRef.current = true;
    }
    form.setValue(field, value, { shouldDirty: markDirty });
    if (!configIsParseable) return;
    const parsed = JSON.parse(form.getValues('configText')) as Record<string, unknown>;
    const merged = mergeStructuredIntoConfig(parsed, { [field]: value });
    form.setValue('configText', JSON.stringify(merged, null, 2), { shouldDirty: markDirty });
  }

  // #430 — re-serialize the entire `sellerDefaults` shape into configText
  // on every sub-field change. Treated as a single structured patch (vs.
  // the per-field syncs above) because the BE DTO requires the full nested
  // shape on save and partial-empty fields would round-trip awkwardly.
  function syncSellerDefaultsToJson(): void {
    if (!configIsParseable) return;
    const parsed = JSON.parse(form.getValues('configText')) as Record<string, unknown>;
    const merged = mergeStructuredIntoConfig(parsed, {
      sellerDefaults: form.getValues('sellerDefaults'),
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
    if (platformBranch !== 'marketplace') return;
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
    platformBranch,
    hasStoredMaster,
  ]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await updateConnection.mutateAsync({
        connectionId: connection.id,
        input: toUpdateConnectionInput(values),
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

      <CredentialsPanel connection={connection} />

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

      {platformBranch === 'prestashop' ? (
        <>
          <FormField
            label="Shop URL"
            name="baseUrl"
            error={form.formState.errors.baseUrl?.message}
            description="The public URL of the PrestaShop storefront."
          >
            <Input
              value={form.watch('baseUrl') ?? ''}
              onChange={(event) => syncStructuredToJson('baseUrl', event.target.value)}
              placeholder="https://shop.example.com"
              disabled={!configIsParseable}
              invalid={Boolean(form.formState.errors.baseUrl)}
            />
          </FormField>

          <FormField
            label="Storefront URL (optional)"
            name="storefrontBaseUrl"
            error={form.formState.errors.storefrontBaseUrl?.message}
            description="Override only if your public storefront URL is different from the webservice URL. Leave blank if they're the same — defaults to Shop URL."
          >
            <Input
              value={form.watch('storefrontBaseUrl') ?? ''}
              onChange={(event) => syncStructuredToJson('storefrontBaseUrl', event.target.value)}
              placeholder="https://shop.example.com"
              disabled={!configIsParseable}
              invalid={Boolean(form.formState.errors.storefrontBaseUrl)}
            />
          </FormField>

          <FormField
            label="Shop ID (optional)"
            name="shopId"
            error={form.formState.errors.shopId?.message}
            description="Only needed for multi-shop PrestaShop installations."
          >
            <Input
              value={form.watch('shopId') ?? ''}
              onChange={(event) => syncStructuredToJson('shopId', event.target.value)}
              placeholder="1"
              disabled={!configIsParseable}
              invalid={Boolean(form.formState.errors.shopId)}
            />
          </FormField>

          <FormField
            label="OL callback URL"
            name="openlinkerCallbackBaseUrl"
            error={form.formState.errors.openlinkerCallbackBaseUrl?.message}
            description="OpenLinker's URL from PrestaShop's perspective — used by the PS module to POST webhooks back to OL. Pre-filled from your browser; override for Docker dev (e.g. http://host.docker.internal:3000) or unusual deploys. Required to use the 'Configure webhooks' action."
          >
            <Input
              value={form.watch('openlinkerCallbackBaseUrl') ?? ''}
              onChange={(event) =>
                syncStructuredToJson('openlinkerCallbackBaseUrl', event.target.value)
              }
              placeholder="https://api.openlinker.example"
              disabled={!configIsParseable}
              invalid={Boolean(form.formState.errors.openlinkerCallbackBaseUrl)}
            />
          </FormField>

          <PrestashopFallbackCarrierField
            connectionId={connection.id}
            value={form.watch('defaultCarrierId') ?? ''}
            errorMessage={form.formState.errors.defaultCarrierId?.message}
            disabled={!configIsParseable}
            onChange={(value) => syncStructuredToJson('defaultCarrierId', value)}
          />
        </>
      ) : null}

      {platformBranch === 'marketplace' ? (
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

      {connection.platformType === 'allegro' ? (
        <AllegroSellerDefaultsSection
          connectionId={connection.id}
          form={form}
          onChange={syncSellerDefaultsToJson}
          disabled={!configIsParseable}
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

interface PrestashopFallbackCarrierFieldProps {
  connectionId: string;
  value: string;
  errorMessage: string | undefined;
  disabled: boolean;
  onChange: (value: string) => void;
}

/**
 * Fallback-carrier picker for PrestaShop connections (#517).
 *
 * Backed by the same `getMappingOptions(connectionId, 'destination', 'carriers')`
 * endpoint as the per-method mapping page, so the option set (and its
 * dynamic-kind decoration) stays in lockstep. The field is allowed to
 * stay blank: when unset, the BE adapter (#516) falls back to the
 * OpenLinker Dynamic carrier at order-create time. A save-time warning
 * banner fires only when (a) the field is blank, (b) the OL Dynamic
 * carrier is NOT among the loaded options (operator hasn't installed
 * the OL PS module on this connection) — i.e. the connection is in a
 * state where any unmapped Allegro shipping method WILL fail at sync.
 *
 * No soft-prefill: per tech-review on #517, picking the OL Dynamic
 * carrier as a phantom default would write a value the operator didn't
 * choose. The runtime fallback chain handles the unset case, and the
 * help text + warning banner make the consequence explicit.
 */
function PrestashopFallbackCarrierField({
  connectionId,
  value,
  errorMessage,
  disabled,
  onChange,
}: PrestashopFallbackCarrierFieldProps): ReactElement {
  const { options, isLoading, errors } = useMappingOptions(connectionId);
  const carriersError = errors.prestashopCarriers ?? null;
  const carriers = options.prestashopCarriers;
  const hasDynamicOption = carriers.some((c) => c.kind === 'dynamic');
  const showNoFallbackWarning = value === '' && carriersError === null && !isLoading && !hasDynamicOption;

  return (
    <>
      <FormField
        label="Fallback carrier (optional)"
        name="defaultCarrierId"
        error={errorMessage}
        description="Used when an Allegro shipping method has no carrier mapping. Leave unset to use the OpenLinker Dynamic carrier (exact Allegro shipping cost) at sync time — works only when the OL PrestaShop module is installed."
      >
        {isLoading ? (
          <Select disabled>
            <option>Loading carriers…</option>
          </Select>
        ) : carriersError ? (
          <Select disabled>
            <option>Failed to load carriers</option>
          </Select>
        ) : (
          <Select
            value={value}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled}
            invalid={Boolean(errorMessage)}
          >
            <option value="">None — use OpenLinker Dynamic at runtime</option>
            {carriers.map((c) => (
              <option key={c.value} value={c.value}>
                {carrierOptionLabel(c)}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      {showNoFallbackWarning ? (
        <Alert tone="warning" className="edit-connection__fallback-warning">
          No fallback carrier is set and the OpenLinker PrestaShop module isn't
          installed on this connection. Sync will fail for any Allegro shipping
          method without a carrier mapping until you pick a fallback or install
          the OL PS module.
        </Alert>
      ) : null}
    </>
  );
}

function CredentialsPanel({ connection }: { connection: Connection }): ReactElement {
  const [showRotate, setShowRotate] = useState(false);
  const [newKey, setNewKey] = useState('');
  const rotate = useUpdateConnectionCredentialsMutation();
  const { showToast } = useToast();

  if (!connection.credentialsBacked) {
    return (
      <FormField label="Credentials" name="credentials">
        <Input value="Environment variable (not editable via UI)" disabled />
      </FormField>
    );
  }

  if (connection.platformType !== 'prestashop') {
    return (
      <FormField label="Credentials" name="credentials">
        <Input value="Stored securely (managed by integration)" disabled />
      </FormField>
    );
  }

  const onRotate = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (newKey.trim().length === 0) return;
    try {
      await rotate.mutateAsync({
        connectionId: connection.id,
        credentials: { webserviceApiKey: newKey.trim() },
      });
      showToast({
        tone: 'success',
        title: 'Credentials rotated',
        description: 'The new webservice key is now in use.',
      });
      setNewKey('');
      setShowRotate(false);
    } catch {
      // surfaced via rotate.error
    }
  };

  return (
    <FormField
      label="Webservice key"
      name="credentials"
      description="Stored securely on the server. Rotate to replace the key without restarting the API."
    >
      {showRotate ? (
        <div className="form-grid">
          {rotate.error ? <Alert tone="error">{rotate.error.message}</Alert> : null}
          <Input
            type="password"
            autoComplete="off"
            placeholder="New webservice key"
            value={newKey}
            onChange={(event) => setNewKey(event.target.value)}
          />
          <div className="form-actions">
            <Button
              type="button"
              onClick={(event) => void onRotate(event)}
              disabled={rotate.isPending || newKey.trim().length === 0}
            >
              {rotate.isPending ? 'Rotating...' : 'Save new key'}
            </Button>
            <Button
              tone="secondary"
              type="button"
              onClick={() => {
                setShowRotate(false);
                setNewKey('');
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button tone="secondary" type="button" onClick={() => setShowRotate(true)}>
          Rotate webservice key
        </Button>
      )}
    </FormField>
  );
}

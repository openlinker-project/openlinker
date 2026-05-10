/**
 * PrestaShop Setup Form
 *
 * Multi-step wizard for creating a PrestaShop connection. Steps:
 *   1. Credentials — shop URL, webservice key, optional shop ID
 *   2. Verify credentials — human review of entered values (the API-side
 *      `/test` endpoint requires a saved connection, so this step is a
 *      pre-save checkpoint, not a live probe)
 *   3. Capabilities — which roles this connection will fulfil
 *   4. Review & connect — final summary before submit
 *
 * Per-step validation runs on Next so the operator cannot advance with
 * invalid fields. Abandon-prevention triggers a native confirm dialog
 * when the form is dirty and the tab is closed.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type Path } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useCreateConnectionMutation } from '../hooks/use-create-connection-mutation';
import {
  PRESTASHOP_ADAPTER_KEY,
  PRESTASHOP_FALLBACK_CAPABILITIES,
  PRESTASHOP_SETUP_DEFAULT_VALUES,
  prestashopSetupSchema,
  toCreateConnectionInput,
  type PrestashopSetupFormSubmission,
  type PrestashopSetupFormValues,
} from './prestashop-setup.schema';
import { PrestashopSetupSummary } from './prestashop-setup-summary';
import { CORE_CAPABILITY_VALUES, type CoreCapability } from '../api/connections.types';
import { useAdaptersQuery } from '../../adapters/hooks/use-adapters-query';
import { Alert } from '../../../shared/ui/alert';
import { BackLink } from '../../../shared/ui/back-link';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { SetupStepper } from '../../../shared/ui/setup-stepper';
import { WizardLayout } from '../../../shared/ui/wizard-layout';
import { useToast } from '../../../shared/ui/toast-provider';

const CAPABILITY_HELP: Record<CoreCapability, string> = {
  ProductMaster: 'Read the product catalog (variants, attributes, categories) from this shop.',
  InventoryMaster: 'Read stock levels from this shop as the inventory source of truth.',
  OrderProcessorManager: 'Create and manage orders in this shop (typically the order destination).',
  OrderSource:
    'Fetch new orders from this shop (disable if orders come from a marketplace instead).',
  OfferManager: 'Manage offers and listings on this marketplace.',
};

// "Verify credentials" rather than "Test connection": the PrestaShop `/test`
// endpoint is only reachable after the connection is saved, so this step is a
// human-review of the entered URL + masked key, not a live probe.
const STEP_LABELS = [
  'Credentials',
  'Verify credentials',
  'Capabilities',
  'Review & connect',
] as const;

const STEP_FIELDS: ReadonlyArray<ReadonlyArray<Path<PrestashopSetupFormValues>>> = [
  ['name', 'baseUrl', 'webserviceKey', 'shopId', 'storefrontBaseUrl', 'currency'],
  [],
  ['enabledCapabilities'],
  [],
];

function maskKey(key: string): string {
  if (key.length <= 4) return '•'.repeat(key.length);
  return `${'•'.repeat(Math.max(0, key.length - 4))}${key.slice(-4)}`;
}

export function PrestashopSetupForm(): ReactElement {
  const createConnection = useCreateConnectionMutation();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const adaptersQuery = useAdaptersQuery();
  const form = useForm<PrestashopSetupFormValues, undefined, PrestashopSetupFormSubmission>({
    defaultValues: PRESTASHOP_SETUP_DEFAULT_VALUES,
    resolver: zodResolver(prestashopSetupSchema),
    mode: 'onBlur',
  });

  const [stepIndex, setStepIndex] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<ReadonlySet<number>>(new Set());

  // Abandon-prevention: warn the operator if they close the tab with unsaved
  // progress. We intentionally skip this for the final redirect since the
  // mutation flow clears the dirty flag via reset.
  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent): void {
      if (!form.formState.isDirty) return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [form.formState.isDirty]);

  const adapterMetadata = adaptersQuery.data?.find((a) => a.adapterKey === PRESTASHOP_ADAPTER_KEY);
  // The form's checkbox list is gated on the well-known core capabilities. Plugin
  // adapters (#576) may register additional names, but the create-connection
  // request DTO is still strict on `CoreCapabilityValues`, so the wizard only
  // exposes core caps for editing today. Lift the narrow when the runtime-aware
  // DTO validator follow-up lands.
  const supportedCapabilities: CoreCapability[] = (
    adapterMetadata?.supportedCapabilities ?? PRESTASHOP_FALLBACK_CAPABILITIES
  ).filter((capability): capability is CoreCapability =>
    (CORE_CAPABILITY_VALUES as readonly string[]).includes(capability),
  );

  const validationMessages = Object.values(form.formState.errors).flatMap((error) =>
    error?.message ? [String(error.message)] : []
  );

  async function goNext(): Promise<void> {
    const fields = STEP_FIELDS[stepIndex];
    if (fields.length > 0) {
      const valid = await form.trigger([...fields]);
      if (!valid) return;
    }
    setCompletedSteps((prev) => new Set(prev).add(stepIndex));
    setStepIndex((i) => Math.min(i + 1, STEP_LABELS.length - 1));
  }

  function goBack(): void {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const created = await createConnection.mutateAsync(toCreateConnectionInput(values));
      form.reset(values, { keepValues: true, keepDirty: false });
      showToast({
        tone: 'success',
        title: 'Connection created',
        description: `PrestaShop connection "${created.name}" was created.`,
      });
      void navigate('/connections');
    } catch {
      return;
    }
  });

  const values = form.watch();

  return (
    <WizardLayout
      stepper={
        <SetupStepper steps={STEP_LABELS} currentStep={stepIndex} completedSteps={completedSteps} />
      }
      summary={<PrestashopSetupSummary values={values} stepIndex={stepIndex} />}
    >
      <form className="wizard-card" onSubmit={(event) => void onSubmit(event)} noValidate>
        <BackLink to="/connections/new" label="Connections" className="wizard-card__back" />

        {form.formState.submitCount > 0 && validationMessages.length > 0 ? (
          <FormErrorSummary errors={validationMessages} />
        ) : null}
        {createConnection.error ? (
          <Alert tone="error" title="Unable to create connection">
            {createConnection.error.message}
          </Alert>
        ) : null}

        {stepIndex === 0 ? (
          <>
            <Alert tone="info" title="Before you start">
              In your PrestaShop admin, enable Webservice under{' '}
              <strong>Advanced Parameters → Webservice</strong> and generate a key with the required
              resources enabled.
            </Alert>

            <FormField
              label="Connection name"
              name="name"
              error={form.formState.errors.name?.message}
            >
              <Input
                {...form.register('name')}
                placeholder="Main PrestaShop Store"
                invalid={Boolean(form.formState.errors.name)}
              />
            </FormField>

            <FormField
              label="Shop URL"
              name="baseUrl"
              error={form.formState.errors.baseUrl?.message}
              description="The public URL of the PrestaShop storefront (no trailing path)."
            >
              <Input
                {...form.register('baseUrl')}
                className="mono-text"
                placeholder="https://shop.example.com"
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
                {...form.register('storefrontBaseUrl')}
                className="mono-text"
                placeholder="https://shop.example.com"
                invalid={Boolean(form.formState.errors.storefrontBaseUrl)}
              />
            </FormField>

            <FormField
              label="Webservice key"
              name="webserviceKey"
              error={form.formState.errors.webserviceKey?.message}
              description="Generated in PrestaShop admin under Advanced Parameters → Webservice."
            >
              <Input
                {...form.register('webserviceKey')}
                className="mono-text"
                type="password"
                autoComplete="off"
                placeholder="e.g. ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"
                invalid={Boolean(form.formState.errors.webserviceKey)}
              />
            </FormField>

            <FormField
              label="Shop ID (optional)"
              name="shopId"
              error={form.formState.errors.shopId?.message}
              description="Only needed for multi-shop PrestaShop installations."
            >
              <Input
                {...form.register('shopId')}
                className="mono-text"
                placeholder="1"
                invalid={Boolean(form.formState.errors.shopId)}
              />
            </FormField>

            <FormField
              label="Default currency (optional)"
              name="currency"
              error={form.formState.errors.currency?.message}
              description="ISO 4217 code applied to every product synced from this connection. Leave blank to persist currency as unknown."
            >
              <Select
                {...form.register('currency')}
                invalid={Boolean(form.formState.errors.currency)}
              >
                <option value="">— not set —</option>
                <option value="PLN">PLN — Polish Złoty</option>
                <option value="EUR">EUR — Euro</option>
                <option value="USD">USD — US Dollar</option>
                <option value="GBP">GBP — British Pound</option>
                <option value="CZK">CZK — Czech Koruna</option>
                <option value="HUF">HUF — Hungarian Forint</option>
                <option value="RON">RON — Romanian Leu</option>
                <option value="SEK">SEK — Swedish Krona</option>
                <option value="NOK">NOK — Norwegian Krone</option>
                <option value="DKK">DKK — Danish Krone</option>
                <option value="CHF">CHF — Swiss Franc</option>
              </Select>
            </FormField>
          </>
        ) : null}

        {stepIndex === 1 ? (
          <div className="wizard-test-result">
            <Alert tone="info" title="Verify the credentials">
              OpenLinker will use the values below to reach your PrestaShop admin. Make sure the
              shop URL resolves and the webservice key is active before you continue. After the
              connection is saved you can run a live test from the connection detail page.
            </Alert>
            <dl className="wizard-review-list">
              <dt>Shop URL</dt>
              <dd className="mono-text">{values.baseUrl || '—'}</dd>
              {values.storefrontBaseUrl ? (
                <>
                  <dt>Storefront URL</dt>
                  <dd className="mono-text">{values.storefrontBaseUrl}</dd>
                </>
              ) : null}
              <dt>Webservice key</dt>
              <dd className="mono-text">
                {values.webserviceKey ? maskKey(values.webserviceKey) : '—'}
              </dd>
              {values.shopId ? (
                <>
                  <dt>Shop ID</dt>
                  <dd className="mono-text">{values.shopId}</dd>
                </>
              ) : null}
              {values.currency ? (
                <>
                  <dt>Default currency</dt>
                  <dd className="mono-text">{values.currency}</dd>
                </>
              ) : null}
            </dl>
          </div>
        ) : null}

        {stepIndex === 2 ? (
          <fieldset className="capability-fieldset">
            <legend className="capability-fieldset__legend">Capabilities</legend>
            <p className="muted-text capability-fieldset__help">
              Pick which roles this connection should fulfil. You can change this later on the
              connection&rsquo;s detail page.
            </p>
            <ul className="capability-list">
              {supportedCapabilities.map((capability) => {
                const id = `new-cap-${capability}`;
                return (
                  <li key={capability} className="capability-list__item">
                    <label htmlFor={id} className="capability-list__label">
                      <input
                        id={id}
                        type="checkbox"
                        value={capability}
                        {...form.register('enabledCapabilities')}
                      />
                      <span className="capability-list__name mono-text">{capability}</span>
                    </label>
                    <p className="capability-list__help muted-text">
                      {CAPABILITY_HELP[capability]}
                    </p>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ) : null}

        {stepIndex === 3 ? (
          <dl className="wizard-review-list">
            <dt>Name</dt>
            <dd>{values.name || '—'}</dd>
            <dt>Shop URL</dt>
            <dd className="mono-text">{values.baseUrl || '—'}</dd>
            {values.storefrontBaseUrl ? (
              <>
                <dt>Storefront URL</dt>
                <dd className="mono-text">{values.storefrontBaseUrl}</dd>
              </>
            ) : null}
            <dt>Webservice key</dt>
            <dd className="mono-text">
              {values.webserviceKey ? maskKey(values.webserviceKey) : '—'}
            </dd>
            {values.shopId ? (
              <>
                <dt>Shop ID</dt>
                <dd className="mono-text">{values.shopId}</dd>
              </>
            ) : null}
            {values.currency ? (
              <>
                <dt>Default currency</dt>
                <dd className="mono-text">{values.currency}</dd>
              </>
            ) : null}
            <dt>Capabilities</dt>
            <dd>
              {(values.enabledCapabilities ?? []).length > 0
                ? (values.enabledCapabilities ?? []).join(', ')
                : 'None selected'}
            </dd>
          </dl>
        ) : null}

        <div className="wizard-actions">
          <div className="wizard-actions__group">
            {stepIndex > 0 ? (
              <Button tone="secondary" type="button" onClick={goBack}>
                Back
              </Button>
            ) : null}
          </div>
          <div className="wizard-actions__group">
            {stepIndex < STEP_LABELS.length - 1 ? (
              <Button type="button" onClick={() => void goNext()}>
                Next
              </Button>
            ) : (
              <Button type="submit" disabled={createConnection.isPending}>
                {createConnection.isPending ? 'Creating...' : 'Create connection'}
              </Button>
            )}
          </div>
        </div>
      </form>
    </WizardLayout>
  );
}

/**
 * Shoper Setup Form
 *
 * Multi-step wizard for creating a Shoper connection, the same shape as the
 * PrestaShop and WooCommerce wizards. Steps:
 *   1. Shop - connection name and the shop host (`baseUrl`)
 *   2. API token - the only credential
 *   3. Capabilities - which roles this connection will fulfil
 *   4. Review & create - final summary before submit
 *
 * Per-step validation runs on Next. After a successful create the wizard stays
 * on a "connection created" screen: a "Test connection" affordance (the generic
 * `/connections/:id/test` endpoint) and, when the shop will receive orders, a
 * pointer to the order defaults. Those cannot be asked here, because the lists
 * of the shop's delivery, payment and status options are read from the shop and
 * need the saved connection and its token.
 *
 * @module features/connections/components
 */
import { useEffect, useState, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type Path } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { useAdaptersQuery } from '../../adapters';
import { captureDemoEvent } from '../../demo';
import { useCreateConnectionMutation } from '../hooks/use-create-connection-mutation';
import { useTestConnectionMutation } from '../hooks/use-test-connection-mutation';
import {
  CORE_CAPABILITY_VALUES,
  type ConnectionTestResult,
  type CoreCapability,
} from '../api/connections.types';
import { CAPABILITY_HELP } from '../lib/capability-metadata';
import {
  SHOPER_ADAPTER_KEY,
  SHOPER_FALLBACK_CAPABILITIES,
  SHOPER_SETUP_DEFAULT_VALUES,
  shoperSetupSchema,
  toCreateConnectionInput,
  type ShoperSetupFormSubmission,
  type ShoperSetupFormValues,
} from './shoper-setup.schema';
import { Alert } from '../../../shared/ui/alert';
import { BackLink } from '../../../shared/ui/back-link';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { SetupStepper } from '../../../shared/ui/setup-stepper';
import { useToast } from '../../../shared/ui/toast-provider';
import { WizardLayout } from '../../../shared/ui/wizard-layout';

const STEP_LABELS = ['Shop', 'API token', 'Capabilities', 'Review & create'] as const;

const STEP_FIELDS: ReadonlyArray<ReadonlyArray<Path<ShoperSetupFormValues>>> = [
  ['name', 'baseUrl'],
  ['token'],
  ['enabledCapabilities'],
  [],
];

function maskToken(token: string): string {
  if (token.length <= 4) return '•'.repeat(token.length);
  return `${'•'.repeat(Math.max(0, token.length - 4))}${token.slice(-4)}`;
}

export function ShoperSetupForm(): ReactElement {
  const createConnection = useCreateConnectionMutation();
  const testConnection = useTestConnectionMutation();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const adaptersQuery = useAdaptersQuery();
  const [stepIndex, setStepIndex] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<ReadonlySet<number>>(new Set());
  const [createdConnectionId, setCreatedConnectionId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  const form = useForm<ShoperSetupFormValues, undefined, ShoperSetupFormSubmission>({
    defaultValues: SHOPER_SETUP_DEFAULT_VALUES,
    resolver: zodResolver(shoperSetupSchema),
    mode: 'onBlur',
  });

  // Abandon-prevention.
  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent): void {
      if (!form.formState.isDirty || createdConnectionId !== null) return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [form.formState.isDirty, createdConnectionId]);

  const adapterMetadata = adaptersQuery.data?.find((a) => a.adapterKey === SHOPER_ADAPTER_KEY);
  // The checkbox list is gated on the well-known core capabilities: the
  // create-connection request DTO is still strict on `CoreCapabilityValues` (#576).
  const supportedCapabilities: CoreCapability[] = (
    adapterMetadata?.supportedCapabilities ?? SHOPER_FALLBACK_CAPABILITIES
  ).filter((capability): capability is CoreCapability =>
    (CORE_CAPABILITY_VALUES as readonly string[]).includes(capability),
  );

  const validationMessages = Object.values(form.formState.errors).flatMap((error) =>
    error?.message ? [String(error.message)] : [],
  );

  async function goNext(): Promise<void> {
    const fields = STEP_FIELDS[stepIndex];
    if (fields.length > 0) {
      const valid = await form.trigger([...fields]);
      if (!valid) return;
    }
    setCompletedSteps((prev) => new Set(prev).add(stepIndex));
    captureDemoEvent('demo_connection_wizard_step_advanced', {
      platform: 'shoper',
      step: STEP_LABELS[stepIndex],
    });
    setStepIndex((i) => Math.min(i + 1, STEP_LABELS.length - 1));
  }

  function goBack(): void {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const created = await createConnection.mutateAsync(toCreateConnectionInput(values));
      form.reset(values, { keepValues: true, keepDirty: false });
      setCreatedConnectionId(created.id);
      showToast({
        tone: 'success',
        title: 'Connection created',
        description: `Shoper connection "${created.name}" was created.`,
      });
    } catch {
      return;
    }
  });

  const onTest = async (): Promise<void> => {
    if (!createdConnectionId) return;
    // Clear any prior result first so a re-test that rejects cannot render a
    // stale result beside the "unable to test" error.
    setTestResult(null);
    try {
      const result = await testConnection.mutateAsync(createdConnectionId);
      setTestResult(result);
    } catch {
      // surfaced via testConnection.error
    }
  };

  const values = form.watch();
  const selectedCapabilities = values.enabledCapabilities ?? [];

  if (createdConnectionId) {
    return (
      <WizardLayout
        stepper={
          <SetupStepper
            steps={STEP_LABELS}
            currentStep={STEP_LABELS.length - 1}
            completedSteps={new Set(STEP_LABELS.map((_, index) => index))}
          />
        }
      >
        <div className="wizard-card">
          <Alert tone="success" title="Connection created">
            Test the connection to confirm the shop accepts the token.
          </Alert>
          {selectedCapabilities.includes('OrderProcessorManager') ? (
            <Alert tone="info" title="One more step to receive orders">
              Shoper needs a default delivery method, payment method and order status to create an
              order. Pick them from the shop&rsquo;s own lists in{' '}
              <Link className="link" to={`/connections/${createdConnectionId}/edit`}>
                the connection settings
              </Link>
              .
            </Alert>
          ) : null}
          {testResult ? (
            <Alert
              tone={testResult.success ? 'success' : 'error'}
              title={testResult.success ? 'Connection test passed' : 'Connection test failed'}
            >
              {testResult.message}
              {typeof testResult.latencyMs === 'number' ? ` (${testResult.latencyMs}ms)` : null}
            </Alert>
          ) : null}
          {testConnection.error ? (
            <Alert tone="error" title="Unable to test connection">
              {testConnection.error.message}
            </Alert>
          ) : null}
          <div className="form-actions">
            <Button type="button" onClick={() => void onTest()} disabled={testConnection.isPending}>
              {testConnection.isPending ? 'Testing…' : 'Test connection'}
            </Button>
            <Button tone="secondary" type="button" onClick={() => void navigate('/connections')}>
              Done
            </Button>
          </div>
        </div>
      </WizardLayout>
    );
  }

  return (
    <WizardLayout
      stepper={
        <SetupStepper steps={STEP_LABELS} currentStep={stepIndex} completedSteps={completedSteps} />
      }
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
            <FormField
              label="Connection name"
              name="name"
              error={form.formState.errors.name?.message}
              description="A label to identify this Shoper shop in OpenLinker."
            >
              <Input
                {...form.register('name')}
                placeholder="My Shoper Store"
                autoComplete="off"
                invalid={Boolean(form.formState.errors.name)}
              />
            </FormField>

            <FormField
              label="Shop address"
              name="baseUrl"
              error={form.formState.errors.baseUrl?.message}
              description="Your shop's host name, e.g. xxxxx.shoparena.pl. HTTPS only, no path."
            >
              <Input
                {...form.register('baseUrl')}
                placeholder="xxxxx.shoparena.pl"
                autoComplete="off"
                invalid={Boolean(form.formState.errors.baseUrl)}
              />
            </FormField>
          </>
        ) : null}

        {stepIndex === 1 ? (
          <>
            <Alert tone="info" title="Before you start">
              In your Shoper admin panel open <strong>Dodaj integrację</strong> and create an
              integration. Shoper issues a <strong>Token API</strong>; OpenLinker sends it as a
              bearer token on every request. Grant the integration access to: produkty, warianty
              produktów, stany dostępności, kategorie, stawki vat, magazyny, zamówienia, przesyłki,
              statusy zamówień, klienci, webhooki, dostawy and płatności.
            </Alert>

            <FormField
              label="API token"
              name="token"
              error={form.formState.errors.token?.message}
              description="The Token API issued by the Shoper admin panel. Stored securely on the server."
            >
              <Input
                {...form.register('token')}
                type="password"
                placeholder="••••••••••••••••••••••••••••••••"
                autoComplete="off"
                invalid={Boolean(form.formState.errors.token)}
              />
            </FormField>
          </>
        ) : null}

        {stepIndex === 2 ? (
          <fieldset className="capability-fieldset">
            <legend className="capability-fieldset__legend">Capabilities</legend>
            <p className="muted-text capability-fieldset__help">
              Pick which roles this connection should fulfil. You can change this later on the
              connection&rsquo;s detail page. Receiving and ingesting orders are off by default
              because they start creating or reading orders in the shop.
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
          <>
            <dl className="wizard-review-list">
              <dt>Name</dt>
              <dd>{values.name || '—'}</dd>
              <dt>Shop address</dt>
              <dd className="mono-text">{values.baseUrl || '—'}</dd>
              <dt>API token</dt>
              <dd className="mono-text">{values.token ? maskToken(values.token) : '—'}</dd>
              <dt>Capabilities</dt>
              <dd>
                {selectedCapabilities.length > 0
                  ? selectedCapabilities.join(', ')
                  : 'None selected'}
              </dd>
            </dl>
            {selectedCapabilities.includes('OrderProcessorManager') ? (
              <Alert tone="info" title="Order defaults come next">
                After the connection is created you will pick the default delivery method, payment
                method and status from the shop&rsquo;s own lists.
              </Alert>
            ) : null}
          </>
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

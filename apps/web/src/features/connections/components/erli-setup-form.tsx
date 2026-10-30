/**
 * Erli Setup Form
 *
 * Three-step wizard for creating an Erli connection:
 *   1. Credentials - collects:
 *   - Connection name
 *   - Shop API key (the only credential — sent as a Bearer token by the BE)
 *   - Environment (Production/Sandbox, #1377) — persisted as the neutral
 *     `config.environment` choice; the BE resolves it to a base URL
 *   2. Sales documents - how delivery appears on receipts and invoices
 *      (`config.deliveryOnDocuments`, #3911)
 *   3. Review & connect
 *
 * Simpler than the WooCommerce form — one credential, no capabilities step
 * (capabilities default silently to the adapter manifest's supported set on
 * the omitted path). After a successful create the form surfaces a
 * "Test connection" affordance that calls the generic `/connections/:id/test`
 * endpoint and renders the `ConnectionTestResult`. Abandon-prevention triggers
 * a native confirm dialog when the form is dirty and the tab is closed.
 *
 * @module features/connections/components
 */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type Path } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useCreateConnectionMutation } from '../hooks/use-create-connection-mutation';
import { useTestConnectionMutation } from '../hooks/use-test-connection-mutation';
import type { ConnectionTestResult } from '../api/connections.types';
import {
  ERLI_SETUP_DEFAULT_VALUES,
  erliSetupSchema,
  toCreateConnectionInput,
  type ErliSetupFormSubmission,
  type ErliSetupFormValues,
} from './erli-setup.schema';
import { ErliSetupSummary } from './erli-setup-summary';
import {
  DEFAULT_DELIVERY_WIZARD_VALUE,
  DeliveryWizardStep,
  useDeliveryLineSuggestionsQuery,
  wizardRules,
  wizardSummaryRows,
} from '../../delivery-on-documents';
import { Alert } from '../../../shared/ui/alert';
import { BackLink } from '../../../shared/ui/back-link';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { SetupStepper } from '../../../shared/ui/setup-stepper';
import { useToast } from '../../../shared/ui/toast-provider';
import { WizardLayout } from '../../../shared/ui/wizard-layout';

const STEP_LABELS = ['Credentials', 'Sales documents', 'Review & connect'] as const;

const STEP_FIELDS: ReadonlyArray<ReadonlyArray<Path<ErliSetupFormValues>>> = [
  ['name', 'apiKey', 'environment'],
  [],
  [],
];

function maskSecret(secret: string): string {
  if (secret.length <= 4) return '•'.repeat(secret.length);
  return `${'•'.repeat(Math.max(0, secret.length - 4))}${secret.slice(-4)}`;
}

export function ErliSetupForm(): ReactElement {
  const createConnection = useCreateConnectionMutation();
  const testConnection = useTestConnectionMutation();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [createdConnectionId, setCreatedConnectionId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  const form = useForm<ErliSetupFormValues, undefined, ErliSetupFormSubmission>({
    defaultValues: ERLI_SETUP_DEFAULT_VALUES,
    resolver: zodResolver(erliSetupSchema),
    mode: 'onBlur',
  });

  const suggestionsQuery = useDeliveryLineSuggestionsQuery();
  const suggestions = suggestionsQuery.data?.suggestions ?? [];

  const [stepIndex, setStepIndex] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<ReadonlySet<number>>(new Set());

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
    setStepIndex((i) => Math.min(i + 1, STEP_LABELS.length - 1));
  }

  function goBack(): void {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  // A submit before the last step is Enter in a field, or the click that
  // advanced to the last step landing on the Connect button that replaced Next.
  // Either way it means "Next", never "Connect" (the review step must be seen).
  function handleFormSubmit(event: FormEvent<HTMLFormElement>): void {
    if (stepIndex < STEP_LABELS.length - 1) {
      event.preventDefault();
      void goNext();
      return;
    }
    void onSubmit(event);
  }

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const created = await createConnection.mutateAsync(
        toCreateConnectionInput(values, suggestions),
      );
      form.reset(values, { keepValues: true, keepDirty: false });
      setCreatedConnectionId(created.id);
      showToast({
        tone: 'success',
        title: 'Connection created',
        description: `Erli connection "${created.name}" was created.`,
      });
    } catch {
      return;
    }
  });

  const onTest = async (): Promise<void> => {
    if (!createdConnectionId) return;
    // Clear any prior result first: otherwise a re-test that rejects would render
    // a stale resolved-result Alert alongside the "unable to test" error Alert
    // (PR1064-TECH-01).
    setTestResult(null);
    try {
      const result = await testConnection.mutateAsync(createdConnectionId);
      setTestResult(result);
    } catch {
      // surfaced via testConnection.error
    }
  };

  const values = form.watch();
  const deliveryValue = values.deliveryOnDocuments ?? DEFAULT_DELIVERY_WIZARD_VALUE;
  const deliverySummary = wizardSummaryRows(wizardRules(deliveryValue, suggestions))
    .map((row) => `${row.label}: ${row.value}`)
    .join('; ');

  return (
    <WizardLayout
      stepper={
        <SetupStepper steps={STEP_LABELS} currentStep={stepIndex} completedSteps={completedSteps} />
      }
      summary={
        <ErliSetupSummary values={values} stepIndex={stepIndex} suggestions={suggestions} />
      }
    >
      <form className="wizard-card" onSubmit={handleFormSubmit} noValidate>
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
            In your Erli seller panel, generate a <strong>Shop API key</strong>. OpenLinker sends it as a
            bearer token on every request to the Erli Shop API. The key is stored securely on the server
            and only shown once.
          </Alert>

          <FormField
            label="Connection name"
            name="name"
            error={form.formState.errors.name?.message}
            description="A label to identify this Erli account in OpenLinker."
          >
            <Input
              {...form.register('name')}
              placeholder="My Erli Store"
              autoComplete="off"
              invalid={Boolean(form.formState.errors.name)}
            />
          </FormField>

          <FormField
            label="API key"
            name="apiKey"
            error={form.formState.errors.apiKey?.message}
            description="Your Erli Shop API key — generated in the Erli seller panel."
          >
            <Input
              {...form.register('apiKey')}
              type="password"
              placeholder="••••••••••••••••••••••••••••••••"
              autoComplete="off"
              invalid={Boolean(form.formState.errors.apiKey)}
            />
          </FormField>

          <FormField
            label="Environment"
            name="environment"
            error={form.formState.errors.environment?.message}
            description="Choose Sandbox to test against Erli's sandbox before switching to production."
          >
            <Select {...form.register('environment')}>
              <option value="sandbox">Sandbox - https://sandbox.erli.dev</option>
              <option value="production">Production - https://erli.pl</option>
            </Select>
          </FormField>
          </>
        ) : null}

        {stepIndex === 1 ? (
          <DeliveryWizardStep
            value={deliveryValue}
            suggestions={suggestions}
            onChange={(next) => form.setValue('deliveryOnDocuments', next, { shouldDirty: true })}
          />
        ) : null}

        {stepIndex === 2 ? (
          <dl className="wizard-review-list">
            <dt>Name</dt>
            <dd>{values.name || '-'}</dd>
            <dt>API key</dt>
            <dd className="mono-text">{values.apiKey ? maskSecret(values.apiKey) : '-'}</dd>
            <dt>Environment</dt>
            <dd>{values.environment === 'production' ? 'Production' : 'Sandbox'}</dd>
            <dt>Delivery on documents</dt>
            <dd>{deliverySummary}</dd>
          </dl>
        ) : null}

        {createdConnectionId ? (
          <>
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
          </>
        ) : (
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
                <Button key="next" type="button" onClick={() => void goNext()}>
                  Next
                </Button>
              ) : (
                <Button key="submit" type="submit" disabled={createConnection.isPending}>
                  {createConnection.isPending ? 'Connecting…' : 'Connect Erli'}
                </Button>
              )}
            </div>
          </div>
        )}
      </form>
    </WizardLayout>
  );
}

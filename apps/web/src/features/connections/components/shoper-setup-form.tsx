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
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type Path } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { interpolate, renderRich, useFormat, useMessages } from '../../../shared/i18n';
import { usePlatform } from '../../../shared/plugins';
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
import { describeApiError } from '../../../shared/api/describe-api-error';



const STEP_FIELDS: ReadonlyArray<ReadonlyArray<Path<ShoperSetupFormValues>>> = [
  ['name', 'baseUrl'],
  ['token'],
  ['enabledCapabilities'],
  [],
];

// Analytics step names, kept in English so events stay comparable across languages.
const STEP_EVENT_IDS = ['Shop', 'API token', 'Capabilities', 'Review & create'] as const;

// A host-name example, not prose: the same in every language.
const SHOP_ADDRESS_EXAMPLE = 'xxxxx.shoparena.pl';

function maskToken(token: string): string {
  if (token.length <= 4) return '•'.repeat(token.length);
  return `${'•'.repeat(Math.max(0, token.length - 4))}${token.slice(-4)}`;
}

export function ShoperSetupForm(): ReactElement {
  const copy = useMessages('connections').shoperSetupForm;
  const setupCopy = useMessages('connections').setup;
  const uiCopy = useMessages('ui');
  const format = useFormat();
  const STEP_LABELS = [
    copy.steps.shop,
    copy.steps.token,
    copy.steps.capabilities,
    copy.steps.review,
  ];
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
  const platformName =
    usePlatform(adapterMetadata?.platformType ?? '')?.displayName ?? copy.platformFallback;
  // The checkbox list is gated on the well-known core capabilities: the
  // create-connection request DTO is still strict on `CoreCapabilityValues` (#576).
  const supportedCapabilities: CoreCapability[] = (
    adapterMetadata?.supportedCapabilities ?? SHOPER_FALLBACK_CAPABILITIES
  ).filter((capability): capability is CoreCapability =>
    (CORE_CAPABILITY_VALUES as readonly string[]).includes(capability),
  );

  const validationMessages = Object.values(form.formState.errors).flatMap((fieldError) =>
    fieldError?.message ? [String(fieldError.message)] : [],
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
      step: STEP_EVENT_IDS[stepIndex],
    });
    setStepIndex((i) => Math.min(i + 1, STEP_LABELS.length - 1));
  }

  function goBack(): void {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  // A submit before the last step is Enter in a field, or the click that
  // advanced to the last step landing on the Create button that replaced Next.
  // Either way it means "Next", never "Create" (the review step must be seen).
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
      const created = await createConnection.mutateAsync(toCreateConnectionInput(values));
      form.reset(values, { keepValues: true, keepDirty: false });
      setCreatedConnectionId(created.id);
      showToast({
        tone: 'success',
        title: copy.createdTitle,
        description: interpolate(copy.createdDescription, {
          platform: platformName,
          name: created.name,
        }),
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
          <Alert tone="success" title={copy.createdTitle}>
            {copy.createdHint}
          </Alert>
          {selectedCapabilities.includes('OrderProcessorManager') ? (
            <Alert tone="info" title={copy.ordersNextStep.title}>
              {renderRich(
                copy.ordersNextStep.body,
                {
                  link: (text) => (
                    <Link className="link" to={`/connections/${createdConnectionId}/edit`}>
                      {text}
                    </Link>
                  ),
                },
                { platform: platformName },
              )}
            </Alert>
          ) : null}
          {testResult ? (
            <Alert
              tone={testResult.success ? 'success' : 'error'}
              title={testResult.success ? copy.testPassed : copy.testFailed}
            >
              {`${uiCopy.apiError.technicalDetails}: ${testResult.message}`}
              {typeof testResult.latencyMs === 'number'
                ? ` ${interpolate(copy.latency, { ms: format.number(testResult.latencyMs) })}`
                : null}
            </Alert>
          ) : null}
          {testConnection.error ? (
            <Alert tone="error" title={copy.testError}>
              {describeApiError(testConnection.error, 'connections')}
            </Alert>
          ) : null}
          <div className="form-actions">
            <Button type="button" onClick={() => void onTest()} disabled={testConnection.isPending}>
              {testConnection.isPending ? copy.testing : copy.test}
            </Button>
            <Button tone="secondary" type="button" onClick={() => void navigate('/connections')}>
              {copy.done}
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
      <form className="wizard-card" onSubmit={handleFormSubmit} noValidate>
        <BackLink to="/connections/new" label={setupCopy.connections} className="wizard-card__back" />

        {form.formState.submitCount > 0 && validationMessages.length > 0 ? (
          <FormErrorSummary errors={validationMessages} />
        ) : null}
        {createConnection.error ? (
          <Alert tone="error" title={copy.createError}>
            {describeApiError(createConnection.error, 'connections')}
          </Alert>
        ) : null}

        {stepIndex === 0 ? (
          <>
            <FormField
              label={copy.fields.name.label}
              name="name"
              error={form.formState.errors.name?.message}
              description={interpolate(copy.fields.name.description, { platform: platformName })}
            >
              <Input
                {...form.register('name')}
                placeholder={copy.fields.name.placeholder}
                autoComplete="off"
                invalid={Boolean(form.formState.errors.name)}
              />
            </FormField>

            <FormField
              label={copy.fields.baseUrl.label}
              name="baseUrl"
              error={form.formState.errors.baseUrl?.message}
              description={copy.fields.baseUrl.description}
            >
              <Input
                {...form.register('baseUrl')}
                placeholder={SHOP_ADDRESS_EXAMPLE}
                autoComplete="off"
                invalid={Boolean(form.formState.errors.baseUrl)}
              />
            </FormField>
          </>
        ) : null}

        {stepIndex === 1 ? (
          <>
            <Alert tone="info" title={copy.beforeYouStart.title}>
              {renderRich(
                copy.beforeYouStart.body,
                { strong: (text) => <strong>{text}</strong> },
                { platform: platformName },
              )}
            </Alert>

            <FormField
              label={copy.fields.token.label}
              name="token"
              error={form.formState.errors.token?.message}
              description={interpolate(copy.fields.token.description, { platform: platformName })}
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
            <legend className="capability-fieldset__legend">{copy.capabilities.legend}</legend>
            <p className="muted-text capability-fieldset__help">
              {copy.capabilities.help}
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
              <dt>{copy.review.name}</dt>
              <dd>{values.name || '—'}</dd>
              <dt>{copy.fields.baseUrl.label}</dt>
              <dd className="mono-text">{values.baseUrl || '—'}</dd>
              <dt>{copy.fields.token.label}</dt>
              <dd className="mono-text">{values.token ? maskToken(values.token) : '—'}</dd>
              <dt>{copy.capabilities.legend}</dt>
              <dd>
                {selectedCapabilities.length > 0
                  ? selectedCapabilities.join(', ')
                  : copy.review.noneSelected}
              </dd>
            </dl>
            {selectedCapabilities.includes('OrderProcessorManager') ? (
              <Alert tone="info" title={copy.review.orderDefaults.title}>
                {copy.review.orderDefaults.body}
              </Alert>
            ) : null}
          </>
        ) : null}

        <div className="wizard-actions">
          <div className="wizard-actions__group">
            {stepIndex > 0 ? (
              <Button tone="secondary" type="button" onClick={goBack}>
                {setupCopy.back}
              </Button>
            ) : null}
          </div>
          <div className="wizard-actions__group">
            {stepIndex < STEP_LABELS.length - 1 ? (
              <Button key="next" type="button" onClick={() => void goNext()}>
                {setupCopy.next}
              </Button>
            ) : (
              <Button key="submit" type="submit" disabled={createConnection.isPending}>
                {createConnection.isPending ? copy.creating : copy.create}
              </Button>
            )}
          </div>
        </div>
      </form>
    </WizardLayout>
  );
}

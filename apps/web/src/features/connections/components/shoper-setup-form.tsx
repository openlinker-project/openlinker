/**
 * Shoper Setup Form
 *
 * Multi-step wizard for creating a Shoper connection, the same shape as the
 * PrestaShop and WooCommerce wizards. Steps (the order-history step appears
 * only when OrderSource is enabled, #4265):
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
import {
  BuyerDataWizardReviewRows,
  BuyerDataWizardStep,
  DEFAULT_BUYER_DATA_WIZARD_VALUE,
} from '../../buyer-data';
import { describeApiError } from '../../../shared/api/describe-api-error';
import { describeConnectionTestFailure } from '../lib/describe-connection-test-failure';
import { collectFormErrorMessages } from '../lib/collect-form-error-messages';
import {
  ORDER_SYNC_START_DEFAULT_VALUE,
  describeOrderSyncStart,
  readsOrders,
} from '../lib/order-sync-start';
import { OrderSyncStartSection } from './order-sync-start-section';
import { CapabilityName } from './capability-name';



type StepId = 'shop' | 'token' | 'capabilities' | 'orders' | 'review';

const STEP_FIELDS: Record<StepId, ReadonlyArray<Path<ShoperSetupFormValues>>> = {
  shop: ['name', 'baseUrl'],
  token: ['token'],
  capabilities: ['enabledCapabilities'],
  orders: ['orderSyncStart'],
  review: [],
};

// Analytics step names, kept in English so events stay comparable across languages.
const STEP_EVENT_IDS: Record<StepId, string> = {
  shop: 'Shop',
  token: 'API token',
  capabilities: 'Capabilities',
  orders: 'Order history',
  review: 'Review & create',
};

// A host-name example, not prose: the same in every language.
const SHOP_ADDRESS_EXAMPLE = 'xxxxx.shoparena.pl';

function maskToken(token: string): string {
  if (token.length <= 4) return '•'.repeat(token.length);
  return `${'•'.repeat(Math.max(0, token.length - 4))}${token.slice(-4)}`;
}

export function ShoperSetupForm(): ReactElement {
  const copy = useMessages('connections').shoperSetupForm;
  const setupCopy = useMessages('connections').setup;
  const format = useFormat();
  const orderStartCopy = useMessages('connections').orderSyncStart;
  const createConnection = useCreateConnectionMutation();
  const testConnection = useTestConnectionMutation();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const adaptersQuery = useAdaptersQuery();
  const [stepIndex, setStepIndex] = useState(0);
  // Keyed by step id, not index: the step list is dynamic (OrderSource shifts it).
  const [completedStepIds, setCompletedStepIds] = useState<ReadonlySet<StepId>>(new Set());
  const [createdConnectionId, setCreatedConnectionId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  const form = useForm<ShoperSetupFormValues, undefined, ShoperSetupFormSubmission>({
    defaultValues: SHOPER_SETUP_DEFAULT_VALUES,
    resolver: zodResolver(shoperSetupSchema),
    mode: 'onBlur',
  });

  const values = form.watch();
  const selectedCapabilities = values.enabledCapabilities ?? [];
  // The order-history step only exists for a connection that will read orders.
  const stepIds: StepId[] = readsOrders(selectedCapabilities)
    ? ['shop', 'token', 'capabilities', 'orders', 'review']
    : ['shop', 'token', 'capabilities', 'review'];
  const STEP_LABELS = stepIds.map((id) => copy.steps[id]);
  const completedSteps: ReadonlySet<number> = new Set(
    stepIds.flatMap((id, index) => (completedStepIds.has(id) ? [index] : [])),
  );
  const stepId = stepIds[Math.min(stepIndex, stepIds.length - 1)];
  // The order-history step appears the moment OrderSource is ticked: point at it
  // once so the stepper growing a step reads as a consequence, not a glitch.
  const ordersStepIndex = stepIds.indexOf('orders');
  const highlightStep = stepId === 'capabilities' && ordersStepIndex >= 0 ? ordersStepIndex : undefined;

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

  // Nested errors (the start date) sit below the top level; reading only the top
  // left the summary empty while the submit was refused.
  const validationMessages = collectFormErrorMessages(form.formState.errors);

  async function goNext(): Promise<void> {
    const fields = STEP_FIELDS[stepId];
    if (fields.length > 0) {
      const valid = await form.trigger([...fields]);
      if (!valid) return;
    }
    setCompletedStepIds((prev) => new Set(prev).add(stepId));
    captureDemoEvent('demo_connection_wizard_step_advanced', {
      platform: 'shoper',
      step: STEP_EVENT_IDS[stepId],
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
    if (stepIndex < stepIds.length - 1) {
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

  const buyerDataValue = values.buyerDataRetention ?? DEFAULT_BUYER_DATA_WIZARD_VALUE;
  const takesOrders = selectedCapabilities.includes('OrderSource');

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
              <p>
                {renderRich(copy.ordersNextStep.shipping, {
                  link: (text) => (
                    <Link className="link" to={`/connections/${createdConnectionId}/mappings`}>
                      {text}
                    </Link>
                  ),
                })}
              </p>
            </Alert>
          ) : null}
          {testResult ? (
            <Alert
              tone={testResult.success ? 'success' : 'error'}
              title={testResult.success ? copy.testPassed : copy.testFailed}
            >
              {testResult.success ? null : describeConnectionTestFailure(testResult)}
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
        <SetupStepper
          steps={STEP_LABELS}
          currentStep={stepIndex}
          completedSteps={completedSteps}
          highlightStep={highlightStep}
        />
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

        {stepId === 'shop' ? (
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

        {stepId === 'token' ? (
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

        {stepId === 'capabilities' ? (
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
                      <CapabilityName capability={capability} />
                    </label>
                    <p className="capability-list__help muted-text">
                      {CAPABILITY_HELP[capability]}
                    </p>
                    {capability === 'OrderSource' ? (
                      <p className="capability-list__help capability-list__hint">
                        {copy.capabilities.orderSourceHint}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ) : null}

        {stepId === 'orders' ? (
          <OrderSyncStartSection
            adapterKey={SHOPER_ADAPTER_KEY}
            value={values.orderSyncStart ?? ORDER_SYNC_START_DEFAULT_VALUE}
            onChange={(next) =>
              form.setValue('orderSyncStart', next, { shouldDirty: true, shouldValidate: true })
            }
            error={form.formState.errors.orderSyncStart?.from?.message}
          />
        ) : null}

        {stepId === 'review' ? (
          <>
            {takesOrders ? (
              <BuyerDataWizardStep
                value={buyerDataValue}
                onChange={(next) => form.setValue('buyerDataRetention', next, { shouldDirty: true })}
              />
            ) : null}
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
              {readsOrders(selectedCapabilities) ? (
                <>
                  <dt>{orderStartCopy.review.label}</dt>
                  <dd>
                    {describeOrderSyncStart(values.orderSyncStart, orderStartCopy.review, format.date)}
                  </dd>
                </>
              ) : null}
              {takesOrders ? <BuyerDataWizardReviewRows value={buyerDataValue} /> : null}
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
            {stepIndex < stepIds.length - 1 ? (
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

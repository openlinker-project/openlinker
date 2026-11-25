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
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type Path } from 'react-hook-form';
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
import { OrderSyncStartField } from './order-sync-start-field';
import {
  ORDER_SYNC_START_DEFAULT_MODES,
  ORDER_SYNC_START_DEFAULT_VALUE,
  describeOrderSyncStart,
  readsOrders,
} from '../lib/order-sync-start';
import { PrestashopSetupSummary } from './prestashop-setup-summary';
import { CORE_CAPABILITY_VALUES, type CoreCapability } from '../api/connections.types';
import { CAPABILITY_HELP } from '../lib/capability-metadata';
import { useAdaptersQuery } from '../../adapters';
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
import {
  BuyerDataWizardReviewRows,
  BuyerDataWizardStep,
  DEFAULT_BUYER_DATA_WIZARD_VALUE,
} from '../../buyer-data';
import { captureDemoEvent } from '../../demo';
import { WizardCreatedScreen } from './wizard-created-screen';
import { ShopPackingNextStep } from './shop-packing-next-step';
import { interpolate, renderRich, useFormat, useMessages } from '../../../shared/i18n';
import { usePlatform } from '../../../shared/plugins';
import { describeApiError } from '../../../shared/api/describe-api-error';

// Analytics step names, kept in English so events stay comparable across languages.
// "Verify credentials" rather than "Test connection": the PrestaShop `/test`
// endpoint is only reachable after the connection is saved, so this step is a
// human-review of the entered URL + masked key, not a live probe.
type StepId = 'credentials' | 'verify' | 'capabilities' | 'orders' | 'review';

const STEP_EVENT_IDS: Record<StepId, string> = {
  credentials: 'Credentials',
  verify: 'Verify credentials',
  capabilities: 'Capabilities',
  orders: 'Order history',
  review: 'Review & connect',
};

// ISO 4217 codes offered as the connection default; their names live in copy.
const CURRENCY_CODES = [
  'PLN', 'EUR', 'USD', 'GBP', 'CZK', 'HUF', 'RON', 'SEK', 'NOK', 'DKK', 'CHF',
] as const;

const STEP_FIELDS: Record<StepId, ReadonlyArray<Path<PrestashopSetupFormValues>>> = {
  credentials: ['name', 'baseUrl', 'webserviceKey', 'shopId', 'storefrontBaseUrl', 'currency'],
  verify: [],
  capabilities: ['enabledCapabilities'],
  orders: ['orderSyncStart'],
  review: [],
};

function maskKey(key: string): string {
  if (key.length <= 4) return '•'.repeat(key.length);
  return `${'•'.repeat(Math.max(0, key.length - 4))}${key.slice(-4)}`;
}

export function PrestashopSetupForm(): ReactElement {
  const copy = useMessages('connections').prestashopSetupForm;
  const setupCopy = useMessages('connections').setup;
  const platform = usePlatform('prestashop')?.displayName ?? copy.platformFallback;
  const createConnection = useCreateConnectionMutation();
  const { showToast } = useToast();
  const adaptersQuery = useAdaptersQuery();
  const form = useForm<PrestashopSetupFormValues, undefined, PrestashopSetupFormSubmission>({
    defaultValues: PRESTASHOP_SETUP_DEFAULT_VALUES,
    resolver: zodResolver(prestashopSetupSchema),
    mode: 'onBlur',
  });

  const values = form.watch();
  // The order-history step only exists for a connection that will read orders.
  const stepIds: StepId[] = readsOrders(values.enabledCapabilities)
    ? ['credentials', 'verify', 'capabilities', 'orders', 'review']
    : ['credentials', 'verify', 'capabilities', 'review'];
  const STEP_LABELS = stepIds.map((id) => copy.steps[id]);

  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const stepId = stepIds[Math.min(stepIndex, stepIds.length - 1)];
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

  const orderStartCopy = useMessages('connections').orderSyncStart;
  const format = useFormat();
  const adapterMetadata = adaptersQuery.data?.find((a) => a.adapterKey === PRESTASHOP_ADAPTER_KEY);
  // The form's checkbox list is gated on the well-known core capabilities. Plugin
  // adapters (#576) may register additional names, but the create-connection
  // request DTO is still strict on `CoreCapabilityValues`, so the wizard only
  // exposes core caps for editing today. Lift the narrow when the runtime-aware
  // DTO validator follow-up lands.
  const orderSyncStartModes = adapterMetadata?.orderSyncStartModes ?? ORDER_SYNC_START_DEFAULT_MODES;
  const orderWindowImport = adapterMetadata?.orderWindowImport ?? false;
  const supportedCapabilities: CoreCapability[] = (
    adapterMetadata?.supportedCapabilities ?? PRESTASHOP_FALLBACK_CAPABILITIES
  ).filter((capability): capability is CoreCapability =>
    (CORE_CAPABILITY_VALUES as readonly string[]).includes(capability),
  );

  const validationMessages = Object.values(form.formState.errors).flatMap((fieldError) =>
    fieldError?.message ? [String(fieldError.message)] : []
  );

  async function goNext(): Promise<void> {
    const fields = STEP_FIELDS[stepId];
    if (fields.length > 0) {
      const valid = await form.trigger([...fields]);
      if (!valid) return;
    }
    setCompletedSteps((prev) => new Set(prev).add(stepIndex));
    captureDemoEvent('demo_connection_wizard_step_advanced', {
      platform: 'prestashop',
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
      const result = await createConnection.mutateAsync(toCreateConnectionInput(values));
      form.reset(values, { keepValues: true, keepDirty: false });
      showToast({
        tone: 'success',
        title: copy.createdTitle,
        description: interpolate(copy.createdDescription, { platform, name: result.name }),
      });
      setCreated({ id: result.id, name: result.name });
    } catch {
      return;
    }
  });

  const buyerDataValue = values.buyerDataRetention ?? DEFAULT_BUYER_DATA_WIZARD_VALUE;
  const takesOrders = (values.enabledCapabilities ?? []).includes('OrderSource');
  if (created) {
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
        <WizardCreatedScreen
          connectionId={created.id}
          connectionName={created.name}
          title={copy.createdTitle}
        >
          <ShopPackingNextStep connectionId={created.id} />
        </WizardCreatedScreen>
      </WizardLayout>
    );
  }

  return (
    <WizardLayout
      stepper={
        <SetupStepper steps={STEP_LABELS} currentStep={stepIndex} completedSteps={completedSteps} />
      }
      summary={<PrestashopSetupSummary values={values} stepIndex={stepIndex} />}
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

        {stepId === 'credentials' ? (
          <>
            <Alert tone="info" title={copy.beforeYouStart.title}>
              {renderRich(
                copy.beforeYouStart.body,
                { strong: (text) => <strong>{text}</strong> },
                { platform },
              )}
            </Alert>

            <FormField
              label={copy.fields.name.label}
              name="name"
              error={form.formState.errors.name?.message}
            >
              <Input
                {...form.register('name')}
                placeholder={interpolate(copy.fields.name.placeholder, { platform })}
                invalid={Boolean(form.formState.errors.name)}
              />
            </FormField>

            <FormField
              label={copy.fields.baseUrl.label}
              name="baseUrl"
              error={form.formState.errors.baseUrl?.message}
              description={interpolate(copy.fields.baseUrl.description, { platform })}
            >
              <Input
                {...form.register('baseUrl')}
                className="mono-text"
                placeholder="https://shop.example.com"
                invalid={Boolean(form.formState.errors.baseUrl)}
              />
            </FormField>

            <FormField
              label={copy.fields.storefrontBaseUrl.label}
              name="storefrontBaseUrl"
              error={form.formState.errors.storefrontBaseUrl?.message}
              description={copy.fields.storefrontBaseUrl.description}
            >
              <Input
                {...form.register('storefrontBaseUrl')}
                className="mono-text"
                placeholder="https://shop.example.com"
                invalid={Boolean(form.formState.errors.storefrontBaseUrl)}
              />
            </FormField>

            <FormField
              label={copy.fields.webserviceKey.label}
              name="webserviceKey"
              error={form.formState.errors.webserviceKey?.message}
              description={interpolate(copy.fields.webserviceKey.description, { platform })}
            >
              <Input
                {...form.register('webserviceKey')}
                className="mono-text"
                type="password"
                autoComplete="off"
                placeholder={copy.fields.webserviceKey.placeholder}
                invalid={Boolean(form.formState.errors.webserviceKey)}
              />
            </FormField>

            <FormField
              label={copy.fields.shopId.label}
              name="shopId"
              error={form.formState.errors.shopId?.message}
              description={interpolate(copy.fields.shopId.description, { platform })}
            >
              <Input
                {...form.register('shopId')}
                className="mono-text"
                placeholder="1"
                invalid={Boolean(form.formState.errors.shopId)}
              />
            </FormField>

            <FormField
              label={copy.fields.currency.label}
              name="currency"
              error={form.formState.errors.currency?.message}
              description={copy.fields.currency.description}
            >
              <Select
                {...form.register('currency')}
                invalid={Boolean(form.formState.errors.currency)}
              >
                <option value="">{copy.fields.currency.notSet}</option>
                {CURRENCY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {interpolate(copy.fields.currency.option, {
                      code,
                      name: copy.currencies[code],
                    })}
                  </option>
                ))}
              </Select>
            </FormField>
          </>
        ) : null}

        {stepId === 'verify' ? (
          <div className="wizard-test-result">
            <Alert tone="info" title={copy.verify.title}>
              {interpolate(copy.verify.body, { platform })}
            </Alert>
            <dl className="wizard-review-list">
              <dt>{copy.fields.baseUrl.label}</dt>
              <dd className="mono-text">{values.baseUrl || '—'}</dd>
              {values.storefrontBaseUrl ? (
                <>
                  <dt>{copy.review.storefrontUrl}</dt>
                  <dd className="mono-text">{values.storefrontBaseUrl}</dd>
                </>
              ) : null}
              <dt>{copy.fields.webserviceKey.label}</dt>
              <dd className="mono-text">
                {values.webserviceKey ? maskKey(values.webserviceKey) : '—'}
              </dd>
              {values.shopId ? (
                <>
                  <dt>{copy.review.shopId}</dt>
                  <dd className="mono-text">{values.shopId}</dd>
                </>
              ) : null}
              {values.currency ? (
                <>
                  <dt>{copy.review.currency}</dt>
                  <dd className="mono-text">{values.currency}</dd>
                </>
              ) : null}
            </dl>
          </div>
        ) : null}

        {stepId === 'capabilities' ? (
          <fieldset className="capability-fieldset">
            <legend className="capability-fieldset__legend">{copy.capabilities.legend}</legend>
            <p className="muted-text capability-fieldset__help">{copy.capabilities.help}</p>
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

        {stepId === 'orders' ? (
          <OrderSyncStartField
            value={values.orderSyncStart ?? ORDER_SYNC_START_DEFAULT_VALUE}
            onChange={(next) =>
              form.setValue('orderSyncStart', next, { shouldDirty: true, shouldValidate: true })
            }
            supportedModes={orderSyncStartModes}
            windowImport={orderWindowImport}
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
            {values.storefrontBaseUrl ? (
              <>
                <dt>{copy.review.storefrontUrl}</dt>
                <dd className="mono-text">{values.storefrontBaseUrl}</dd>
              </>
            ) : null}
            <dt>{copy.fields.webserviceKey.label}</dt>
            <dd className="mono-text">
              {values.webserviceKey ? maskKey(values.webserviceKey) : '—'}
            </dd>
            {values.shopId ? (
              <>
                <dt>{copy.review.shopId}</dt>
                <dd className="mono-text">{values.shopId}</dd>
              </>
            ) : null}
            {values.currency ? (
              <>
                <dt>{copy.review.currency}</dt>
                <dd className="mono-text">{values.currency}</dd>
              </>
            ) : null}
            <dt>{copy.capabilities.legend}</dt>
            <dd>
              {(values.enabledCapabilities ?? []).length > 0
                ? (values.enabledCapabilities ?? []).join(', ')
                : copy.review.noneSelected}
            </dd>
            {takesOrders ? <BuyerDataWizardReviewRows value={buyerDataValue} /> : null}
            {readsOrders(values.enabledCapabilities) ? (
              <>
                <dt>{orderStartCopy.review.label}</dt>
                <dd>{describeOrderSyncStart(values.orderSyncStart, orderStartCopy.review, format.date)}</dd>
              </>
            ) : null}
          </dl>
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

/**
 * WooCommerce Setup Form
 *
 * Multi-step wizard for creating a WooCommerce connection. Steps:
 *   1. Store details — connection name, site URL (HTTPS)
 *   2. API credentials — consumer key (ck_...), consumer secret (cs_...)
 *   3. Capabilities — which roles this connection will fulfil, with the
 *      InventoryMaster/OfferManager mutual exclusivity enforced via a
 *      disable-guard (the backend rejects the pair with a 400)
 *   4. Review & create — final summary before submit
 *
 * Per-step validation runs on Next so the operator cannot advance with
 * invalid fields. Abandon-prevention triggers a native confirm dialog
 * when the form is dirty and the tab is closed.
 */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type Path } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useAdaptersQuery } from '../../adapters';
import { useCreateConnectionMutation } from '../hooks/use-create-connection-mutation';
import { CORE_CAPABILITY_VALUES, type CoreCapability } from '../api/connections.types';
import {
  CAPABILITY_HELP,
  capabilityConflictMessage,
  getCapabilityConflict,
} from '../lib/capability-metadata';
import {
  WOOCOMMERCE_ADAPTER_KEY,
  WOOCOMMERCE_FALLBACK_CAPABILITIES,
  WOOCOMMERCE_SETUP_DEFAULT_VALUES,
  woocommerceSetupSchema,
  toCreateConnectionInput,
  type WoocommerceSetupFormValues,
  type WoocommerceSetupFormSubmission,
} from './woocommerce-setup.schema';
import { Alert } from '../../../shared/ui/alert';
import { BackLink } from '../../../shared/ui/back-link';
import { Button } from '../../../shared/ui/button';
import { OrderSyncStartField } from './order-sync-start-field';
import {
  ORDER_SYNC_START_DEFAULT_MODES,
  ORDER_SYNC_START_DEFAULT_VALUE,
  describeOrderSyncStart,
  readsOrders,
} from '../lib/order-sync-start';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { SetupStepper } from '../../../shared/ui/setup-stepper';
import { WizardLayout } from '../../../shared/ui/wizard-layout';
import { useToast } from '../../../shared/ui/toast-provider';
import { captureDemoEvent } from '../../demo';
import { interpolate, renderRich, useFormat, useMessages } from '../../../shared/i18n';
import { usePlatform } from '../../../shared/plugins';
import { describeApiError } from '../../../shared/api/describe-api-error';

// Analytics step names, kept in English so events stay comparable across languages.
type StepId = 'store' | 'credentials' | 'capabilities' | 'orders' | 'review';

const STEP_EVENT_IDS: Record<StepId, string> = {
  store: 'Store details',
  credentials: 'API credentials',
  capabilities: 'Capabilities',
  orders: 'Order history',
  review: 'Review & create',
};

const STEP_FIELDS: Record<StepId, ReadonlyArray<Path<WoocommerceSetupFormValues>>> = {
  store: ['name', 'siteUrl'],
  credentials: ['consumerKey', 'consumerSecret'],
  capabilities: ['enabledCapabilities'],
  orders: ['orderSyncStart'],
  review: [],
};

function maskKey(key: string): string {
  if (key.length <= 4) return '•'.repeat(key.length);
  return `${'•'.repeat(Math.max(0, key.length - 4))}${key.slice(-4)}`;
}

export function WoocommerceSetupForm(): ReactElement {
  const copy = useMessages('connections').woocommerceSetupForm;
  const setupCopy = useMessages('connections').setup;
  const platform = usePlatform('woocommerce')?.displayName ?? copy.platformFallback;
  const createConnection = useCreateConnectionMutation();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const adaptersQuery = useAdaptersQuery();

  const form = useForm<WoocommerceSetupFormValues, undefined, WoocommerceSetupFormSubmission>({
    defaultValues: WOOCOMMERCE_SETUP_DEFAULT_VALUES,
    resolver: zodResolver(woocommerceSetupSchema),
    mode: 'onBlur',
  });

  const values = form.watch();
  // The order-history step only exists for a connection that will read orders.
  const stepIds: StepId[] = readsOrders(values.enabledCapabilities)
    ? ['store', 'credentials', 'capabilities', 'orders', 'review']
    : ['store', 'credentials', 'capabilities', 'review'];
  const STEP_LABELS = stepIds.map((id) => copy.steps[id]);

  const [stepIndex, setStepIndex] = useState(0);
  const stepId = stepIds[Math.min(stepIndex, stepIds.length - 1)];
  const [completedSteps, setCompletedSteps] = useState<ReadonlySet<number>>(new Set());

  // Abandon-prevention.
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
  const adapterMetadata = adaptersQuery.data?.find((a) => a.adapterKey === WOOCOMMERCE_ADAPTER_KEY);
  // The checkbox list is gated on the well-known core capabilities: the
  // create-connection request DTO is still strict on `CoreCapabilityValues`
  // (#576), so the wizard only exposes core caps today.
  const orderSyncStartModes = adapterMetadata?.orderSyncStartModes ?? ORDER_SYNC_START_DEFAULT_MODES;
  const orderWindowImport = adapterMetadata?.orderWindowImport ?? false;
  const supportedCapabilities: CoreCapability[] = (
    adapterMetadata?.supportedCapabilities ?? WOOCOMMERCE_FALLBACK_CAPABILITIES
  ).filter((capability): capability is CoreCapability =>
    (CORE_CAPABILITY_VALUES as readonly string[]).includes(capability),
  );

  const validationMessages = Object.values(form.formState.errors).flatMap((fieldError) =>
    fieldError?.message ? [String(fieldError.message)] : [],
  );

  async function goNext(): Promise<void> {
    const fields = STEP_FIELDS[stepId];
    if (fields.length > 0) {
      const valid = await form.trigger([...fields]);
      if (!valid) return;
    }
    setCompletedSteps((prev) => new Set(prev).add(stepIndex));
    captureDemoEvent('demo_connection_wizard_step_advanced', {
      platform: 'woocommerce',
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
      showToast({
        tone: 'success',
        title: copy.createdTitle,
        description: interpolate(copy.createdDescription, { platform, name: created.name }),
      });
      void navigate('/connections');
    } catch {
      return;
    }
  });

  const selectedCapabilities = values.enabledCapabilities ?? [];

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

        {stepId === 'store' ? (
          <>
            <FormField
              label={copy.fields.name.label}
              name="name"
              error={form.formState.errors.name?.message}
              description={copy.fields.name.description}
            >
              <Input
                {...form.register('name')}
                placeholder={interpolate(copy.fields.name.placeholder, { platform })}
                autoComplete="off"
                invalid={Boolean(form.formState.errors.name)}
              />
            </FormField>

            <FormField
              label={copy.fields.siteUrl.label}
              name="siteUrl"
              error={form.formState.errors.siteUrl?.message}
              description={interpolate(copy.fields.siteUrl.description, { platform })}
            >
              <Input
                {...form.register('siteUrl')}
                className="mono-text"
                placeholder="https://shop.example.com"
                autoComplete="off"
                invalid={Boolean(form.formState.errors.siteUrl)}
              />
            </FormField>
          </>
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
              label={copy.fields.consumerKey.label}
              name="consumerKey"
              error={form.formState.errors.consumerKey?.message}
              description={interpolate(copy.fields.consumerKey.description, { platform })}
            >
              <Input
                {...form.register('consumerKey')}
                className="mono-text"
                type="password"
                placeholder="ck_••••••••••••••••••••••••••••••••••••••••"
                autoComplete="off"
                invalid={Boolean(form.formState.errors.consumerKey)}
              />
            </FormField>

            <FormField
              label={copy.fields.consumerSecret.label}
              name="consumerSecret"
              error={form.formState.errors.consumerSecret?.message}
              description={copy.fields.consumerSecret.description}
            >
              <Input
                {...form.register('consumerSecret')}
                className="mono-text"
                type="password"
                placeholder="cs_••••••••••••••••••••••••••••••••••••••••"
                autoComplete="off"
                invalid={Boolean(form.formState.errors.consumerSecret)}
              />
            </FormField>
          </>
        ) : null}

        {stepId === 'capabilities' ? (
          <fieldset className="capability-fieldset">
            <legend className="capability-fieldset__legend">{copy.capabilities.legend}</legend>
            <p className="muted-text capability-fieldset__help">{copy.capabilities.help}</p>
            <ul className="capability-list">
              {supportedCapabilities.map((capability) => {
                const id = `new-cap-${capability}`;
                const conflict = getCapabilityConflict(selectedCapabilities, capability);
                const isBlocked = conflict !== null && !selectedCapabilities.includes(capability);
                return (
                  <li key={capability} className="capability-list__item">
                    <label htmlFor={id} className="capability-list__label">
                      <input
                        id={id}
                        type="checkbox"
                        value={capability}
                        disabled={isBlocked}
                        {...form.register('enabledCapabilities')}
                      />
                      <span className="capability-list__name mono-text">{capability}</span>
                    </label>
                    <p className="capability-list__help muted-text">
                      {isBlocked && conflict
                        ? capabilityConflictMessage(conflict)
                        : CAPABILITY_HELP[capability]}
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
          <dl className="wizard-review-list">
            <dt>{copy.review.name}</dt>
            <dd>{values.name || '—'}</dd>
            <dt>{copy.fields.siteUrl.label}</dt>
            <dd className="mono-text">{values.siteUrl || '—'}</dd>
            <dt>{copy.fields.consumerKey.label}</dt>
            <dd className="mono-text">{values.consumerKey ? maskKey(values.consumerKey) : '—'}</dd>
            <dt>{copy.capabilities.legend}</dt>
            <dd>
              {selectedCapabilities.length > 0 ? selectedCapabilities.join(', ') : copy.review.noneSelected}
            </dd>
            {readsOrders(values.enabledCapabilities) ? (
              <>
                <dt>{orderStartCopy.review.label}</dt>
                <dd>{describeOrderSyncStart(values.orderSyncStart, orderStartCopy.review, format.date)}</dd>
              </>
            ) : null}
          </dl>
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

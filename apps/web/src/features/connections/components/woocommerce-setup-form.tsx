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
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { SetupStepper } from '../../../shared/ui/setup-stepper';
import { WizardLayout } from '../../../shared/ui/wizard-layout';
import { useToast } from '../../../shared/ui/toast-provider';
import { captureDemoEvent } from '../../demo';
import { interpolate, renderRich, useMessages } from '../../../shared/i18n';
import { usePlatform } from '../../../shared/plugins';
import { describeApiError } from '../../../shared/api/describe-api-error';

// Analytics step names, kept in English so events stay comparable across languages.
const STEP_EVENT_IDS = [
  'Store details',
  'API credentials',
  'Capabilities',
  'Review & create',
] as const;

const STEP_FIELDS: ReadonlyArray<ReadonlyArray<Path<WoocommerceSetupFormValues>>> = [
  ['name', 'siteUrl'],
  ['consumerKey', 'consumerSecret'],
  ['enabledCapabilities'],
  [],
];

function maskKey(key: string): string {
  if (key.length <= 4) return '•'.repeat(key.length);
  return `${'•'.repeat(Math.max(0, key.length - 4))}${key.slice(-4)}`;
}

export function WoocommerceSetupForm(): ReactElement {
  const copy = useMessages('connections').woocommerceSetupForm;
  const setupCopy = useMessages('connections').setup;
  const platform = usePlatform('woocommerce')?.displayName ?? copy.platformFallback;
  const STEP_LABELS = [
    copy.steps.store,
    copy.steps.credentials,
    copy.steps.capabilities,
    copy.steps.review,
  ];
  const createConnection = useCreateConnectionMutation();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const adaptersQuery = useAdaptersQuery();

  const form = useForm<WoocommerceSetupFormValues, undefined, WoocommerceSetupFormSubmission>({
    defaultValues: WOOCOMMERCE_SETUP_DEFAULT_VALUES,
    resolver: zodResolver(woocommerceSetupSchema),
    mode: 'onBlur',
  });

  const [stepIndex, setStepIndex] = useState(0);
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

  const adapterMetadata = adaptersQuery.data?.find((a) => a.adapterKey === WOOCOMMERCE_ADAPTER_KEY);
  // The checkbox list is gated on the well-known core capabilities: the
  // create-connection request DTO is still strict on `CoreCapabilityValues`
  // (#576), so the wizard only exposes core caps today.
  const supportedCapabilities: CoreCapability[] = (
    adapterMetadata?.supportedCapabilities ?? WOOCOMMERCE_FALLBACK_CAPABILITIES
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
      platform: 'woocommerce',
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

  const values = form.watch();
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

        {stepIndex === 0 ? (
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

        {stepIndex === 1 ? (
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

        {stepIndex === 2 ? (
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

        {stepIndex === 3 ? (
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

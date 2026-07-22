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
import { useEffect, useState, type ReactElement } from 'react';
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

const STEP_LABELS = [
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

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const created = await createConnection.mutateAsync(toCreateConnectionInput(values));
      form.reset(values, { keepValues: true, keepDirty: false });
      showToast({
        tone: 'success',
        title: 'Connection created',
        description: `WooCommerce connection "${created.name}" was created.`,
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
              description="A label to identify this store in OpenLinker."
            >
              <Input
                {...form.register('name')}
                placeholder="My WooCommerce Store"
                autoComplete="off"
                invalid={Boolean(form.formState.errors.name)}
              />
            </FormField>

            <FormField
              label="Site URL"
              name="siteUrl"
              error={form.formState.errors.siteUrl?.message}
              description="The root URL of your WooCommerce store. Must use HTTPS."
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
            <Alert tone="info" title="Before you start">
              In your WooCommerce admin, go to{' '}
              <strong>WooCommerce → Settings → Advanced → REST API</strong> and generate a key with{' '}
              <strong>Read/Write</strong> permissions. Copy the consumer key and consumer secret
              below — they are only shown once.
            </Alert>

            <FormField
              label="Consumer key"
              name="consumerKey"
              error={form.formState.errors.consumerKey?.message}
              description="Starts with ck_ — generated in WooCommerce REST API settings."
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
              label="Consumer secret"
              name="consumerSecret"
              error={form.formState.errors.consumerSecret?.message}
              description="Starts with cs_ — generated alongside the consumer key."
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
            <legend className="capability-fieldset__legend">Capabilities</legend>
            <p className="muted-text capability-fieldset__help">
              Pick which roles this connection should fulfil. You can change this later on the
              connection&rsquo;s detail page.
            </p>
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
            <dt>Name</dt>
            <dd>{values.name || '—'}</dd>
            <dt>Site URL</dt>
            <dd className="mono-text">{values.siteUrl || '—'}</dd>
            <dt>Consumer key</dt>
            <dd className="mono-text">{values.consumerKey ? maskKey(values.consumerKey) : '—'}</dd>
            <dt>Capabilities</dt>
            <dd>
              {selectedCapabilities.length > 0 ? selectedCapabilities.join(', ') : 'None selected'}
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

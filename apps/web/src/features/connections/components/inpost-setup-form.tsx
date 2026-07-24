/**
 * InPost Setup Form (#771)
 *
 * Guided wizard for creating an InPost (ShipX) carrier connection. Steps:
 *   1. Account & credentials — name, API token, environment, organization id
 *   2. Sender address — populated on every shipment
 *   3. Review & connect
 *
 * Per-step validation runs on Next so the operator can't advance with invalid
 * fields. Abandon-prevention warns on a dirty unload. InPost is shipping-only —
 * no capabilities step (the API defaults to the adapter's supported set).
 * Mirrors the DPD Polska setup form.
 *
 * @module features/connections/components
 */
import { useEffect, useState, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type Path } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useCreateConnectionMutation } from '../hooks/use-create-connection-mutation';
import {
  INPOST_SETUP_DEFAULT_VALUES,
  inpostSetupSchema,
  toCreateConnectionInput,
  type InpostSetupFormSubmission,
  type InpostSetupFormValues,
} from './inpost-setup.schema';
import { Alert } from '../../../shared/ui/alert';
import { BackLink } from '../../../shared/ui/back-link';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { CodCurrencySupport } from './cod-currency-support';
import { SetupStepper } from '../../../shared/ui/setup-stepper';
import { WizardLayout } from '../../../shared/ui/wizard-layout';
import { useToast } from '../../../shared/ui/toast-provider';
import { captureDemoEvent } from '../../demo';

const STEP_LABELS = ['Account & credentials', 'Sender address', 'Review & connect'] as const;

const STEP_FIELDS: ReadonlyArray<ReadonlyArray<Path<InpostSetupFormValues>>> = [
  ['name', 'apiToken', 'environment', 'organizationId'],
  [
    'senderName',
    'senderEmail',
    'senderPhone',
    'senderStreet',
    'senderBuildingNumber',
    'senderCity',
    'senderPostCode',
    'senderCountryCode',
  ],
  [],
];

export function InpostSetupForm(): ReactElement {
  const createConnection = useCreateConnectionMutation();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const form = useForm<InpostSetupFormValues, undefined, InpostSetupFormSubmission>({
    defaultValues: INPOST_SETUP_DEFAULT_VALUES,
    resolver: zodResolver(inpostSetupSchema),
    mode: 'onBlur',
  });

  const [stepIndex, setStepIndex] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<ReadonlySet<number>>(new Set());

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent): void {
      if (!form.formState.isDirty) return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [form.formState.isDirty]);

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
      platform: 'inpost',
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
      showToast({
        tone: 'success',
        title: 'Connection created',
        description: `InPost connection "${created.name}" was created.`,
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
      summary={
        <dl className="wizard-review-list">
          <dt>Name</dt>
          <dd>{values.name || '—'}</dd>
          <dt>Environment</dt>
          <dd className="mono-text">{values.environment}</dd>
          <dt>Organization ID</dt>
          <dd className="mono-text">{values.organizationId || '—'}</dd>
          <dt>Sender</dt>
          <dd>{values.senderCity ? `${values.senderCity}, ${values.senderCountryCode}` : '—'}</dd>
        </dl>
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
            <Alert tone="info" title="Before you start">
              Generate a ShipX <strong>API token</strong> and note your{' '}
              <strong>organization id</strong> in the InPost ShipX panel. Use the sandbox
              environment to verify before switching to production.
            </Alert>

            <FormField label="Connection name" name="name" error={form.formState.errors.name?.message}>
              <Input
                {...form.register('name')}
                placeholder="InPost — main warehouse"
                invalid={Boolean(form.formState.errors.name)}
              />
            </FormField>

            <FormField
              label="API token"
              name="apiToken"
              error={form.formState.errors.apiToken?.message}
              description="ShipX Bearer token — stored securely on the server, never shown again after save."
            >
              <Input
                {...form.register('apiToken')}
                type="password"
                className="mono-text"
                autoComplete="off"
                placeholder="••••••••••••••••••••••••••••••••"
                invalid={Boolean(form.formState.errors.apiToken)}
              />
            </FormField>

            <FormField
              label="Environment"
              name="environment"
              error={form.formState.errors.environment?.message}
            >
              <Select
                {...form.register('environment')}
                invalid={Boolean(form.formState.errors.environment)}
              >
                <option value="sandbox">Sandbox</option>
                <option value="production">Production</option>
              </Select>
            </FormField>

            <FormField
              label="Organization ID"
              name="organizationId"
              error={form.formState.errors.organizationId?.message}
              description="ShipX organization id — a URL path parameter on every shipment endpoint."
            >
              <Input
                {...form.register('organizationId')}
                className="mono-text"
                placeholder="123456"
                invalid={Boolean(form.formState.errors.organizationId)}
              />
            </FormField>

            <CodCurrencySupport platformType="inpost" />
          </>
        ) : null}

        {stepIndex === 1 ? (
          <>
            <Alert tone="info" title="Sender address">
              Used as the ShipX shipment sender. Polish postal format{' '}
              <span className="mono-text">NN-NNN</span>.
            </Alert>

            <FormField label="Sender name (optional)" name="senderName" error={form.formState.errors.senderName?.message}>
              <Input {...form.register('senderName')} placeholder="Sklep ACME" invalid={Boolean(form.formState.errors.senderName)} />
            </FormField>
            <FormField label="Sender email" name="senderEmail" error={form.formState.errors.senderEmail?.message}>
              <Input {...form.register('senderEmail')} placeholder="magazyn@acme.pl" invalid={Boolean(form.formState.errors.senderEmail)} />
            </FormField>
            <FormField label="Sender phone" name="senderPhone" error={form.formState.errors.senderPhone?.message}>
              <Input {...form.register('senderPhone')} className="mono-text" placeholder="+48111222333" invalid={Boolean(form.formState.errors.senderPhone)} />
            </FormField>
            <FormField label="Street" name="senderStreet" error={form.formState.errors.senderStreet?.message}>
              <Input {...form.register('senderStreet')} placeholder="ul. Magazynowa" invalid={Boolean(form.formState.errors.senderStreet)} />
            </FormField>
            <FormField label="Building number" name="senderBuildingNumber" error={form.formState.errors.senderBuildingNumber?.message}>
              <Input {...form.register('senderBuildingNumber')} className="mono-text" placeholder="1" invalid={Boolean(form.formState.errors.senderBuildingNumber)} />
            </FormField>
            <FormField label="City" name="senderCity" error={form.formState.errors.senderCity?.message}>
              <Input {...form.register('senderCity')} placeholder="Warszawa" invalid={Boolean(form.formState.errors.senderCity)} />
            </FormField>
            <FormField
              label="Postcode"
              name="senderPostCode"
              error={form.formState.errors.senderPostCode?.message}
              description="PL format NN-NNN (e.g. 00-001)."
            >
              <Input {...form.register('senderPostCode')} className="mono-text" placeholder="00-001" invalid={Boolean(form.formState.errors.senderPostCode)} />
            </FormField>
            <FormField label="Country" name="senderCountryCode" error={form.formState.errors.senderCountryCode?.message} description="ISO 3166-1 alpha-2 (e.g. PL).">
              <Input {...form.register('senderCountryCode')} className="mono-text" placeholder="PL" maxLength={2} invalid={Boolean(form.formState.errors.senderCountryCode)} />
            </FormField>
          </>
        ) : null}

        {stepIndex === 2 ? (
          <dl className="wizard-review-list">
            <dt>Name</dt>
            <dd>{values.name || '—'}</dd>
            <dt>Environment</dt>
            <dd className="mono-text">{values.environment}</dd>
            <dt>Organization ID</dt>
            <dd className="mono-text">{values.organizationId || '—'}</dd>
            <dt>Sender</dt>
            <dd>
              {[
                values.senderStreet,
                values.senderBuildingNumber,
                values.senderPostCode,
                values.senderCity,
                values.senderCountryCode,
              ]
                .filter(Boolean)
                .join(', ') || '—'}
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

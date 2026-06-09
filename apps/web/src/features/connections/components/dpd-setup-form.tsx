/**
 * DPD Polska Setup Form
 *
 * Guided wizard for creating a DPD Polska courier connection. Steps:
 *   1. Account & credentials — name, login, password, environment, payer FID
 *   2. Sender address — printed on every label
 *   3. Review & connect
 *
 * Per-step validation runs on Next so the operator can't advance with invalid
 * fields. Abandon-prevention warns on a dirty unload. DPD is shipping-only —
 * no capabilities step (the API defaults to the adapter's supported set) and
 * no order-trigger model.
 *
 * @module features/connections/components
 */
import { useEffect, useState, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type Path } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useCreateConnectionMutation } from '../hooks/use-create-connection-mutation';
import {
  DPD_SETUP_DEFAULT_VALUES,
  dpdSetupSchema,
  toCreateConnectionInput,
  type DpdSetupFormSubmission,
  type DpdSetupFormValues,
} from './dpd-setup.schema';
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

const STEP_LABELS = ['Account & credentials', 'Sender address', 'Review & connect'] as const;

const STEP_FIELDS: ReadonlyArray<ReadonlyArray<Path<DpdSetupFormValues>>> = [
  ['name', 'login', 'password', 'environment', 'payerFid', 'masterFid'],
  [
    'senderCompany',
    'senderName',
    'senderAddress',
    'senderCity',
    'senderPostalCode',
    'senderCountryCode',
    'senderPhone',
    'senderEmail',
  ],
  [],
];

export function DpdSetupForm(): ReactElement {
  const createConnection = useCreateConnectionMutation();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const form = useForm<DpdSetupFormValues, undefined, DpdSetupFormSubmission>({
    defaultValues: DPD_SETUP_DEFAULT_VALUES,
    resolver: zodResolver(dpdSetupSchema),
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
        description: `DPD Polska connection "${created.name}" was created.`,
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
          <dt>Payer FID</dt>
          <dd className="mono-text">{values.payerFid || '—'}</dd>
          <dt>Sender</dt>
          <dd>
            {values.senderCity ? `${values.senderCity}, ${values.senderCountryCode}` : '—'}
          </dd>
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
              You need your DPDServices REST <strong>login</strong> and <strong>password</strong>{' '}
              plus your <strong>payer FID</strong> (account id). Use the sandbox environment to
              verify before switching to production.
            </Alert>

            <FormField label="Connection name" name="name" error={form.formState.errors.name?.message}>
              <Input
                {...form.register('name')}
                placeholder="DPD — main warehouse"
                invalid={Boolean(form.formState.errors.name)}
              />
            </FormField>

            <FormField label="Login" name="login" error={form.formState.errors.login?.message}>
              <Input
                {...form.register('login')}
                className="mono-text"
                autoComplete="off"
                placeholder="ol_12345"
                invalid={Boolean(form.formState.errors.login)}
              />
            </FormField>

            <FormField
              label="Password"
              name="password"
              error={form.formState.errors.password?.message}
              description="Stored securely on the server — never shown again after save."
            >
              <Input
                {...form.register('password')}
                type="password"
                autoComplete="off"
                placeholder="••••••••••"
                invalid={Boolean(form.formState.errors.password)}
              />
            </FormField>

            <FormField
              label="Environment"
              name="environment"
              error={form.formState.errors.environment?.message}
            >
              <Select {...form.register('environment')} invalid={Boolean(form.formState.errors.environment)}>
                <option value="sandbox">Sandbox</option>
                <option value="production">Production</option>
              </Select>
            </FormField>

            <FormField
              label="Payer FID"
              name="payerFid"
              error={form.formState.errors.payerFid?.message}
              description="Numeric account id (payerFID) sent on every shipment."
            >
              <Input
                {...form.register('payerFid')}
                className="mono-text"
                placeholder="1495"
                invalid={Boolean(form.formState.errors.payerFid)}
              />
            </FormField>

            <FormField
              label="Master FID (optional)"
              name="masterFid"
              error={form.formState.errors.masterFid?.message}
              description="Only needed for multi-account DPD setups."
            >
              <Input
                {...form.register('masterFid')}
                className="mono-text"
                placeholder="1490"
                invalid={Boolean(form.formState.errors.masterFid)}
              />
            </FormField>
          </>
        ) : null}

        {stepIndex === 1 ? (
          <>
            <Alert tone="info" title="Sender address">
              Printed on every DPD label as the return / sender address. Polish postal format{' '}
              <span className="mono-text">NN-NNN</span>.
            </Alert>

            <FormField label="Company (optional)" name="senderCompany" error={form.formState.errors.senderCompany?.message}>
              <Input {...form.register('senderCompany')} placeholder="Sklep ACME" invalid={Boolean(form.formState.errors.senderCompany)} />
            </FormField>
            <FormField label="Contact name (optional)" name="senderName" error={form.formState.errors.senderName?.message}>
              <Input {...form.register('senderName')} placeholder="Magazyn główny" invalid={Boolean(form.formState.errors.senderName)} />
            </FormField>
            <FormField label="Address" name="senderAddress" error={form.formState.errors.senderAddress?.message}>
              <Input {...form.register('senderAddress')} placeholder="ul. Magazynowa 1" invalid={Boolean(form.formState.errors.senderAddress)} />
            </FormField>
            <FormField label="City" name="senderCity" error={form.formState.errors.senderCity?.message}>
              <Input {...form.register('senderCity')} placeholder="Warszawa" invalid={Boolean(form.formState.errors.senderCity)} />
            </FormField>
            <FormField
              label="Postal code"
              name="senderPostalCode"
              error={form.formState.errors.senderPostalCode?.message}
              description="PL format NN-NNN (e.g. 00-001)."
            >
              <Input {...form.register('senderPostalCode')} className="mono-text" placeholder="00-001" invalid={Boolean(form.formState.errors.senderPostalCode)} />
            </FormField>
            <FormField label="Country" name="senderCountryCode" error={form.formState.errors.senderCountryCode?.message} description="ISO 3166-1 alpha-2 (e.g. PL).">
              <Input {...form.register('senderCountryCode')} className="mono-text" placeholder="PL" maxLength={2} invalid={Boolean(form.formState.errors.senderCountryCode)} />
            </FormField>
            <FormField label="Phone (optional)" name="senderPhone" error={form.formState.errors.senderPhone?.message}>
              <Input {...form.register('senderPhone')} className="mono-text" placeholder="+48111222333" invalid={Boolean(form.formState.errors.senderPhone)} />
            </FormField>
            <FormField label="Email (optional)" name="senderEmail" error={form.formState.errors.senderEmail?.message}>
              <Input {...form.register('senderEmail')} placeholder="magazyn@acme.pl" invalid={Boolean(form.formState.errors.senderEmail)} />
            </FormField>
          </>
        ) : null}

        {stepIndex === 2 ? (
          <dl className="wizard-review-list">
            <dt>Name</dt>
            <dd>{values.name || '—'}</dd>
            <dt>Login</dt>
            <dd className="mono-text">{values.login || '—'}</dd>
            <dt>Environment</dt>
            <dd className="mono-text">{values.environment}</dd>
            <dt>Payer FID</dt>
            <dd className="mono-text">{values.payerFid || '—'}</dd>
            {values.masterFid ? (
              <>
                <dt>Master FID</dt>
                <dd className="mono-text">{values.masterFid}</dd>
              </>
            ) : null}
            <dt>Sender</dt>
            <dd>
              {[values.senderAddress, values.senderPostalCode, values.senderCity, values.senderCountryCode]
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

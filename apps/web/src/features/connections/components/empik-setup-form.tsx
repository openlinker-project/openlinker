/**
 * Empik Setup Form
 *
 * Two-step wizard for creating an Empik Marketplace connection:
 *   1. Credentials - connection name, the shop API key, the environment
 *      (Production or Staging, persisted as `config.environment`) and an
 *      optional shop id for a key that reaches several shops.
 *   2. Review & connect.
 *
 * Same shape as the Erli wizard without its sales-documents step, which is a
 * follow-up for Empik. Orders are accepted automatically (#4275); the
 * connection config `orderAcceptance` can turn that off and has no field here
 * yet. After a successful create the form offers "Test connection", which
 * calls the generic `/connections/:id/test` endpoint (the backend probes
 * Mirakl A01).
 *
 * The first step also says that offers need a shipping zone set up in the
 * Empik seller panel: Mirakl offers no API for it, and without one every offer
 * stays inactive.
 *
 * @module features/connections/components
 */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type Path } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { describeApiError } from '../../../shared/api/describe-api-error';
import { interpolate, renderRich, useFormat, useMessages } from '../../../shared/i18n';
import { usePlatform } from '../../../shared/plugins';
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
import type { ConnectionTestResult } from '../api/connections.types';
import { useCreateConnectionMutation } from '../hooks/use-create-connection-mutation';
import { useTestConnectionMutation } from '../hooks/use-test-connection-mutation';
import { describeConnectionTestFailure } from '../lib/describe-connection-test-failure';
import { EmpikSetupSummary } from './empik-setup-summary';
import {
  EMPIK_SETUP_DEFAULT_VALUES,
  empikSetupSchema,
  toCreateConnectionInput,
  type EmpikSetupFormSubmission,
  type EmpikSetupFormValues,
} from './empik-setup.schema';

// Seller API hosts, not prose: the same in every language.
const HOSTS = {
  production: 'https://marketplace.empik.com',
  staging: 'https://stg1.marketplace.empik.com',
} as const;

const STEP_FIELDS: ReadonlyArray<ReadonlyArray<Path<EmpikSetupFormValues>>> = [
  ['name', 'apiKey', 'environment', 'shopId'],
  [],
];

function maskSecret(secret: string): string {
  if (secret.length <= 4) return '•'.repeat(secret.length);
  return `${'•'.repeat(Math.max(0, secret.length - 4))}${secret.slice(-4)}`;
}

export function EmpikSetupForm(): ReactElement {
  const copy = useMessages('connections').empikSetupForm;
  const setupCopy = useMessages('connections').setup;
  const platform = usePlatform('empik')?.displayName ?? copy.platformFallback;
  const stepLabels = [copy.steps.credentials, copy.steps.review];
  const format = useFormat();
  const createConnection = useCreateConnectionMutation();
  const testConnection = useTestConnectionMutation();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [createdConnectionId, setCreatedConnectionId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<ReadonlySet<number>>(new Set());

  const form = useForm<EmpikSetupFormValues, undefined, EmpikSetupFormSubmission>({
    defaultValues: EMPIK_SETUP_DEFAULT_VALUES,
    resolver: zodResolver(empikSetupSchema),
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
    setStepIndex((i) => Math.min(i + 1, stepLabels.length - 1));
  }

  function goBack(): void {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  // Before the last step a submit (Enter in a field) means "Next": the review
  // step must be seen before anything is created.
  function handleFormSubmit(event: FormEvent<HTMLFormElement>): void {
    if (stepIndex < stepLabels.length - 1) {
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
        description: interpolate(copy.createdDescription, { platform, name: created.name }),
      });
    } catch {
      return;
    }
  });

  const onTest = async (): Promise<void> => {
    if (!createdConnectionId) return;
    setTestResult(null);
    try {
      setTestResult(await testConnection.mutateAsync(createdConnectionId));
    } catch {
      // surfaced via testConnection.error
    }
  };

  const values = form.watch();

  return (
    <WizardLayout
      stepper={<SetupStepper steps={stepLabels} currentStep={stepIndex} completedSteps={completedSteps} />}
      summary={<EmpikSetupSummary values={values} />}
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
            <Alert tone="info" title={copy.beforeYouStart.title}>
              {renderRich(copy.beforeYouStart.body, { strong: (text) => <strong>{text}</strong> }, { platform })}
            </Alert>
            <Alert tone="warning" title={copy.shippingZone.title}>
              {renderRich(copy.shippingZone.body, { strong: (text) => <strong>{text}</strong> })}
            </Alert>

            <FormField
              label={copy.fields.name.label}
              name="name"
              error={form.formState.errors.name?.message}
              description={interpolate(copy.fields.name.description, { platform })}
            >
              <Input
                {...form.register('name')}
                placeholder={interpolate(copy.fields.name.placeholder, { platform })}
                autoComplete="off"
                invalid={Boolean(form.formState.errors.name)}
              />
            </FormField>

            <FormField
              label={copy.fields.apiKey.label}
              name="apiKey"
              error={form.formState.errors.apiKey?.message}
              description={copy.fields.apiKey.description}
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
              label={copy.fields.environment.label}
              name="environment"
              error={form.formState.errors.environment?.message}
              description={copy.fields.environment.description}
            >
              <Select {...form.register('environment')}>
                <option value="production">
                  {interpolate(copy.fields.environment.option, { name: copy.environments.production, url: HOSTS.production })}
                </option>
                <option value="staging">
                  {interpolate(copy.fields.environment.option, { name: copy.environments.staging, url: HOSTS.staging })}
                </option>
              </Select>
            </FormField>

            <FormField
              label={copy.fields.shopId.label}
              name="shopId"
              error={form.formState.errors.shopId?.message}
              description={copy.fields.shopId.description}
            >
              <Input
                {...form.register('shopId')}
                inputMode="numeric"
                autoComplete="off"
                invalid={Boolean(form.formState.errors.shopId)}
              />
            </FormField>
          </>
        ) : null}

        {stepIndex === 1 ? (
          <dl className="wizard-review-list">
            <dt>{copy.review.name}</dt>
            <dd>{values.name || '-'}</dd>
            <dt>{copy.fields.apiKey.label}</dt>
            <dd className="mono-text">{values.apiKey ? maskSecret(values.apiKey) : '-'}</dd>
            <dt>{copy.fields.environment.label}</dt>
            <dd>{copy.environments[values.environment]}</dd>
            <dt>{copy.fields.shopId.label}</dt>
            <dd className="mono-text">{values.shopId?.trim() ? values.shopId : copy.review.defaultShop}</dd>
          </dl>
        ) : null}

        {createdConnectionId ? (
          <>
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
          </>
        ) : (
          <div className="wizard-actions">
            <div className="wizard-actions__group">
              {stepIndex > 0 ? (
                <Button tone="secondary" type="button" onClick={goBack}>
                  {setupCopy.back}
                </Button>
              ) : null}
            </div>
            <div className="wizard-actions__group">
              {stepIndex < stepLabels.length - 1 ? (
                <Button key="next" type="button" onClick={() => void goNext()}>
                  {setupCopy.next}
                </Button>
              ) : (
                <Button key="submit" type="submit" disabled={createConnection.isPending}>
                  {createConnection.isPending ? copy.connecting : interpolate(copy.connect, { platform })}
                </Button>
              )}
            </div>
          </div>
        )}
      </form>
    </WizardLayout>
  );
}

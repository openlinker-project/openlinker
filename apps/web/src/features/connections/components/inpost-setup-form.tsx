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
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
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
import { interpolate, renderRich, useMessages } from '../../../shared/i18n';
import { usePlatform } from '../../../shared/plugins';

// Analytics step names, kept in English so events stay comparable across languages.
const STEP_EVENT_IDS = ['Account & credentials', 'Sender address', 'Review & connect'] as const;

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
  const copy = useMessages('connections').inpostSetupForm;
  const setupCopy = useMessages('connections').setup;
  const platform = usePlatform('inpost')?.displayName ?? copy.platformFallback;
  const STEP_LABELS = [
    copy.steps.account,
    copy.steps.sender,
    copy.steps.review,
  ];
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

  return (
    <WizardLayout
      stepper={
        <SetupStepper steps={STEP_LABELS} currentStep={stepIndex} completedSteps={completedSteps} />
      }
      summary={
        <dl className="wizard-review-list">
          <dt>{copy.review.name}</dt>
          <dd>{values.name || '—'}</dd>
          <dt>{copy.fields.environment.label}</dt>
          <dd>{copy.environments[values.environment] ?? values.environment}</dd>
          <dt>{copy.fields.organizationId.label}</dt>
          <dd className="mono-text">{values.organizationId || '—'}</dd>
          <dt>{copy.review.sender}</dt>
          <dd>{values.senderCity ? `${values.senderCity}, ${values.senderCountryCode}` : '—'}</dd>
        </dl>
      }
    >
      <form className="wizard-card" onSubmit={handleFormSubmit} noValidate>
        <BackLink to="/connections/new" label={setupCopy.connections} className="wizard-card__back" />

        {form.formState.submitCount > 0 && validationMessages.length > 0 ? (
          <FormErrorSummary errors={validationMessages} />
        ) : null}
        {createConnection.error ? (
          <Alert tone="error" title={copy.createError}>
            {createConnection.error.message}
          </Alert>
        ) : null}

        {stepIndex === 0 ? (
          <>
            <Alert tone="info" title={copy.beforeYouStart.title}>
              {renderRich(
                copy.beforeYouStart.body,
                { strong: (text) => <strong>{text}</strong> },
                { platform },
              )}
            </Alert>

            <FormField label={copy.fields.name.label} name="name" error={form.formState.errors.name?.message}>
              <Input
                {...form.register('name')}
                placeholder={interpolate(copy.fields.name.placeholder, { platform })}
                invalid={Boolean(form.formState.errors.name)}
              />
            </FormField>

            <FormField
              label={copy.fields.apiToken.label}
              name="apiToken"
              error={form.formState.errors.apiToken?.message}
              description={copy.fields.apiToken.description}
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
              label={copy.fields.environment.label}
              name="environment"
              error={form.formState.errors.environment?.message}
            >
              <Select
                {...form.register('environment')}
                invalid={Boolean(form.formState.errors.environment)}
              >
                <option value="sandbox">{copy.environments.sandbox}</option>
                <option value="production">{copy.environments.production}</option>
              </Select>
            </FormField>

            <FormField
              label={copy.fields.organizationId.label}
              name="organizationId"
              error={form.formState.errors.organizationId?.message}
              description={copy.fields.organizationId.description}
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
            <Alert tone="info" title={copy.senderAddress.title}>
              {renderRich(copy.senderAddress.body, {
                mono: (text) => <span className="mono-text">{text}</span>,
              })}
            </Alert>

            <FormField label={copy.fields.senderName.label} name="senderName" error={form.formState.errors.senderName?.message}>
              <Input {...form.register('senderName')} placeholder={copy.fields.senderName.placeholder} invalid={Boolean(form.formState.errors.senderName)} />
            </FormField>
            <FormField label={copy.fields.senderEmail.label} name="senderEmail" error={form.formState.errors.senderEmail?.message}>
              <Input {...form.register('senderEmail')} placeholder={copy.fields.senderEmail.placeholder} invalid={Boolean(form.formState.errors.senderEmail)} />
            </FormField>
            <FormField label={copy.fields.senderPhone.label} name="senderPhone" error={form.formState.errors.senderPhone?.message}>
              <Input {...form.register('senderPhone')} className="mono-text" placeholder="+48111222333" invalid={Boolean(form.formState.errors.senderPhone)} />
            </FormField>
            <FormField label={copy.fields.senderStreet.label} name="senderStreet" error={form.formState.errors.senderStreet?.message}>
              <Input {...form.register('senderStreet')} placeholder={copy.fields.senderStreet.placeholder} invalid={Boolean(form.formState.errors.senderStreet)} />
            </FormField>
            <FormField label={copy.fields.senderBuildingNumber.label} name="senderBuildingNumber" error={form.formState.errors.senderBuildingNumber?.message}>
              <Input {...form.register('senderBuildingNumber')} className="mono-text" placeholder="1" invalid={Boolean(form.formState.errors.senderBuildingNumber)} />
            </FormField>
            <FormField label={copy.fields.senderCity.label} name="senderCity" error={form.formState.errors.senderCity?.message}>
              <Input {...form.register('senderCity')} placeholder={copy.fields.senderCity.placeholder} invalid={Boolean(form.formState.errors.senderCity)} />
            </FormField>
            <FormField
              label={copy.fields.senderPostCode.label}
              name="senderPostCode"
              error={form.formState.errors.senderPostCode?.message}
              description={copy.fields.senderPostCode.description}
            >
              <Input {...form.register('senderPostCode')} className="mono-text" placeholder="00-001" invalid={Boolean(form.formState.errors.senderPostCode)} />
            </FormField>
            <FormField label={copy.fields.senderCountryCode.label} name="senderCountryCode" error={form.formState.errors.senderCountryCode?.message} description={copy.fields.senderCountryCode.description}>
              <Input {...form.register('senderCountryCode')} className="mono-text" placeholder="PL" maxLength={2} invalid={Boolean(form.formState.errors.senderCountryCode)} />
            </FormField>
          </>
        ) : null}

        {stepIndex === 2 ? (
          <dl className="wizard-review-list">
            <dt>{copy.review.name}</dt>
            <dd>{values.name || '—'}</dd>
            <dt>{copy.fields.environment.label}</dt>
            <dd>{copy.environments[values.environment] ?? values.environment}</dd>
            <dt>{copy.fields.organizationId.label}</dt>
            <dd className="mono-text">{values.organizationId || '—'}</dd>
            <dt>{copy.review.sender}</dt>
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

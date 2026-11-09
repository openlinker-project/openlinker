/**
 * Allegro Setup Form
 *
 * Multi-step wizard for creating an Allegro connection. Steps:
 *   1. Credentials — connection name, client ID, client secret
 *   2. Environment — sandbox vs production
 *   3. Product catalog — link to an existing ProductMaster connection
 *      (required when at least one ProductMaster connection exists, per the
 *      style guide; the current form lets operators skip it but we still
 *      surface the relationship explicitly on this step)
 *   4. Sales documents — how delivery appears on receipts and invoices
 *      (skipped when re-authenticating an existing connection)
 *   5. OAuth redirect — final review; submit redirects to Allegro's consent
 *      screen so the access token can come back through the callback page
 */
import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type Path } from 'react-hook-form';
import { useStartAllegroOAuthMutation } from '../hooks/use-start-allegro-oauth-mutation';
import { useProductMasterConnections } from '../../connections';
import {
  createAllegroSetupSchema,
  ALLEGRO_SETUP_DEFAULT_VALUES,
  toStartOAuthInput,
  type AllegroSetupFormSubmission,
  type AllegroSetupFormValues,
} from './allegro-setup.schema';
import { AllegroSetupSummary } from './allegro-setup-summary';
import {
  DEFAULT_DELIVERY_WIZARD_VALUE,
  DeliveryWizardStep,
  useDeliveryLineSuggestionsQuery,
  wizardRules,
  wizardSummaryRows,
} from '../../delivery-on-documents';
import { Alert } from '../../../shared/ui/alert';
import { BackLink } from '../../../shared/ui/back-link';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { SetupStepper } from '../../../shared/ui/setup-stepper';
import { WizardLayout } from '../../../shared/ui/wizard-layout';
import { interpolate, renderRich, useMessages } from '../../../shared/i18n';
import { usePlatform } from '../../../shared/plugins';

const STEP_COUNT = 5;

const SALES_DOCUMENTS_STEP = 3;

const STEP_FIELDS: ReadonlyArray<ReadonlyArray<Path<AllegroSetupFormValues>>> = [
  ['name', 'clientId', 'clientSecret'],
  ['environment'],
  ['masterCatalogConnectionId'],
  [],
  [],
];

function maskSecret(secret: string): string {
  if (secret.length <= 4) return '•'.repeat(secret.length);
  return `${'•'.repeat(Math.max(0, secret.length - 4))}${secret.slice(-4)}`;
}

export function AllegroSetupForm(): ReactElement {
  const [searchParams] = useSearchParams();
  // When present, this OAuth run re-authenticates an existing connection in
  // place (rotating its credentials, clearing needs_reauth) instead of minting
  // a new one (#819).
  const reauthConnectionId = searchParams.get('reauth') ?? undefined;
  const startOAuth = useStartAllegroOAuthMutation();
  const copy = useMessages('allegro-core').allegroSetupForm;
  const schemaCopy = useMessages('allegro-core').allegroSetupSchema;
  const schema = useMemo(() => createAllegroSetupSchema(schemaCopy), [schemaCopy]);
  const platform = usePlatform('allegro')?.displayName ?? copy.fallbackPlatform;
  const stepLabels = [
    copy.steps.credentials,
    copy.steps.environment,
    copy.steps.productCatalogue,
    copy.steps.salesDocuments,
    copy.steps.review,
  ];
  const strong = { strong: (text: string) => <strong>{text}</strong> };
  const { connectionsQuery, productMasterConnections, autoSelectedConnectionId } =
    useProductMasterConnections();
  const form = useForm<AllegroSetupFormValues, undefined, AllegroSetupFormSubmission>({
    defaultValues: ALLEGRO_SETUP_DEFAULT_VALUES,
    resolver: zodResolver(schema),
    mode: 'onBlur',
  });

  const suggestionsQuery = useDeliveryLineSuggestionsQuery();
  const suggestions = suggestionsQuery.data?.suggestions ?? [];

  const [stepIndex, setStepIndex] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<ReadonlySet<number>>(new Set());

  useEffect(() => {
    if (autoSelectedConnectionId) {
      form.setValue('masterCatalogConnectionId', autoSelectedConnectionId);
    }
  }, [autoSelectedConnectionId, form]);

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
    error?.message ? [String(error.message)] : []
  );

  async function goNext(): Promise<void> {
    const fields = STEP_FIELDS[stepIndex];
    if (fields.length > 0) {
      const valid = await form.trigger([...fields]);
      if (!valid) return;
    }
    const target = nextStep(stepIndex + 1, 1);
    setCompletedSteps((prev) => {
      const done = new Set(prev).add(stepIndex);
      // A stepped-over step reads as done, not as a gap in the stepper.
      if (target > stepIndex + 1) done.add(stepIndex + 1);
      return done;
    });
    setStepIndex(target);
  }

  function goBack(): void {
    setStepIndex((i) => nextStep(i - 1, -1));
  }

  // Re-authenticating rotates credentials only, so it has no sales-documents
  // question to ask: the step is stepped over in both directions (#3911).
  function nextStep(candidate: number, direction: 1 | -1): number {
    const bounded = Math.min(Math.max(candidate, 0), STEP_COUNT - 1);
    return reauthConnectionId && bounded === SALES_DOCUMENTS_STEP ? bounded + direction : bounded;
  }

  // A submit before the last step is Enter in a field, or the click that
  // advanced to the last step landing on the Create button that replaced Next.
  // Either way it means "Next", never "Create" (the review step must be seen).
  function handleFormSubmit(event: FormEvent<HTMLFormElement>): void {
    if (stepIndex < STEP_COUNT - 1) {
      event.preventDefault();
      void goNext();
      return;
    }
    void onSubmit(event);
  }

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const redirectUri = `${window.location.origin}/integrations/allegro/connect/callback`;
      const { authorizationUrl } = await startOAuth.mutateAsync(
        toStartOAuthInput(values, redirectUri, reauthConnectionId, suggestions)
      );
      // Clear the dirty flag so abandon-prevention doesn't pop a native
      // "leave page?" confirm when we navigate to Allegro's consent screen.
      form.reset(values, { keepValues: true, keepDirty: false });
      window.location.assign(authorizationUrl);
    } catch {
      return;
    }
  });

  const values = form.watch();
  const deliveryValue = values.deliveryOnDocuments ?? DEFAULT_DELIVERY_WIZARD_VALUE;
  const deliverySummary = wizardSummaryRows(wizardRules(deliveryValue, suggestions))
    .map((row) => `${row.label}: ${row.value}`)
    .join('; ');
  const redirectUri = `${window.location.origin}/integrations/allegro/connect/callback`;
  const selectedCatalog = productMasterConnections.find(
    (c) => c.id === values.masterCatalogConnectionId
  );

  return (
    <WizardLayout
      stepper={
        <SetupStepper steps={stepLabels} currentStep={stepIndex} completedSteps={completedSteps} />
      }
      summary={
        <AllegroSetupSummary
          values={values}
          stepIndex={stepIndex}
          selectedCatalogName={selectedCatalog?.name ?? null}
          suggestions={suggestions}
          showDelivery={!reauthConnectionId}
        />
      }
    >
      <form className="wizard-card" onSubmit={handleFormSubmit} noValidate>
        <BackLink to="/connections/new" label={copy.backLabel} className="wizard-card__back" />

        {reauthConnectionId ? (
          <Alert tone="warning" title={copy.reauth.title}>
            {renderRich(copy.reauth.body, strong, { platform })}
          </Alert>
        ) : null}
        {form.formState.submitCount > 0 && validationMessages.length > 0 ? (
          <FormErrorSummary errors={validationMessages} />
        ) : null}
        {startOAuth.error ? (
          <Alert tone="error" title={copy.startFailed}>
            {startOAuth.error.message}
          </Alert>
        ) : null}

        {stepIndex === 0 ? (
          <>
            <Alert tone="info" title={copy.beforeYouStart.title}>
              {renderRich(
                copy.beforeYouStart.body,
                {
                  link: (text) => (
                    <a href="https://developer.allegro.pl/" target="_blank" rel="noreferrer noopener">
                      {text}
                    </a>
                  ),
                  uri: (text) => <span className="mono-text">{text}</span>,
                },
                { platform, redirectUri },
              )}
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
                invalid={Boolean(form.formState.errors.name)}
              />
            </FormField>

            <FormField
              label={copy.fields.clientId.label}
              name="clientId"
              error={form.formState.errors.clientId?.message}
              description={interpolate(copy.fields.clientId.description, { platform })}
            >
              <Input
                {...form.register('clientId')}
                placeholder={copy.fields.clientId.placeholder}
                invalid={Boolean(form.formState.errors.clientId)}
                autoComplete="off"
              />
            </FormField>

            <FormField
              label={copy.fields.clientSecret.label}
              name="clientSecret"
              error={form.formState.errors.clientSecret?.message}
              description={interpolate(copy.fields.clientSecret.description, { platform })}
            >
              <Input
                {...form.register('clientSecret')}
                type="password"
                placeholder={copy.fields.clientSecret.placeholder}
                invalid={Boolean(form.formState.errors.clientSecret)}
                autoComplete="off"
              />
            </FormField>
          </>
        ) : null}

        {stepIndex === 1 ? (
          <>
            <Alert tone="info" title={copy.environmentInfo.title}>
              {interpolate(copy.environmentInfo.body, { platform })}
            </Alert>
            <FormField
              label={copy.fields.environment}
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
          </>
        ) : null}

        {stepIndex === 2 ? (
          <>
            <Alert tone="info" title={copy.catalogueInfo.title}>
              {interpolate(copy.catalogueInfo.body, { platform })}
            </Alert>
            <FormField
              label={copy.fields.catalogue.label}
              name="masterCatalogConnectionId"
              error={form.formState.errors.masterCatalogConnectionId?.message}
              description={copy.fields.catalogue.description}
            >
              {connectionsQuery.isLoading ? (
                <Select disabled>
                  <option>{copy.fields.catalogue.loading}</option>
                </Select>
              ) : connectionsQuery.error ? (
                <Select disabled>
                  <option>{copy.fields.catalogue.failed}</option>
                </Select>
              ) : (
                <Select
                  {...form.register('masterCatalogConnectionId')}
                  invalid={Boolean(form.formState.errors.masterCatalogConnectionId)}
                >
                  <option value="">{copy.none}</option>
                  {productMasterConnections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          </>
        ) : null}

        {stepIndex === SALES_DOCUMENTS_STEP ? (
          <DeliveryWizardStep
            value={deliveryValue}
            suggestions={suggestions}
            onChange={(next) =>
              form.setValue('deliveryOnDocuments', next, { shouldDirty: true })
            }
          />
        ) : null}

        {stepIndex === 4 ? (
          <>
            <dl className="wizard-review-list">
              <dt>{copy.review.name}</dt>
              <dd>{values.name || copy.review.empty}</dd>
              <dt>{copy.fields.clientId.label}</dt>
              <dd className="mono-text">{values.clientId || copy.review.empty}</dd>
              <dt>{copy.fields.clientSecret.label}</dt>
              <dd className="mono-text">
                {values.clientSecret ? maskSecret(values.clientSecret) : copy.review.empty}
              </dd>
              <dt>{copy.fields.environment}</dt>
              <dd>
                {values.environment === 'production'
                  ? copy.environments.production
                  : copy.environments.sandbox}
              </dd>
              <dt>{copy.steps.productCatalogue}</dt>
              <dd>{selectedCatalog ? selectedCatalog.name : copy.none}</dd>
              {reauthConnectionId ? null : (
                <>
                  <dt>{copy.review.delivery}</dt>
                  <dd>{deliverySummary}</dd>
                </>
              )}
            </dl>
            <p className="muted-text panel-copy">
              {renderRich(
                copy.review.redirectNote,
                { ...strong, uri: (text) => <span className="mono-text">{text}</span> },
                { platform, redirectUri },
              )}
            </p>
          </>
        ) : null}

        <div className="wizard-actions">
          <div className="wizard-actions__group">
            {stepIndex > 0 ? (
              <Button tone="secondary" type="button" onClick={goBack}>
                {copy.back}
              </Button>
            ) : null}
          </div>
          <div className="wizard-actions__group">
            {stepIndex < STEP_COUNT - 1 ? (
              <Button key="next" type="button" onClick={() => void goNext()}>
                {copy.next}
              </Button>
            ) : (
              <Button key="submit" type="submit" disabled={startOAuth.isPending}>
                {startOAuth.isPending ? copy.connecting : interpolate(copy.connect, { platform })}
              </Button>
            )}
          </div>
        </div>
      </form>
    </WizardLayout>
  );
}

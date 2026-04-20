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
 *   4. OAuth redirect — final review; submit redirects to Allegro's consent
 *      screen so the access token can come back through the callback page
 */
import { useEffect, useState, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type Path } from 'react-hook-form';
import { useStartAllegroOAuthMutation } from '../hooks/use-start-allegro-oauth-mutation';
import { useProductMasterConnections } from '../../connections/hooks/use-product-master-connections';
import {
  allegroSetupSchema,
  ALLEGRO_SETUP_DEFAULT_VALUES,
  toStartOAuthInput,
  type AllegroSetupFormSubmission,
  type AllegroSetupFormValues,
} from './allegro-setup.schema';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { SetupStepper } from '../../../shared/ui/setup-stepper';

const STEP_LABELS = ['Credentials', 'Environment', 'Product catalog', 'Review & connect'] as const;

const STEP_FIELDS: ReadonlyArray<ReadonlyArray<Path<AllegroSetupFormValues>>> = [
  ['name', 'clientId', 'clientSecret'],
  ['environment'],
  ['masterCatalogConnectionId'],
  [],
];

function maskSecret(secret: string): string {
  if (secret.length <= 4) return '•'.repeat(secret.length);
  return `${'•'.repeat(Math.max(0, secret.length - 4))}${secret.slice(-4)}`;
}

export function AllegroSetupForm(): ReactElement {
  const startOAuth = useStartAllegroOAuthMutation();
  const { connectionsQuery, productMasterConnections, autoSelectedConnectionId } =
    useProductMasterConnections();
  const form = useForm<AllegroSetupFormValues, undefined, AllegroSetupFormSubmission>({
    defaultValues: ALLEGRO_SETUP_DEFAULT_VALUES,
    resolver: zodResolver(allegroSetupSchema),
    mode: 'onBlur',
  });

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
      const redirectUri = `${window.location.origin}/integrations/allegro/connect/callback`;
      const { authorizationUrl } = await startOAuth.mutateAsync(
        toStartOAuthInput(values, redirectUri),
      );
      window.location.assign(authorizationUrl);
    } catch {
      return;
    }
  });

  const values = form.watch();
  const redirectUri = `${window.location.origin}/integrations/allegro/connect/callback`;
  const selectedCatalog = productMasterConnections.find(
    (c) => c.id === values.masterCatalogConnectionId,
  );

  return (
    <form className="wizard-card" onSubmit={(event) => void onSubmit(event)} noValidate>
      <SetupStepper steps={STEP_LABELS} currentStep={stepIndex} completedSteps={completedSteps} />

      {form.formState.submitCount > 0 && validationMessages.length > 0 ? (
        <FormErrorSummary errors={validationMessages} />
      ) : null}
      {startOAuth.error ? (
        <Alert tone="error" title="Failed to start authorization">
          {startOAuth.error.message}
        </Alert>
      ) : null}

      {stepIndex === 0 ? (
        <>
          <FormField
            label="Connection name"
            name="name"
            error={form.formState.errors.name?.message}
            description="A label for this Allegro integration in OpenLinker."
          >
            <Input
              {...form.register('name')}
              placeholder="Allegro sandbox"
              invalid={Boolean(form.formState.errors.name)}
            />
          </FormField>

          <FormField
            label="Client ID"
            name="clientId"
            error={form.formState.errors.clientId?.message}
            description="OAuth client ID from your Allegro developer app."
          >
            <Input
              {...form.register('clientId')}
              placeholder="your-allegro-client-id"
              invalid={Boolean(form.formState.errors.clientId)}
              autoComplete="off"
            />
          </FormField>

          <FormField
            label="Client secret"
            name="clientSecret"
            error={form.formState.errors.clientSecret?.message}
            description="OAuth client secret from your Allegro developer app."
          >
            <Input
              {...form.register('clientSecret')}
              type="password"
              placeholder="your-allegro-client-secret"
              invalid={Boolean(form.formState.errors.clientSecret)}
              autoComplete="off"
            />
          </FormField>
        </>
      ) : null}

      {stepIndex === 1 ? (
        <>
          <Alert tone="info" title="Pick the right environment">
            Sandbox is a separate Allegro tenant for testing. Production credentials will not work
            in sandbox and vice versa.
          </Alert>
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
        </>
      ) : null}

      {stepIndex === 2 ? (
        <>
          <Alert tone="info" title="Link the product catalog">
            OpenLinker links Allegro offers to products through barcodes on your ProductMaster
            connection. Select the shop whose catalog should resolve those barcodes.
          </Alert>
          <FormField
            label="Product catalog connection"
            name="masterCatalogConnectionId"
            error={form.formState.errors.masterCatalogConnectionId?.message}
            description="Select the ProductMaster connection to use for offer-product barcode linking. You can configure this later if you are still setting up the PrestaShop side."
          >
            {connectionsQuery.isLoading ? (
              <Select disabled>
                <option>Loading connections…</option>
              </Select>
            ) : connectionsQuery.error ? (
              <Select disabled>
                <option>Failed to load connections</option>
              </Select>
            ) : (
              <Select
                {...form.register('masterCatalogConnectionId')}
                invalid={Boolean(form.formState.errors.masterCatalogConnectionId)}
              >
                <option value="">None (configure later)</option>
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

      {stepIndex === 3 ? (
        <>
          <dl className="wizard-review-list">
            <dt>Name</dt>
            <dd>{values.name || '—'}</dd>
            <dt>Client ID</dt>
            <dd className="mono-text">{values.clientId || '—'}</dd>
            <dt>Client secret</dt>
            <dd className="mono-text">
              {values.clientSecret ? maskSecret(values.clientSecret) : '—'}
            </dd>
            <dt>Environment</dt>
            <dd>{values.environment === 'production' ? 'Production' : 'Sandbox'}</dd>
            <dt>Product catalog</dt>
            <dd>{selectedCatalog ? selectedCatalog.name : 'None (configure later)'}</dd>
          </dl>
          <p className="muted-text panel-copy">
            After clicking <strong>Connect with Allegro</strong>, you will be redirected to Allegro
            to authorize this connection. Make sure your Allegro app has{' '}
            <span className="mono-text">{redirectUri}</span> registered as a redirect URI.
          </p>
        </>
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
            <Button type="submit" disabled={startOAuth.isPending}>
              {startOAuth.isPending ? 'Connecting…' : 'Connect with Allegro'}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}

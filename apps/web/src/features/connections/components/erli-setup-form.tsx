/**
 * Erli Setup Form
 *
 * Single-step wizard for creating an Erli connection. Collects:
 *   - Connection name
 *   - Shop API key (the only credential — sent as a Bearer token by the BE)
 *   - Optional advanced base URL override (config)
 *
 * Simpler than the WooCommerce form — one credential, no capabilities step
 * (capabilities default silently to the adapter manifest's supported set on
 * the omitted path). After a successful create the form surfaces a
 * "Test connection" affordance that calls the generic `/connections/:id/test`
 * endpoint and renders the `ConnectionTestResult`. Abandon-prevention triggers
 * a native confirm dialog when the form is dirty and the tab is closed.
 *
 * @module features/connections/components
 */
import { useEffect, useState, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useCreateConnectionMutation } from '../hooks/use-create-connection-mutation';
import { useTestConnectionMutation } from '../hooks/use-test-connection-mutation';
import type { ConnectionTestResult } from '../api/connections.types';
import {
  ERLI_SETUP_DEFAULT_VALUES,
  erliSetupSchema,
  toCreateConnectionInput,
  type ErliSetupFormSubmission,
  type ErliSetupFormValues,
} from './erli-setup.schema';
import { Alert } from '../../../shared/ui/alert';
import { BackLink } from '../../../shared/ui/back-link';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { useToast } from '../../../shared/ui/toast-provider';

export function ErliSetupForm(): ReactElement {
  const createConnection = useCreateConnectionMutation();
  const testConnection = useTestConnectionMutation();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [createdConnectionId, setCreatedConnectionId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  const form = useForm<ErliSetupFormValues, undefined, ErliSetupFormSubmission>({
    defaultValues: ERLI_SETUP_DEFAULT_VALUES,
    resolver: zodResolver(erliSetupSchema),
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

  const validationMessages = Object.values(form.formState.errors).flatMap((error) =>
    error?.message ? [String(error.message)] : [],
  );

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const created = await createConnection.mutateAsync(toCreateConnectionInput(values));
      form.reset(values, { keepValues: true, keepDirty: false });
      setCreatedConnectionId(created.id);
      showToast({
        tone: 'success',
        title: 'Connection created',
        description: `Erli connection "${created.name}" was created.`,
      });
    } catch {
      return;
    }
  });

  const onTest = async (): Promise<void> => {
    if (!createdConnectionId) return;
    try {
      const result = await testConnection.mutateAsync(createdConnectionId);
      setTestResult(result);
    } catch {
      // surfaced via testConnection.error
    }
  };

  return (
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

      <Alert tone="info" title="Before you start">
        In your Erli seller panel, generate a <strong>Shop API key</strong>. OpenLinker sends it as a
        bearer token on every request to the Erli Shop API. The key is stored securely on the server
        and only shown once.
      </Alert>

      <FormField
        label="Connection name"
        name="name"
        error={form.formState.errors.name?.message}
        description="A label to identify this Erli account in OpenLinker."
      >
        <Input
          {...form.register('name')}
          placeholder="My Erli Store"
          autoComplete="off"
          invalid={Boolean(form.formState.errors.name)}
        />
      </FormField>

      <FormField
        label="API key"
        name="apiKey"
        error={form.formState.errors.apiKey?.message}
        description="Your Erli Shop API key — generated in the Erli seller panel."
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
        label="Base URL (optional)"
        name="baseUrl"
        error={form.formState.errors.baseUrl?.message}
        description="Advanced — override the default Erli API base URL. Must use HTTPS. Leave blank to use the default."
      >
        <Input
          {...form.register('baseUrl')}
          className="mono-text"
          placeholder="https://api.erli.pl"
          autoComplete="off"
          invalid={Boolean(form.formState.errors.baseUrl)}
        />
      </FormField>

      {createdConnectionId ? (
        <>
          {testResult ? (
            <Alert
              tone={testResult.success ? 'success' : 'error'}
              title={testResult.success ? 'Connection test passed' : 'Connection test failed'}
            >
              {testResult.message}
              {typeof testResult.latencyMs === 'number' ? ` (${testResult.latencyMs}ms)` : null}
            </Alert>
          ) : null}
          {testConnection.error ? (
            <Alert tone="error" title="Unable to test connection">
              {testConnection.error.message}
            </Alert>
          ) : null}
          <div className="form-actions">
            <Button type="button" onClick={() => void onTest()} disabled={testConnection.isPending}>
              {testConnection.isPending ? 'Testing…' : 'Test connection'}
            </Button>
            <Button tone="secondary" type="button" onClick={() => void navigate('/connections')}>
              Done
            </Button>
          </div>
        </>
      ) : (
        <div className="form-actions">
          <Button type="submit" disabled={createConnection.isPending}>
            {createConnection.isPending ? 'Connecting…' : 'Connect Erli'}
          </Button>
        </div>
      )}
    </form>
  );
}

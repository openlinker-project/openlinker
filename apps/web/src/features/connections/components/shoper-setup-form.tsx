/**
 * Shoper Setup Form
 *
 * Single-step wizard for creating a Shoper connection. Collects the connection
 * name, the shop host (`baseUrl`) and the API token (the only credential).
 * After a successful create the form surfaces a "Test connection" affordance
 * that calls the generic `/connections/:id/test` endpoint and renders the
 * `ConnectionTestResult`. Mirrors `ErliSetupForm`.
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
  SHOPER_SETUP_DEFAULT_VALUES,
  shoperSetupSchema,
  toCreateConnectionInput,
  type ShoperSetupFormSubmission,
  type ShoperSetupFormValues,
} from './shoper-setup.schema';
import { Alert } from '../../../shared/ui/alert';
import { BackLink } from '../../../shared/ui/back-link';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { useToast } from '../../../shared/ui/toast-provider';

export function ShoperSetupForm(): ReactElement {
  const createConnection = useCreateConnectionMutation();
  const testConnection = useTestConnectionMutation();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [createdConnectionId, setCreatedConnectionId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  const form = useForm<ShoperSetupFormValues, undefined, ShoperSetupFormSubmission>({
    defaultValues: SHOPER_SETUP_DEFAULT_VALUES,
    resolver: zodResolver(shoperSetupSchema),
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
        description: `Shoper connection "${created.name}" was created.`,
      });
    } catch {
      return;
    }
  });

  const onTest = async (): Promise<void> => {
    if (!createdConnectionId) return;
    // Clear any prior result first so a re-test that rejects cannot render a
    // stale result beside the "unable to test" error.
    setTestResult(null);
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
        In your Shoper admin panel open <strong>Dodaj integrację</strong> and create an
        integration. Shoper issues a <strong>Token API</strong>; OpenLinker sends it as a bearer
        token on every request. Grant the integration access to: produkty, warianty produktów,
        stany dostępności, kategorie, stawki vat, magazyny, zamówienia, przesyłki, statusy
        zamówień, klienci, webhooki, dostawy and płatności.
      </Alert>

      <FormField
        label="Connection name"
        name="name"
        error={form.formState.errors.name?.message}
        description="A label to identify this Shoper shop in OpenLinker."
      >
        <Input
          {...form.register('name')}
          placeholder="My Shoper Store"
          autoComplete="off"
          invalid={Boolean(form.formState.errors.name)}
        />
      </FormField>

      <FormField
        label="Shop address"
        name="baseUrl"
        error={form.formState.errors.baseUrl?.message}
        description="Your shop's host name, e.g. xxxxx.shoparena.pl. HTTPS only, no path."
      >
        <Input
          {...form.register('baseUrl')}
          placeholder="xxxxx.shoparena.pl"
          autoComplete="off"
          invalid={Boolean(form.formState.errors.baseUrl)}
        />
      </FormField>

      <FormField
        label="API token"
        name="token"
        error={form.formState.errors.token?.message}
        description="The Token API issued by the Shoper admin panel. Stored securely on the server."
      >
        <Input
          {...form.register('token')}
          type="password"
          placeholder="••••••••••••••••••••••••••••••••"
          autoComplete="off"
          invalid={Boolean(form.formState.errors.token)}
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
            {createConnection.isPending ? 'Connecting…' : 'Connect Shoper'}
          </Button>
        </div>
      )}
    </form>
  );
}

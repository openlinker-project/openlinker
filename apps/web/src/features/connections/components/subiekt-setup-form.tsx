/**
 * Subiekt Setup Form
 *
 * Single-step guided wizard for creating a Subiekt nexo connection (#1199).
 * Collects:
 *   - Connection name
 *   - Bridge base URL (the OpenLinker Sfera bridge, a LAN service — http allowed)
 *   - Optional request timeout (advanced)
 *   - Optional shared bridge token (only for a secured bridge)
 *
 * After a successful create the form surfaces a "Test connection" affordance
 * that calls the generic `/connections/:id/test` endpoint (backed by
 * `SubiektConnectionTesterAdapter`, which probes the bridge health) and renders
 * the `ConnectionTestResult`. Abandon-prevention triggers a native confirm
 * dialog when the form is dirty and the tab is closed before creation.
 *
 * The bridge token is write-only: it is never read back into form state or
 * rendered after submit, and never appears in the ConnectionTestResult.
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
  SUBIEKT_SETUP_DEFAULT_VALUES,
  subiektSetupSchema,
  toCreateConnectionInput,
  type SubiektSetupFormSubmission,
  type SubiektSetupFormValues,
} from './subiekt-setup.schema';
import { Alert } from '../../../shared/ui/alert';
import { BackLink } from '../../../shared/ui/back-link';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { useToast } from '../../../shared/ui/toast-provider';

export function SubiektSetupForm(): ReactElement {
  const createConnection = useCreateConnectionMutation();
  const testConnection = useTestConnectionMutation();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [createdConnectionId, setCreatedConnectionId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  const form = useForm<SubiektSetupFormValues, undefined, SubiektSetupFormSubmission>({
    defaultValues: SUBIEKT_SETUP_DEFAULT_VALUES,
    resolver: zodResolver(subiektSetupSchema),
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
        description: `Subiekt connection "${created.name}" was created.`,
      });
    } catch {
      return;
    }
  });

  const onTest = async (): Promise<void> => {
    if (!createdConnectionId) return;
    // Clear any prior result first: otherwise a re-test that rejects would render
    // a stale resolved-result Alert alongside the "unable to test" error Alert.
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
        Run the OpenLinker <strong>Sfera bridge</strong> on the Windows machine where Subiekt nexo
        is installed, then paste the bridge URL below. OpenLinker talks to Subiekt only through that
        bridge to issue invoices — it never connects to Subiekt directly.
      </Alert>

      <FormField
        label="Connection name"
        name="name"
        error={form.formState.errors.name?.message}
        description="A label to identify this Subiekt account in OpenLinker."
      >
        <Input
          {...form.register('name')}
          placeholder="My Subiekt"
          autoComplete="off"
          invalid={Boolean(form.formState.errors.name)}
        />
      </FormField>

      <FormField
        label="Bridge URL"
        name="bridgeBaseUrl"
        error={form.formState.errors.bridgeBaseUrl?.message}
        description="The OpenLinker Sfera bridge address. Usually a LAN address — http is allowed (e.g. http://127.0.0.1:5000)."
      >
        <Input
          {...form.register('bridgeBaseUrl')}
          className="mono-text"
          placeholder="http://127.0.0.1:5000"
          autoComplete="off"
          invalid={Boolean(form.formState.errors.bridgeBaseUrl)}
        />
      </FormField>

      <FormField
        label="Request timeout (ms, optional)"
        name="timeoutMs"
        error={form.formState.errors.timeoutMs?.message}
        description="Advanced — how long OpenLinker waits for the bridge before giving up. Between 1000 and 120000 ms. Leave blank for the bridge default."
      >
        <Input
          {...form.register('timeoutMs')}
          inputMode="numeric"
          placeholder="30000"
          autoComplete="off"
          invalid={Boolean(form.formState.errors.timeoutMs)}
        />
      </FormField>

      <FormField
        label="Bridge token (optional)"
        name="bridgeToken"
        error={form.formState.errors.bridgeToken?.message}
        description="Advanced — only if your bridge is secured with a shared token. Leave blank for an unauthenticated LAN bridge. Stored securely on the server and never shown again."
      >
        <Input
          {...form.register('bridgeToken')}
          type="password"
          placeholder="••••••••••••••••"
          autoComplete="off"
          invalid={Boolean(form.formState.errors.bridgeToken)}
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
            {createConnection.isPending ? 'Connecting…' : 'Connect Subiekt'}
          </Button>
        </div>
      )}
    </form>
  );
}

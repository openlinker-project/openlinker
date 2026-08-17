/**
 * eparagony.pl Setup Form (#1911)
 *
 * Guided wizard for creating an eparagony.pl (Fiscalization) connection.
 * Three things this surface must get right, per ADR-042 and the issue's
 * acceptance criteria:
 *
 *   1. Preconditions are named up front, and the panel is honest about which
 *      it can and cannot check. The device-configured-for-e-receipts step is
 *      never OpenLinker's to verify - it is a `serwisant` job - and the
 *      sandbox reports every device as a constant `INACTIVE` stub, so a
 *      "reachable" check there would be misleading, not merely unavailable.
 *   2. A failed save is diagnosable per FIELD, not just "save failed" - the
 *      shape validators return `{ message, errors: [{ path, message }] }`
 *      (docs/architecture-overview.md - connection config/credentials shape
 *      validation), and this form maps that onto the matching `FormField`.
 *   3. Copy never implies a legal receipt obligation or that connecting
 *      makes the seller compliant (spec risk R5), and never promises
 *      automatic registration - v1 registers only on an explicit operator
 *      action on the order (#1908, #1909).
 *
 * @module features/connections/components
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useCreateConnectionMutation } from '../hooks/use-create-connection-mutation';
import { useTestConnectionMutation } from '../hooks/use-test-connection-mutation';
import type { ConnectionTestResult } from '../api/connections.types';
import { ApiError } from '../../../shared/api/api-error';
import {
  EPARAGONY_SETUP_DEFAULT_VALUES,
  eparagonySetupSchema,
  toCreateConnectionInput,
  type EparagonySetupFormSubmission,
  type EparagonySetupFormValues,
} from './eparagony-setup.schema';
import { Alert } from '../../../shared/ui/alert';
import { BackLink } from '../../../shared/ui/back-link';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { useToast } from '../../../shared/ui/toast-provider';

interface FlatValidationIssue {
  path: string;
  message: string;
}

/** Maps a shape-validator 400's `{ message, errors }` body onto the field(s)
 *  it names. Unknown paths and non-structured errors fall through to the
 *  top-level Alert instead of being silently dropped. */
function resolveFieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || typeof error.details !== 'object' || error.details === null) {
    return {};
  }
  const body = error.details as { errors?: unknown };
  if (!Array.isArray(body.errors)) {
    return {};
  }
  const byField: Record<string, string> = {};
  for (const issue of body.errors as FlatValidationIssue[]) {
    if (typeof issue?.path === 'string' && typeof issue?.message === 'string') {
      byField[issue.path] = issue.message;
    }
  }
  return byField;
}

export function EparagonySetupForm(): ReactElement {
  const createConnection = useCreateConnectionMutation();
  const testConnection = useTestConnectionMutation();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [createdConnectionId, setCreatedConnectionId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  const form = useForm<EparagonySetupFormValues, undefined, EparagonySetupFormSubmission>({
    defaultValues: EPARAGONY_SETUP_DEFAULT_VALUES,
    resolver: zodResolver(eparagonySetupSchema),
    mode: 'onBlur',
  });

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

  // Server-side, per-field diagnosis (#1911 AC): a shape-validation 400 names
  // WHICH field or precondition is the problem rather than a generic failure.
  const fieldErrors = useMemo(
    () => resolveFieldErrors(createConnection.error),
    [createConnection.error],
  );
  const unmatchedServerErrors = useMemo(() => {
    if (!(createConnection.error instanceof ApiError)) return [];
    const known = new Set(['name', 'clientId', 'clientSecret', 'integrationId', 'posId', 'environment']);
    return Object.entries(fieldErrors)
      .filter(([path]) => !known.has(path))
      .map(([path, message]) => `${path}: ${message}`);
  }, [createConnection.error, fieldErrors]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const created = await createConnection.mutateAsync(toCreateConnectionInput(values));
      form.reset(values, { keepValues: true, keepDirty: false });
      setCreatedConnectionId(created.id);
      showToast({
        tone: 'success',
        title: 'Connection created',
        description: `eparagony.pl connection "${created.name}" was created.`,
      });
    } catch {
      return;
    }
  });

  const onTest = async (): Promise<void> => {
    if (!createdConnectionId) return;
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
          {unmatchedServerErrors.length > 0 ? (
            <ul>
              {unmatchedServerErrors.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}

      <Alert tone="info" title="Before you connect">
        <p>
          eparagony.pl orchestrates registering a sale with your own fiscal printer - it works
          alongside it, not instead of it. Three things need to be set up first, usually by your
          printer servicer as part of installation:
        </p>
        <ul className="check-list">
          <li>
            <span>
              <strong>An online fiscal printer</strong> - Posnet, Novitus or Elzab - connected to
              the internet.
            </span>
            <StatusBadge tone="neutral" compact>
              Your equipment
            </StatusBadge>
          </li>
          <li>
            <span>
              <strong>eparagony.pl&apos;s printer-control software</strong> running on the machine
              next to the printer.
            </span>
            <StatusBadge tone="neutral" compact>
              Your equipment
            </StatusBadge>
          </li>
          <li>
            <span>
              <strong>The device set up for e-receipts</strong> by your printer servicer.
            </span>
            <StatusBadge tone="neutral" compact>
              Ask your servicer
            </StatusBadge>
          </li>
        </ul>
        <p>
          <strong>Test connection</strong>, below, confirms your credentials and permissions - the
          part OpenLinker can see. The printer itself lives outside OpenLinker, the same way it
          would with any other till software, so check it the way you'd check any other equipment:
          with whoever installed it.
        </p>
        <p>
          Connecting does not register anything automatically. In OpenLinker, a receipt is
          registered only when you ask for it on a specific order.
        </p>
      </Alert>

      <FormField
        label="Connection name"
        name="name"
        error={form.formState.errors.name?.message ?? fieldErrors.name}
        description="A label to identify this eparagony.pl account in OpenLinker."
      >
        <Input
          {...form.register('name')}
          placeholder="My eparagony.pl account"
          autoComplete="off"
          invalid={Boolean(form.formState.errors.name ?? fieldErrors.name)}
        />
      </FormField>

      <FormField
        label="Environment"
        name="environment"
        error={form.formState.errors.environment?.message ?? fieldErrors.environment}
        description="Sandbox has no fiscal device attached, so nothing prints or registers for real."
      >
        <Select {...form.register('environment')}>
          <option value="sandbox">Sandbox - https://sandbox.eparagony.pl</option>
          <option value="production">Production - https://api.eparagony.pl</option>
        </Select>
      </FormField>

      <FormField
        label="Client ID"
        name="clientId"
        error={form.formState.errors.clientId?.message ?? fieldErrors.clientId}
        description="Issued by eparagony.pl when your integration was approved."
      >
        <Input
          {...form.register('clientId')}
          autoComplete="off"
          invalid={Boolean(form.formState.errors.clientId ?? fieldErrors.clientId)}
        />
      </FormField>

      <FormField
        label="Client secret"
        name="clientSecret"
        error={form.formState.errors.clientSecret?.message ?? fieldErrors.clientSecret}
        description="Stored securely on the server and never shown again after saving."
      >
        <Input
          {...form.register('clientSecret')}
          type="password"
          placeholder="••••••••••••••••••••••••••••••••"
          autoComplete="off"
          invalid={Boolean(form.formState.errors.clientSecret ?? fieldErrors.clientSecret)}
        />
      </FormField>

      <FormField
        label="POS ID"
        name="posId"
        error={form.formState.errors.posId?.message ?? fieldErrors.posId}
        description="The register / till identifier eparagony.pl stamps on every document."
      >
        <Input
          {...form.register('posId')}
          autoComplete="off"
          invalid={Boolean(form.formState.errors.posId ?? fieldErrors.posId)}
        />
      </FormField>

      <FormField
        label="Integration ID (optional)"
        name="integrationId"
        error={form.formState.errors.integrationId?.message ?? fieldErrors.integrationId}
        description="Of the form integration:secret. Only issued to multi-customer integrators - leave blank if you were not given one."
      >
        <Input
          {...form.register('integrationId')}
          placeholder="openlinker:abc123"
          autoComplete="off"
          invalid={Boolean(form.formState.errors.integrationId ?? fieldErrors.integrationId)}
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
            {createConnection.isPending ? 'Connecting…' : 'Connect eparagony.pl'}
          </Button>
        </div>
      )}
    </form>
  );
}

/**
 * KSeF Setup Form
 *
 * Single-step wizard for creating a KSeF (Polish national e-invoicing)
 * connection. Collects:
 *   - Connection name
 *   - Environment (test / demo / prod)
 *   - Seller NIP + context identifier (optional context fields)
 *   - Authentication type (KSeF token / qualified seal)
 *   - Authentication secret (write-only — shown once, never echoed back)
 *
 * Mirrors the WooCommerce single-step shape. Capabilities are seeded silently
 * server-side from the adapter manifest (`['Invoicing']`); the FE does not send
 * them because `Invoicing` is not in the well-known `CORE_CAPABILITY_VALUES`.
 *
 * @module features/connections/components
 */
import { useEffect, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useCreateConnectionMutation } from '../hooks/use-create-connection-mutation';
import {
  KSEF_AUTH_TYPE_VALUES,
  KSEF_ENVIRONMENT_VALUES,
  KSEF_SETUP_DEFAULT_VALUES,
  ksefSetupSchema,
  toCreateConnectionInput,
  type KsefSetupFormSubmission,
  type KsefSetupFormValues,
} from './ksef-setup.schema';
import { Alert } from '../../../shared/ui/alert';
import { BackLink } from '../../../shared/ui/back-link';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { useToast } from '../../../shared/ui/toast-provider';

const ENVIRONMENT_LABELS: Record<(typeof KSEF_ENVIRONMENT_VALUES)[number], string> = {
  test: 'Test (sandbox)',
  demo: 'Demo (pre-production)',
  prod: 'Production (live clearance)',
};

const AUTH_TYPE_LABELS: Record<(typeof KSEF_AUTH_TYPE_VALUES)[number], string> = {
  'ksef-token': 'KSeF authorization token',
  'qualified-seal': 'Qualified electronic seal',
};

export function KsefSetupForm(): ReactElement {
  const createConnection = useCreateConnectionMutation();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const form = useForm<KsefSetupFormValues, undefined, KsefSetupFormSubmission>({
    defaultValues: KSEF_SETUP_DEFAULT_VALUES,
    resolver: zodResolver(ksefSetupSchema),
    mode: 'onBlur',
  });

  // Abandon-prevention.
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

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const created = await createConnection.mutateAsync(toCreateConnectionInput(values));
      form.reset(values, { keepValues: true, keepDirty: false });
      showToast({
        tone: 'success',
        title: 'Connection created',
        description: `KSeF connection "${created.name}" was created.`,
      });
      void navigate('/connections');
    } catch {
      return;
    }
  });

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
        Generate a KSeF authorization token (or register a qualified electronic seal) for your
        seller context in the chosen KSeF environment. The secret is stored securely on the server
        and shown only once below.
      </Alert>

      <FormField
        label="Connection name"
        name="name"
        error={form.formState.errors.name?.message}
        description="A label to identify this e-invoicing connection in OpenLinker."
      >
        <Input
          {...form.register('name')}
          placeholder="KSeF — main seller"
          autoComplete="off"
          invalid={Boolean(form.formState.errors.name)}
        />
      </FormField>

      <FormField
        label="Environment"
        name="environment"
        error={form.formState.errors.environment?.message}
        description="KSeF target environment. Use Test/Demo for sandboxes; Production clears live invoices."
      >
        <Select
          {...form.register('environment')}
          invalid={Boolean(form.formState.errors.environment)}
        >
          {KSEF_ENVIRONMENT_VALUES.map((env) => (
            <option key={env} value={env}>
              {ENVIRONMENT_LABELS[env]}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField
        label="Seller NIP"
        name="sellerNip"
        error={form.formState.errors.sellerNip?.message}
        description="10-digit Polish tax identifier of the issuing seller. Optional."
      >
        <Input
          {...form.register('sellerNip')}
          placeholder="1234567890"
          inputMode="numeric"
          autoComplete="off"
          invalid={Boolean(form.formState.errors.sellerNip)}
        />
      </FormField>

      <FormField
        label="Context identifier"
        name="contextIdentifier"
        error={form.formState.errors.contextIdentifier?.message}
        description="Optional KSeF subject/context identifier when issuing on behalf of a sub-unit."
      >
        <Input
          {...form.register('contextIdentifier')}
          placeholder="(optional)"
          autoComplete="off"
          invalid={Boolean(form.formState.errors.contextIdentifier)}
        />
      </FormField>

      <FormField
        label="Authentication type"
        name="authType"
        error={form.formState.errors.authType?.message}
        description="How OpenLinker authenticates the KSeF session."
      >
        <Select {...form.register('authType')} invalid={Boolean(form.formState.errors.authType)}>
          {KSEF_AUTH_TYPE_VALUES.map((authType) => (
            <option key={authType} value={authType}>
              {AUTH_TYPE_LABELS[authType]}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField
        label="Authentication secret"
        name="secret"
        error={form.formState.errors.secret?.message}
        description="The KSeF authorization token or qualified-seal reference. Write-only — stored securely and never shown again."
      >
        <Input
          {...form.register('secret')}
          type="password"
          placeholder="••••••••••••••••••••••••••••••••"
          autoComplete="off"
          invalid={Boolean(form.formState.errors.secret)}
        />
      </FormField>

      <div className="form-actions">
        <Button type="submit" disabled={createConnection.isPending}>
          {createConnection.isPending ? 'Connecting…' : 'Connect KSeF'}
        </Button>
      </div>
    </form>
  );
}

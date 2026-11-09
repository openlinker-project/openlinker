/**
 * Subiekt Setup Form
 *
 * Single-step guided wizard for creating a Subiekt connection (#1199). ONE form
 * serves both products; everything that differs between them arrives on
 * `identity`. Collects:
 *   - Connection name
 *   - Bridge base URL (a LAN service — http allowed; the port differs per product)
 *   - Optional request timeout (advanced)
 *   - Bridge token, REQUIRED for both shipped products
 *   - When to issue the sales document
 *
 * The token is required because both bridges refuse every `/api/*` request
 * without one. It used to be labelled optional and described as "leave blank
 * for an unauthenticated LAN bridge", which was the opposite of what the bridge
 * does — and the connection test agreed, because it probed the one route the
 * bridge exempts from auth.
 *
 * After a successful create the form surfaces a "Test connection" affordance
 * that calls the generic `/connections/:id/test` endpoint (backed by
 * `SubiektConnectionTesterAdapter`, which now probes an AUTHORIZED route, so a
 * pass means the credential works) and renders the `ConnectionTestResult`.
 * Abandon-prevention triggers a native confirm dialog when the form is dirty
 * and the tab is closed before creation.
 *
 * The bridge token is write-only: it is never read back into form state or
 * rendered after submit, and never appears in the ConnectionTestResult.
 *
 * @module features/connections/components
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { useCreateConnectionMutation } from '../hooks/use-create-connection-mutation';
import { useTestConnectionMutation } from '../hooks/use-test-connection-mutation';
import type { ConnectionTestResult } from '../api/connections.types';
import {
  SUBIEKT_SETUP_DEFAULT_VALUES,
  buildSubiektSetupSchema,
  toCreateConnectionInput,
  type SubiektProductIdentity,
  type SubiektSetupFormSubmission,
  type SubiektSetupFormValues,
} from './subiekt-setup.schema';
import { Alert } from '../../../shared/ui/alert';
import { BackLink } from '../../../shared/ui/back-link';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { useToast } from '../../../shared/ui/toast-provider';
import { interpolate, renderRich, useFormat, useMessages } from '../../../shared/i18n';

// The product family name, the same in every language.
const SUBIEKT_FAMILY_NAME = 'Subiekt';

/**
 * One form, two products. `identity` is REQUIRED and has no default: Subiekt
 * GT and Subiekt nexo speak different bridges, so defaulting one of them would
 * create a connection pointed at the wrong adapter - and it would do so
 * silently, because `ConnectionService.create` does not validate the platform
 * against the registry.
 */
export function SubiektSetupForm({
  identity,
}: {
  identity: SubiektProductIdentity;
}): ReactElement {
  const copy = useMessages('connections').subiektSetupForm;
  const setupCopy = useMessages('connections').setup;
  const format = useFormat();
  const product = identity.productName;
  const createConnection = useCreateConnectionMutation();
  const testConnection = useTestConnectionMutation();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [createdConnectionId, setCreatedConnectionId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  // Per product: the bridge-URL example in the validation message and whether
  // a token is required both depend on which Subiekt this is.
  const schema = useMemo(() => buildSubiektSetupSchema(identity), [identity]);

  const form = useForm<SubiektSetupFormValues, undefined, SubiektSetupFormSubmission>({
    defaultValues: SUBIEKT_SETUP_DEFAULT_VALUES,
    resolver: zodResolver(schema),
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
      const created = await createConnection.mutateAsync(toCreateConnectionInput(values, identity));
      form.reset(values, { keepValues: true, keepDirty: false });
      setCreatedConnectionId(created.id);
      showToast({
        tone: 'success',
        title: copy.createdTitle,
        description: interpolate(copy.createdDescription, { platform: SUBIEKT_FAMILY_NAME, name: created.name }),
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
      <BackLink to="/connections/new" label={setupCopy.connections} className="wizard-card__back" />

      {form.formState.submitCount > 0 && validationMessages.length > 0 ? (
        <FormErrorSummary errors={validationMessages} />
      ) : null}
      {createConnection.error ? (
        <Alert tone="error" title={copy.createError}>
          {createConnection.error.message}
        </Alert>
      ) : null}

      <Alert tone="info" title={copy.beforeYouStart.title}>
        {renderRich(
          copy.beforeYouStart.body,
          {
            strong: (text) => <strong>{text}</strong>,
            code: (text) => <code>{text}</code>,
          },
          { product },
        )}
      </Alert>

      <FormField
        label={copy.fields.name.label}
        name="name"
        error={form.formState.errors.name?.message}
        description={interpolate(copy.fields.name.description, { platform: SUBIEKT_FAMILY_NAME })}
      >
        <Input
          {...form.register('name')}
          placeholder={interpolate(copy.fields.name.placeholder, { platform: SUBIEKT_FAMILY_NAME })}
          autoComplete="off"
          invalid={Boolean(form.formState.errors.name)}
        />
      </FormField>

      <FormField
        label={copy.fields.bridgeBaseUrl.label}
        name="bridgeBaseUrl"
        error={form.formState.errors.bridgeBaseUrl?.message}
        description={interpolate(copy.fields.bridgeBaseUrl.description, {
          example: identity.bridgeUrlExample,
        })}
      >
        <Input
          {...form.register('bridgeBaseUrl')}
          className="mono-text"
          placeholder={identity.bridgeUrlExample}
          autoComplete="off"
          invalid={Boolean(form.formState.errors.bridgeBaseUrl)}
        />
      </FormField>

      <FormField
        label={copy.fields.timeoutMs.label}
        name="timeoutMs"
        error={form.formState.errors.timeoutMs?.message}
        description={interpolate(copy.fields.timeoutMs.description, {
          min: format.number(1000),
          max: format.number(120000),
        })}
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
        label={identity.tokenRequired ? copy.fields.bridgeToken.label : copy.fields.bridgeToken.labelOptional}
        name="bridgeToken"
        error={form.formState.errors.bridgeToken?.message}
        description={interpolate(copy.fields.bridgeToken.description, {
          hint: identity.tokenConfigHint,
        })}
      >
        <Input
          {...form.register('bridgeToken')}
          type="password"
          placeholder="••••••••••••••••"
          autoComplete="off"
          invalid={Boolean(form.formState.errors.bridgeToken)}
        />
      </FormField>

      <FormField
        label={copy.fields.triggerModel.label}
        name="triggerModel"
        error={form.formState.errors.triggerModel?.message}
        description={interpolate(copy.fields.triggerModel.description, { product })}
      >
        <Select
          {...form.register('triggerModel')}
          invalid={Boolean(form.formState.errors.triggerModel)}
        >
          <option value="manual">{copy.fields.triggerModel.manual}</option>
          <option value="auto-on-paid">{copy.fields.triggerModel.autoOnPaid}</option>
        </Select>
      </FormField>

      {createdConnectionId ? (
        <>
          {testResult ? (
            <Alert
              tone={testResult.success ? 'success' : 'error'}
              title={testResult.success ? copy.testPassed : copy.testFailed}
            >
              {testResult.message}
              {typeof testResult.latencyMs === 'number'
                ? ` ${interpolate(copy.latency, { ms: format.number(testResult.latencyMs) })}`
                : null}
            </Alert>
          ) : null}
          {testConnection.error ? (
            <Alert tone="error" title={copy.testError}>
              {testConnection.error.message}
            </Alert>
          ) : null}
          <Alert tone="info" title={copy.invoiceSetting.title}>
            {form.getValues('triggerModel') === 'auto-on-paid'
              ? copy.invoiceSetting.auto
              : copy.invoiceSetting.manual}{' '}
            {renderRich(copy.invoiceSetting.change, {
              link: (text) => <Link to="/settings/sales-documents">{text}</Link>,
            })}
          </Alert>
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
        <div className="form-actions">
          <Button type="submit" disabled={createConnection.isPending}>
            {createConnection.isPending
              ? copy.connecting
              : interpolate(copy.connect, { platform: SUBIEKT_FAMILY_NAME })}
          </Button>
        </div>
      )}
    </form>
  );
}

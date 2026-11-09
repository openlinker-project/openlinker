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
 * server-side from the adapter manifest (`['Invoicing']`); the FE does not need
 * to send them explicitly.
 *
 * @module plugins/ksef/components
 */
import { useEffect, useState, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useCreateConnectionMutation } from '../../../features/connections';
import {
  KSEF_AUTH_TYPE_VALUES,
  KSEF_ENVIRONMENT_VALUES,
  KSEF_LINE_UNIT_SUGGESTIONS,
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
import { interpolate } from '../../../shared/i18n';
import { useKsefMessages } from '../messages';

export function KsefSetupForm(): ReactElement {
  const messages = useKsefMessages();
  const copy = messages.ksefSetupForm;
  const fields = messages.common.fields;
  const createConnection = useCreateConnectionMutation();
  const { showToast } = useToast();
  const navigate = useNavigate();
  // DEF-21: a second connection on the same seller NIP shares KSeF's rate
  // limit; the create response says so, and the notice stays until read.
  const [createdWithWarnings, setCreatedWithWarnings] = useState<{ id: string; warnings: string[] } | null>(
    null,
  );

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
        title: copy.created.title,
        description: interpolate(copy.created.description, { name: created.name }),
      });
      if (created.warnings && created.warnings.length > 0) {
        setCreatedWithWarnings({ id: created.id, warnings: created.warnings });
        return;
      }
      void navigate('/connections');
    } catch {
      return;
    }
  });

  return (
    <form className="wizard-card" onSubmit={(event) => void onSubmit(event)} noValidate>
      <BackLink to="/connections/new" label={copy.back} className="wizard-card__back" />

      {form.formState.submitCount > 0 && validationMessages.length > 0 ? (
        <FormErrorSummary errors={validationMessages} />
      ) : null}
      {createConnection.error ? (
        <Alert tone="error" title={copy.createError}>
          {createConnection.error.message}
        </Alert>
      ) : null}
      {createdWithWarnings ? (
        <Alert
          tone="warning"
          title={copy.createdWithWarnings.title}
          data-testid="connection-save-warnings"
          action={
            <Button tone="secondary" onClick={() => void navigate(`/connections/${createdWithWarnings.id}`)}>
              {copy.createdWithWarnings.goToConnection}
            </Button>
          }
        >
          {createdWithWarnings.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </Alert>
      ) : null}

      <Alert tone="info" title={copy.beforeYouStart.title}>
        {copy.beforeYouStart.body}
      </Alert>

      <FormField
        label={copy.name.label}
        name="name"
        error={form.formState.errors.name?.message}
        description={copy.name.description}
      >
        <Input
          {...form.register('name')}
          placeholder={copy.name.placeholder}
          autoComplete="off"
          invalid={Boolean(form.formState.errors.name)}
        />
      </FormField>

      <FormField
        label={fields.environment.label}
        name="environment"
        error={form.formState.errors.environment?.message}
        description={copy.environment.description}
      >
        <Select
          {...form.register('environment')}
          invalid={Boolean(form.formState.errors.environment)}
        >
          {KSEF_ENVIRONMENT_VALUES.map((env) => (
            <option key={env} value={env}>
              {messages.common.environments[env]}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField
        label={fields.sellerNip.label}
        name="sellerNip"
        error={form.formState.errors.sellerNip?.message}
        description={fields.sellerNip.description}
      >
        <Input
          {...form.register('sellerNip')}
          placeholder={fields.sellerNip.placeholder}
          inputMode="numeric"
          autoComplete="off"
          invalid={Boolean(form.formState.errors.sellerNip)}
        />
      </FormField>

      <FormField
        label={fields.sellerName.label}
        name="sellerName"
        error={form.formState.errors.sellerName?.message}
        description={fields.sellerName.description}
      >
        <Input
          {...form.register('sellerName')}
          placeholder={fields.sellerName.placeholder}
          autoComplete="off"
          invalid={Boolean(form.formState.errors.sellerName)}
        />
      </FormField>

      <FormField
        label={fields.addressLine1.label}
        name="sellerAddressLine1"
        error={form.formState.errors.sellerAddressLine1?.message}
        description={fields.addressLine1.description}
      >
        <Input
          {...form.register('sellerAddressLine1')}
          placeholder={fields.addressLine1.placeholder}
          autoComplete="off"
          invalid={Boolean(form.formState.errors.sellerAddressLine1)}
        />
      </FormField>

      <FormField
        label={fields.addressLine2.label}
        name="sellerAddressLine2"
        error={form.formState.errors.sellerAddressLine2?.message}
        description={fields.addressLine2.description}
      >
        <Input
          {...form.register('sellerAddressLine2')}
          placeholder={fields.optional}
          autoComplete="off"
          invalid={Boolean(form.formState.errors.sellerAddressLine2)}
        />
      </FormField>

      <FormField
        label={fields.city.label}
        name="sellerCity"
        error={form.formState.errors.sellerCity?.message}
        description={fields.city.description}
      >
        <Input
          {...form.register('sellerCity')}
          placeholder={fields.city.placeholder}
          autoComplete="off"
          invalid={Boolean(form.formState.errors.sellerCity)}
        />
      </FormField>

      <FormField
        label={fields.postalCode.label}
        name="sellerPostalCode"
        error={form.formState.errors.sellerPostalCode?.message}
        description={fields.postalCode.description}
      >
        <Input
          {...form.register('sellerPostalCode')}
          placeholder={fields.postalCode.placeholder}
          autoComplete="off"
          invalid={Boolean(form.formState.errors.sellerPostalCode)}
        />
      </FormField>

      <FormField
        label={fields.country.label}
        name="sellerCountryIso2"
        error={form.formState.errors.sellerCountryIso2?.message}
        description={fields.country.description}
      >
        <Input
          {...form.register('sellerCountryIso2')}
          placeholder={fields.country.placeholder}
          autoComplete="off"
          invalid={Boolean(form.formState.errors.sellerCountryIso2)}
        />
      </FormField>

      <FormField
        label={fields.contextIdentifier.label}
        name="contextIdentifier"
        error={form.formState.errors.contextIdentifier?.message}
        description={copy.contextIdentifier.description}
      >
        <Input
          {...form.register('contextIdentifier')}
          placeholder={fields.optional}
          autoComplete="off"
          invalid={Boolean(form.formState.errors.contextIdentifier)}
        />
      </FormField>

      <FormField
        label={fields.lineUnit.label}
        name="invoiceDefaultLineUnit"
        error={form.formState.errors.invoiceDefaultLineUnit?.message}
        description={copy.lineUnit.description}
      >
        <Input
          {...form.register('invoiceDefaultLineUnit')}
          list="ksef-line-unit-suggestions"
          placeholder={fields.lineUnit.placeholder}
          autoComplete="off"
          invalid={Boolean(form.formState.errors.invoiceDefaultLineUnit)}
        />
      </FormField>
      {/* Outside FormField (it requires a single child); linked via list=. */}
      <datalist id="ksef-line-unit-suggestions">
        {KSEF_LINE_UNIT_SUGGESTIONS.map((unit) => (
          <option key={unit} value={unit} />
        ))}
      </datalist>

      <FormField
        label={copy.authType.label}
        name="authType"
        error={form.formState.errors.authType?.message}
        description={copy.authType.description}
      >
        <Select {...form.register('authType')} invalid={Boolean(form.formState.errors.authType)}>
          {KSEF_AUTH_TYPE_VALUES.map((authType) => (
            <option key={authType} value={authType}>
              {messages.common.authTypes[authType]}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField
        label={copy.secret.label}
        name="secret"
        error={form.formState.errors.secret?.message}
        description={copy.secret.description}
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
          {createConnection.isPending ? copy.connecting : copy.connect}
        </Button>
      </div>
    </form>
  );
}

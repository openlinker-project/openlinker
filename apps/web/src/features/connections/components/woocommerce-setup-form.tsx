/**
 * WooCommerce Setup Form
 *
 * Single-step wizard for creating a WooCommerce connection. Collects:
 *   - Connection name
 *   - Site URL (HTTPS)
 *   - Consumer key (ck_...)
 *   - Consumer secret (cs_...)
 *
 * Simpler than the PrestaShop 4-step wizard — no stepper, no capabilities
 * step (capabilities are seeded silently from the adapter registry, falling
 * back to the manifest's full set). Abandon-prevention triggers a native
 * confirm dialog when the form is dirty and the tab is closed.
 */
import { useEffect, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useAdaptersQuery } from '../../adapters';
import { useCreateConnectionMutation } from '../hooks/use-create-connection-mutation';
import { CORE_CAPABILITY_VALUES, type CoreCapability } from '../api/connections.types';
import {
  WOOCOMMERCE_ADAPTER_KEY,
  WOOCOMMERCE_FALLBACK_CAPABILITIES,
  WOOCOMMERCE_SETUP_DEFAULT_VALUES,
  woocommerceSetupSchema,
  toCreateConnectionInput,
  type WoocommerceSetupFormValues,
  type WoocommerceSetupFormSubmission,
} from './woocommerce-setup.schema';
import { Alert } from '../../../shared/ui/alert';
import { BackLink } from '../../../shared/ui/back-link';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { useToast } from '../../../shared/ui/toast-provider';

export function WoocommerceSetupForm(): ReactElement {
  const createConnection = useCreateConnectionMutation();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const adaptersQuery = useAdaptersQuery();

  const form = useForm<WoocommerceSetupFormValues, undefined, WoocommerceSetupFormSubmission>({
    defaultValues: WOOCOMMERCE_SETUP_DEFAULT_VALUES,
    resolver: zodResolver(woocommerceSetupSchema),
    mode: 'onBlur',
  });

  // Seed enabledCapabilities from the adapter registry once loaded.
  useEffect(() => {
    const adapter = adaptersQuery.data?.find((a) => a.adapterKey === WOOCOMMERCE_ADAPTER_KEY);
    const capabilities: CoreCapability[] = (
      adapter?.supportedCapabilities ?? WOOCOMMERCE_FALLBACK_CAPABILITIES
    ).filter((cap): cap is CoreCapability =>
      (CORE_CAPABILITY_VALUES as readonly string[]).includes(cap),
    );
    form.setValue('enabledCapabilities', capabilities);
  }, [adaptersQuery.data, form]);

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
        description: `WooCommerce connection "${created.name}" was created.`,
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
        In your WooCommerce admin, go to <strong>WooCommerce → Settings → Advanced → REST API</strong>{' '}
        and generate a key with <strong>Read/Write</strong> permissions. Copy the consumer key and
        consumer secret below — they are only shown once.
      </Alert>

      <FormField
        label="Connection name"
        name="name"
        error={form.formState.errors.name?.message}
        description="A label to identify this store in OpenLinker."
      >
        <Input
          {...form.register('name')}
          placeholder="My WooCommerce Store"
          autoComplete="off"
          invalid={Boolean(form.formState.errors.name)}
        />
      </FormField>

      <FormField
        label="Site URL"
        name="siteUrl"
        error={form.formState.errors.siteUrl?.message}
        description="The root URL of your WooCommerce store. Must use HTTPS."
      >
        <Input
          {...form.register('siteUrl')}
          placeholder="https://shop.example.com"
          autoComplete="off"
          invalid={Boolean(form.formState.errors.siteUrl)}
        />
      </FormField>

      <FormField
        label="Consumer key"
        name="consumerKey"
        error={form.formState.errors.consumerKey?.message}
        description="Starts with ck_ — generated in WooCommerce REST API settings."
      >
        <Input
          {...form.register('consumerKey')}
          type="password"
          placeholder="ck_••••••••••••••••••••••••••••••••••••••••"
          autoComplete="off"
          invalid={Boolean(form.formState.errors.consumerKey)}
        />
      </FormField>

      <FormField
        label="Consumer secret"
        name="consumerSecret"
        error={form.formState.errors.consumerSecret?.message}
        description="Starts with cs_ — generated alongside the consumer key."
      >
        <Input
          {...form.register('consumerSecret')}
          type="password"
          placeholder="cs_••••••••••••••••••••••••••••••••••••••••"
          autoComplete="off"
          invalid={Boolean(form.formState.errors.consumerSecret)}
        />
      </FormField>

      <div className="form-actions">
        <Button type="submit" disabled={createConnection.isPending}>
          {createConnection.isPending ? 'Connecting…' : 'Connect WooCommerce'}
        </Button>
      </div>
    </form>
  );
}

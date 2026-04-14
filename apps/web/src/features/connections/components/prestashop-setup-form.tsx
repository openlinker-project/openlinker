/**
 * PrestaShop Setup Form
 *
 * Guided wizard form for creating a PrestaShop connection. Collects the
 * values an operator can read directly from the PrestaShop admin (shop
 * URL, webservice key, optional shop ID) and maps them to the generic
 * CreateConnectionInput shape. The adapter key is inferred from the
 * platform so the operator never edits raw config JSON.
 */
import type { ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useCreateConnectionMutation } from '../hooks/use-create-connection-mutation';
import {
  PRESTASHOP_ADAPTER_KEY,
  PRESTASHOP_FALLBACK_CAPABILITIES,
  PRESTASHOP_SETUP_DEFAULT_VALUES,
  prestashopSetupSchema,
  toCreateConnectionInput,
  type PrestashopSetupFormSubmission,
  type PrestashopSetupFormValues,
} from './prestashop-setup.schema';
import type { Capability } from '../api/connections.types';
import { useAdaptersQuery } from '../../adapters/hooks/use-adapters-query';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { useToast } from '../../../shared/ui/toast-provider';

const CAPABILITY_HELP: Record<Capability, string> = {
  ProductMaster: 'Read the product catalog (variants, attributes, categories) from this shop.',
  InventoryMaster: 'Read stock levels from this shop as the inventory source of truth.',
  OrderProcessorManager: 'Create and manage orders in this shop (typically the order destination).',
  OrderSource: 'Fetch new orders from this shop (disable if orders come from a marketplace instead).',
  Marketplace: 'Manage offers and listings on this marketplace.',
};

export function PrestashopSetupForm(): ReactElement {
  const createConnection = useCreateConnectionMutation();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const adaptersQuery = useAdaptersQuery();
  const form = useForm<PrestashopSetupFormValues, undefined, PrestashopSetupFormSubmission>({
    defaultValues: PRESTASHOP_SETUP_DEFAULT_VALUES,
    resolver: zodResolver(prestashopSetupSchema),
  });

  // Prefer the live adapter registry as the source of truth for supported
  // capabilities; fall back to a hardcoded list if the /adapters call fails so
  // the wizard still works offline or under partial outage.
  const adapterMetadata = adaptersQuery.data?.find(
    (a) => a.adapterKey === PRESTASHOP_ADAPTER_KEY,
  );
  const supportedCapabilities: Capability[] =
    adapterMetadata?.supportedCapabilities ?? PRESTASHOP_FALLBACK_CAPABILITIES;

  const validationMessages = Object.values(form.formState.errors).flatMap((error) =>
    error?.message ? [String(error.message)] : [],
  );

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const created = await createConnection.mutateAsync(toCreateConnectionInput(values));
      showToast({
        tone: 'success',
        title: 'Connection created',
        description: `PrestaShop connection "${created.name}" was created.`,
      });
      void navigate('/connections');
    } catch {
      return;
    }
  });

  return (
    <form className="form-card" onSubmit={(event) => void onSubmit(event)} noValidate>
      <div className="panel__header">
        <div>
          <p className="eyebrow">PrestaShop</p>
          <h3 className="section-title">Connect a PrestaShop store</h3>
        </div>
        <span className="panel__meta">Webservice API</span>
      </div>

      {form.formState.submitCount > 0 ? <FormErrorSummary errors={validationMessages} /> : null}
      {createConnection.error ? (
        <Alert tone="error" title="Unable to create connection">
          {createConnection.error.message}
        </Alert>
      ) : null}

      <Alert tone="info" title="Before you start">
        In your PrestaShop admin, enable Webservice under{' '}
        <strong>Advanced Parameters → Webservice</strong> and generate a key with the required
        resources enabled.
      </Alert>

      <div className="form-grid">
        <FormField label="Connection name" name="name" error={form.formState.errors.name?.message}>
          <Input
            {...form.register('name')}
            placeholder="Main PrestaShop Store"
            invalid={Boolean(form.formState.errors.name)}
          />
        </FormField>

        <FormField
          label="Shop URL"
          name="baseUrl"
          error={form.formState.errors.baseUrl?.message}
          description="The public URL of the PrestaShop storefront (no trailing path)."
        >
          <Input
            {...form.register('baseUrl')}
            placeholder="https://shop.example.com"
            invalid={Boolean(form.formState.errors.baseUrl)}
          />
        </FormField>

        <FormField
          label="Webservice key"
          name="webserviceKey"
          error={form.formState.errors.webserviceKey?.message}
          description="Generated in PrestaShop admin under Advanced Parameters → Webservice."
        >
          <Input
            {...form.register('webserviceKey')}
            type="password"
            autoComplete="off"
            placeholder="e.g. ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"
            invalid={Boolean(form.formState.errors.webserviceKey)}
          />
        </FormField>

        <FormField
          label="Shop ID (optional)"
          name="shopId"
          error={form.formState.errors.shopId?.message}
          description="Only needed for multi-shop PrestaShop installations."
        >
          <Input
            {...form.register('shopId')}
            placeholder="1"
            invalid={Boolean(form.formState.errors.shopId)}
          />
        </FormField>
      </div>

      <fieldset className="capability-fieldset">
        <legend className="capability-fieldset__legend">Capabilities</legend>
        <p className="muted-text capability-fieldset__help">
          Pick which roles this connection should fulfil. You can change this later on the
          connection\u2019s detail page.
        </p>
        <ul className="capability-list">
          {supportedCapabilities.map((capability) => {
            const id = `new-cap-${capability}`;
            return (
              <li key={capability} className="capability-list__item">
                <label htmlFor={id} className="capability-list__label">
                  <input
                    id={id}
                    type="checkbox"
                    value={capability}
                    {...form.register('enabledCapabilities')}
                  />
                  <span className="capability-list__name mono-text">{capability}</span>
                </label>
                <p className="capability-list__help muted-text">
                  {CAPABILITY_HELP[capability]}
                </p>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div className="form-actions">
        <Button type="submit" disabled={createConnection.isPending}>
          {createConnection.isPending ? 'Creating...' : 'Create connection'}
        </Button>
      </div>
    </form>
  );
}

import type { ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { usePlatform, usePlatforms } from '../../../shared/plugins';
import { useCreateConnectionMutation } from '../hooks/use-create-connection-mutation';
import {
  createConnectionSchema,
  toCreateConnectionInput,
  type CreateConnectionFormSubmission,
  type CreateConnectionFormValues,
} from './create-connection.schema';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { Textarea } from '../../../shared/ui/textarea';
import { useToast } from '../../../shared/ui/toast-provider';

const DEFAULT_CONFIG = JSON.stringify(
  {
    baseUrl: 'https://example.com',
  },
  null,
  2,
);

const DEFAULT_VALUES: CreateConnectionFormValues = {
  adapterKey: '',
  configText: DEFAULT_CONFIG,
  credentialsRef: '',
  name: '',
  platformType: '',
};

export function CreateConnectionForm(): ReactElement {
  const createConnection = useCreateConnectionMutation();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const plugins = usePlatforms();
  const platformOptions = plugins.map((p) => ({ value: p.platformType, label: p.displayName }));
  const form = useForm<CreateConnectionFormValues, undefined, CreateConnectionFormSubmission>({
    defaultValues: DEFAULT_VALUES,
    resolver: zodResolver(createConnectionSchema),
  });

  const watchedPlatformType = form.watch('platformType');
  // Platforms that drive the operator through an OAuth redirect (today:
  // Allegro) suppress the inline create-submit affordances — the registered
  // platform wizard owns the rest of the flow.
  const selectedPlugin = usePlatform(watchedPlatformType);
  const requiresExternalAuthRedirect = selectedPlugin?.requiresExternalAuthRedirect === true;

  const validationMessages = Object.values(form.formState.errors).flatMap((error) =>
    error?.message ? [String(error.message)] : [],
  );

  const onSubmit = form.handleSubmit(async (values) => {
    // Guard against Enter-key form submission while a platform-specific wizard
    // (e.g. Allegro) is selected: the schema still validates hidden fields, so
    // submission would fail silently without visible feedback.
    if (requiresExternalAuthRedirect) return;
    try {
      const created = await createConnection.mutateAsync(toCreateConnectionInput(values));
      showToast({
        tone: 'success',
        title: 'Connection created',
        description: `Connection "${created.name}" was created.`,
      });
      void navigate('/connections');
    } catch {
      return;
    }
  });

  return (
    <>
      <form className="form-card form-narrow" onSubmit={(event) => void onSubmit(event)} noValidate>
        <div className="panel__header">
          <div>
            <p className="eyebrow">Setup flow</p>
            <h3 className="section-title">Connection draft</h3>
          </div>
          <span className="panel__meta">Validated input</span>
        </div>

        {form.formState.submitCount > 0 ? <FormErrorSummary errors={validationMessages} /> : null}
        {createConnection.error ? (
          <Alert tone="error" title="Unable to create connection">
            {createConnection.error.message}
          </Alert>
        ) : null}

        <div className="form-grid">
          <FormField label="Connection name" name="name" error={form.formState.errors.name?.message}>
            <Input {...form.register('name')} placeholder="Main PrestaShop Store" invalid={Boolean(form.formState.errors.name)} />
          </FormField>

          <FormField
            label="Platform type"
            name="platformType"
            error={form.formState.errors.platformType?.message}
            description="Use the platform family this connection will integrate with."
          >
            <Select {...form.register('platformType')} invalid={Boolean(form.formState.errors.platformType)}>
              <option value="">Select a platform</option>
              {platformOptions.map((platform) => (
                <option key={platform.value} value={platform.value}>
                  {platform.label}
                </option>
              ))}
            </Select>
          </FormField>

          {requiresExternalAuthRedirect ? null : (
            <FormField label="Credentials reference" name="credentialsRef" error={form.formState.errors.credentialsRef?.message}>
              <Input
                {...form.register('credentialsRef')}
                placeholder="db:cred_123"
                invalid={Boolean(form.formState.errors.credentialsRef)}
              />
            </FormField>
          )}

          {requiresExternalAuthRedirect ? null : (
            <FormField
              label="Adapter key"
              name="adapterKey"
              error={form.formState.errors.adapterKey?.message}
              description="Optional when the default adapter can be inferred from the selected platform."
            >
              <Input
                {...form.register('adapterKey')}
                placeholder="prestashop.webservice.v1"
                invalid={Boolean(form.formState.errors.adapterKey)}
              />
            </FormField>
          )}
        </div>

        {requiresExternalAuthRedirect && selectedPlugin ? (
          <Alert tone="info" title={`${selectedPlugin.displayName} uses OAuth`}>
            {selectedPlugin.displayName} connections require OAuth authorization.{' '}
            {selectedPlugin.setupCard ? (
              <Link to={selectedPlugin.setupCard.to}>
                Use the {selectedPlugin.displayName} setup wizard
              </Link>
            ) : (
              `Use the ${selectedPlugin.displayName} setup wizard`
            )}{' '}
            to connect your account securely.
          </Alert>
        ) : (
          <FormField
            label="Config JSON"
            name="configText"
            error={form.formState.errors.configText?.message}
            description="Provide only safe connection configuration values. Secrets must remain outside the browser."
          >
            <Textarea {...form.register('configText')} rows={10} invalid={Boolean(form.formState.errors.configText)} />
          </FormField>
        )}

        {requiresExternalAuthRedirect ? null : (
          <div className="form-actions">
            <Button type="submit" disabled={createConnection.isPending}>
              {createConnection.isPending ? 'Creating...' : 'Create connection'}
            </Button>
            <Button tone="secondary" onClick={() => setIsResetDialogOpen(true)} disabled={createConnection.isPending}>
              Reset draft
            </Button>
          </div>
        )}
      </form>

      <ConfirmDialog
        open={isResetDialogOpen}
        onOpenChange={setIsResetDialogOpen}
        title="Reset connection draft?"
        description="This will clear the current form values and validation state for the integration draft."
        confirmLabel="Reset draft"
        cancelLabel="Keep editing"
        tone="danger"
        onConfirm={() => {
          form.reset(DEFAULT_VALUES);
          createConnection.reset();
          setIsResetDialogOpen(false);
          showToast({
            tone: 'info',
            title: 'Draft reset',
            description: 'Connection draft values were cleared.',
          });
        }}
      />
    </>
  );
}

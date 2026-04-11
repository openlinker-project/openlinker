import type { ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import type { Connection } from '../api/connections.types';
import { useUpdateConnectionMutation } from '../hooks/use-update-connection-mutation';
import {
  editConnectionSchema,
  toUpdateConnectionInput,
  type EditConnectionFormSubmission,
  type EditConnectionFormValues,
} from './edit-connection.schema';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Textarea } from '../../../shared/ui/textarea';
import { useToast } from '../../../shared/ui/toast-provider';

interface EditConnectionFormProps {
  connection: Connection;
}

export function EditConnectionForm({ connection }: EditConnectionFormProps): ReactElement {
  const updateConnection = useUpdateConnectionMutation();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const form = useForm<EditConnectionFormValues, undefined, EditConnectionFormSubmission>({
    defaultValues: {
      name: connection.name,
      configText: JSON.stringify(connection.config, null, 2),
      adapterKey: connection.adapterKey ?? '',
    },
    resolver: zodResolver(editConnectionSchema),
  });

  const validationMessages = Object.values(form.formState.errors).flatMap((error) =>
    error?.message ? [String(error.message)] : [],
  );

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await updateConnection.mutateAsync({
        connectionId: connection.id,
        input: toUpdateConnectionInput(values),
      });
      showToast({
        tone: 'success',
        title: 'Connection updated',
        description: 'Connection settings have been saved.',
      });
      void navigate(`/connections/${connection.id}`);
    } catch {
      return;
    }
  });

  return (
    <form className="form-card" onSubmit={(event) => void onSubmit(event)} noValidate>
      <div className="panel__header">
        <div>
          <p className="eyebrow">Edit connection</p>
          <h3 className="section-title">{connection.name}</h3>
        </div>
        <span className="panel__meta">Update settings</span>
      </div>

      {form.formState.submitCount > 0 && validationMessages.length > 0 ? <FormErrorSummary errors={validationMessages} /> : null}
      {updateConnection.error ? (
        <Alert tone="error" title="Unable to update connection">
          {updateConnection.error.message}
        </Alert>
      ) : null}

      <div className="form-grid">
        <FormField label="Connection name" name="name" error={form.formState.errors.name?.message}>
          <Input {...form.register('name')} placeholder="Main PrestaShop Store" invalid={Boolean(form.formState.errors.name)} />
        </FormField>

        <FormField label="Platform type" name="platformType">
          <Input value={connection.platformType} disabled />
        </FormField>

        <FormField label="Credentials reference" name="credentialsRef">
          <Input value={connection.credentialsRef} disabled />
        </FormField>

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
      </div>

      <FormField
        label="Config JSON"
        name="configText"
        error={form.formState.errors.configText?.message}
        description="Provide only safe connection configuration values. Secrets must remain outside the browser."
      >
        <Textarea {...form.register('configText')} rows={10} invalid={Boolean(form.formState.errors.configText)} />
      </FormField>

      <div className="form-actions">
        <Button type="submit" disabled={updateConnection.isPending}>
          {updateConnection.isPending ? 'Saving...' : 'Save changes'}
        </Button>
        <Button tone="secondary" onClick={() => void navigate(`/connections/${connection.id}`)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

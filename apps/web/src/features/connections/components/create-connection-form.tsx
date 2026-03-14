import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useCreateConnectionMutation } from '../hooks/use-create-connection-mutation';
import {
  createConnectionSchema,
  toCreateConnectionInput,
  type CreateConnectionFormValues,
} from './create-connection.schema';

const DEFAULT_CONFIG = JSON.stringify(
  {
    baseUrl: 'https://example.com',
  },
  null,
  2,
);

export function CreateConnectionForm() {
  const createConnection = useCreateConnectionMutation();
  const form = useForm<CreateConnectionFormValues>({
    defaultValues: {
      adapterKey: '',
      configText: DEFAULT_CONFIG,
      credentialsRef: '',
      name: '',
      platformType: '',
    },
    resolver: zodResolver(createConnectionSchema),
  });

  const onSubmit = form.handleSubmit(async (values) => {
    await createConnection.mutateAsync(toCreateConnectionInput(values));
    form.reset({
      adapterKey: '',
      configText: DEFAULT_CONFIG,
      credentialsRef: '',
      name: '',
      platformType: '',
    });
  });

  return (
    <form className="form-card" onSubmit={(event) => void onSubmit(event)}>
      <div className="panel__header">
        <div>
          <p className="eyebrow">Setup flow</p>
          <h3>Connection draft</h3>
        </div>
        <span className="panel__meta">Validated input</span>
      </div>

      <div className="form-grid">
        <label className="field">
          <span>Connection name</span>
          <input aria-label="Connection name" {...form.register('name')} placeholder="Main PrestaShop Store" />
          <small>{form.formState.errors.name?.message}</small>
        </label>

        <label className="field">
          <span>Platform type</span>
          <input aria-label="Platform type" {...form.register('platformType')} placeholder="prestashop" />
          <small>{form.formState.errors.platformType?.message}</small>
        </label>

        <label className="field">
          <span>Credentials reference</span>
          <input aria-label="Credentials reference" {...form.register('credentialsRef')} placeholder="db:cred_123" />
          <small>{form.formState.errors.credentialsRef?.message}</small>
        </label>

        <label className="field">
          <span>Adapter key</span>
          <input aria-label="Adapter key" {...form.register('adapterKey')} placeholder="prestashop.webservice.v1" />
          <small>{form.formState.errors.adapterKey?.message}</small>
        </label>
      </div>

      <label className="field">
        <span>Config JSON</span>
        <textarea aria-label="Config JSON" rows={10} {...form.register('configText')} />
        <small>{form.formState.errors.configText?.message}</small>
      </label>

      <div className="form-actions">
        <button type="submit" disabled={createConnection.isPending}>
          {createConnection.isPending ? 'Creating...' : 'Create connection'}
        </button>
        {createConnection.isSuccess ? (
          <p className="success-text">Connection request submitted successfully.</p>
        ) : null}
        {createConnection.error ? <p className="error-text">{createConnection.error.message}</p> : null}
      </div>
    </form>
  );
}

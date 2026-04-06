import type { ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useStartAllegroOAuthMutation } from '../hooks/use-start-allegro-oauth-mutation';
import {
  allegroSetupSchema,
  ALLEGRO_SETUP_DEFAULT_VALUES,
  toStartOAuthInput,
  type AllegroSetupFormSubmission,
  type AllegroSetupFormValues,
} from './allegro-setup.schema';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';

export function AllegroSetupForm(): ReactElement {
  const startOAuth = useStartAllegroOAuthMutation();
  const form = useForm<AllegroSetupFormValues, undefined, AllegroSetupFormSubmission>({
    defaultValues: ALLEGRO_SETUP_DEFAULT_VALUES,
    resolver: zodResolver(allegroSetupSchema),
  });

  const validationMessages = Object.values(form.formState.errors).flatMap((error) =>
    error?.message ? [String(error.message)] : [],
  );

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const redirectUri = `${window.location.origin}/integrations/allegro/connect/callback`;
      const { authorizationUrl } = await startOAuth.mutateAsync(
        toStartOAuthInput(values, redirectUri),
      );
      window.location.assign(authorizationUrl);
    } catch {
      return;
    }
  });

  return (
    <form className="form-card" onSubmit={(event) => void onSubmit(event)} noValidate>
      <div className="panel__header">
        <div>
          <p className="eyebrow">OAuth 2.0</p>
          <h3 className="section-title">Allegro app credentials</h3>
        </div>
        <span className="panel__meta">Entered once</span>
      </div>

      {form.formState.submitCount > 0 ? <FormErrorSummary errors={validationMessages} /> : null}
      {startOAuth.error ? (
        <Alert tone="error" title="Failed to start authorization">
          {startOAuth.error.message}
        </Alert>
      ) : null}

      <div className="form-grid">
        <FormField
          label="Connection name"
          name="name"
          error={form.formState.errors.name?.message}
          description="A label for this Allegro integration in OpenLinker."
        >
          <Input
            {...form.register('name')}
            placeholder="Allegro sandbox"
            invalid={Boolean(form.formState.errors.name)}
          />
        </FormField>

        <FormField
          label="Environment"
          name="environment"
          error={form.formState.errors.environment?.message}
        >
          <Select {...form.register('environment')} invalid={Boolean(form.formState.errors.environment)}>
            <option value="sandbox">Sandbox</option>
            <option value="production">Production</option>
          </Select>
        </FormField>

        <FormField
          label="Client ID"
          name="clientId"
          error={form.formState.errors.clientId?.message}
          description="OAuth client ID from your Allegro developer app."
        >
          <Input
            {...form.register('clientId')}
            placeholder="your-allegro-client-id"
            invalid={Boolean(form.formState.errors.clientId)}
            autoComplete="off"
          />
        </FormField>

        <FormField
          label="Client secret"
          name="clientSecret"
          error={form.formState.errors.clientSecret?.message}
          description="OAuth client secret from your Allegro developer app."
        >
          <Input
            {...form.register('clientSecret')}
            type="password"
            placeholder="your-allegro-client-secret"
            invalid={Boolean(form.formState.errors.clientSecret)}
            autoComplete="off"
          />
        </FormField>
      </div>

      <p className="muted-text panel-copy">
        After submitting, you will be redirected to Allegro to authorize this connection. Make sure
        your Allegro app has{' '}
        <span className="mono-text">{`${window.location.origin}/integrations/allegro/connect/callback`}</span>{' '}
        registered as a redirect URI.
      </p>

      <div className="form-actions">
        <Button type="submit" disabled={startOAuth.isPending}>
          {startOAuth.isPending ? 'Connecting…' : 'Connect with Allegro'}
        </Button>
      </div>
    </form>
  );
}

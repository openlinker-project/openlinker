/**
 * Shopify Setup Form
 *
 * Connects a Shopify store in one of three ways (#3974): app client id +
 * secret or a pre-issued access token create the connection directly; an
 * OAuth install sends the operator to Shopify to approve the app and the
 * callback page creates the connection. After a direct create the page offers
 * the connection test, which reports the shop, currency, tax mode and location.
 *
 * @module features/shopify/components
 */
import { useState, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import {
  useCreateConnectionMutation,
  useTestConnectionMutation,
  type ConnectionTestResult,
} from '../../connections';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { SegmentedControl } from '../../../shared/ui/segmented-control';
import { useToast } from '../../../shared/ui/toast-provider';
import { useStartShopifyOAuthMutation } from '../hooks/use-start-shopify-oauth-mutation';
import {
  SHOPIFY_SETUP_DEFAULT_VALUES,
  ShopifySetupErrorKeyValues,
  shopifySetupSchema,
  shopifyOAuthRedirectUri,
  toCreateConnectionInput,
  type ShopifySetupFormSubmission,
  type ShopifySetupFormValues,
  type ShopifySetupMode,
} from './shopify-setup.schema';

export function ShopifySetupForm(): ReactElement {
  const copy = useMessages('shopify').setup;
  const startOAuth = useStartShopifyOAuthMutation();
  const createConnection = useCreateConnectionMutation();
  const testConnection = useTestConnectionMutation();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [createdConnectionId, setCreatedConnectionId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  const form = useForm<ShopifySetupFormValues, undefined, ShopifySetupFormSubmission>({
    defaultValues: SHOPIFY_SETUP_DEFAULT_VALUES,
    resolver: zodResolver(shopifySetupSchema),
  });
  const mode = form.watch('mode');
  const errors = form.formState.errors;
  const errorText = (message: string | undefined): string | undefined =>
    message === undefined
      ? undefined
      : (ShopifySetupErrorKeyValues as readonly string[]).includes(message)
        ? copy[message as (typeof ShopifySetupErrorKeyValues)[number]]
        : message;
  const redirectUri = shopifyOAuthRedirectUri(window.location.origin);

  const modeOptions: ReadonlyArray<{ value: ShopifySetupMode; label: string; hint: string }> = [
    { value: 'client-credentials', label: copy.modeClientCredentials, hint: copy.modeClientCredentialsHint },
    { value: 'access-token', label: copy.modeAccessToken, hint: copy.modeAccessTokenHint },
    { value: 'oauth', label: copy.modeOauth, hint: copy.modeOauthHint },
  ];

  const onSubmit = form.handleSubmit(async (values) => {
    if (values.mode === 'oauth') {
      try {
        const { authorizationUrl } = await startOAuth.mutateAsync({
          storeDomain: values.storeDomain,
          clientId: values.clientId,
          clientSecret: values.clientSecret,
          redirectUri,
          connectionName: values.name,
          ...(values.locationId ? { locationId: values.locationId } : {}),
        });
        window.location.assign(authorizationUrl);
      } catch {
        // surfaced through startOAuth.error
      }
      return;
    }
    try {
      const created = await createConnection.mutateAsync(toCreateConnectionInput(values));
      form.reset(values);
      setCreatedConnectionId(created.id);
      showToast({ tone: 'success', title: copy.createdTitle, description: created.name });
    } catch {
      // surfaced through createConnection.error
    }
  });

  const onTest = async (): Promise<void> => {
    if (!createdConnectionId) return;
    setTestResult(null);
    try {
      setTestResult(await testConnection.mutateAsync(createdConnectionId));
    } catch {
      // surfaced through testConnection.error
    }
  };

  const validationMessages = Object.values(errors).flatMap((error) => {
    const text = errorText(error?.message === undefined ? undefined : String(error.message));
    return text ? [text] : [];
  });

  return (
    <>
      {createdConnectionId ? (
        <div className="wizard-card">
          <Alert tone="success" title={copy.createdTitle}>
            {copy.created}
          </Alert>
          {testResult ? (
            <Alert tone={testResult.success ? 'success' : 'error'} title={testResult.success ? copy.testPassed : copy.testFailed}>
              {testResult.message}
            </Alert>
          ) : null}
          {testConnection.error ? (
            <Alert tone="error" title={copy.testUnavailable}>
              {testConnection.error.message}
            </Alert>
          ) : null}
          <div className="form-actions">
            <Button type="button" onClick={() => void onTest()} disabled={testConnection.isPending}>
              {testConnection.isPending ? copy.testing : copy.test}
            </Button>
            <Button tone="secondary" type="button" onClick={() => void navigate(`/connections/${createdConnectionId}`)}>
              {copy.done}
            </Button>
          </div>
        </div>
      ) : (
        <form className="wizard-card" onSubmit={(event) => void onSubmit(event)} noValidate>
          {createConnection.error ? (
            <Alert tone="error">
              {interpolate(copy.createFailed, { message: createConnection.error.message })}
            </Alert>
          ) : null}
          {startOAuth.error ? (
            <Alert tone="error">
              {interpolate(copy.oauthFailed, { message: startOAuth.error.message })}
            </Alert>
          ) : null}
          {form.formState.submitCount > 0 && validationMessages.length > 0 ? (
            <FormErrorSummary errors={validationMessages} />
          ) : null}

          <FormField label={copy.connectionName} name="name" error={errorText(errors.name?.message)}>
            <Input {...form.register('name')} />
          </FormField>
          <FormField
            label={copy.storeDomain}
            name="storeDomain"
            description={copy.storeDomainHint}
            error={errorText(errors.storeDomain?.message)}
          >
            <Input {...form.register('storeDomain')} placeholder="my-shop.myshopify.com" />
          </FormField>

          <div className="form-field">
            <span className="form-field__label" id="shopify-mode-label">
              {copy.mode}
            </span>
            <SegmentedControl
              aria-labelledby="shopify-mode-label"
              options={modeOptions.map(({ value, label }) => ({ value, label }))}
              value={mode}
              onChange={(next) => form.setValue('mode', next)}
            />
            <p className="form-field__description">
              {modeOptions.find((option) => option.value === mode)?.hint}
            </p>
          </div>

          {mode === 'access-token' ? (
            <FormField
              label={copy.accessToken}
              name="accessToken"
              description={copy.accessTokenHint}
              error={errorText(errors.accessToken?.message)}
            >
              <Input type="password" autoComplete="off" {...form.register('accessToken')} />
            </FormField>
          ) : (
            <>
              <FormField label={copy.clientId} name="clientId" error={errorText(errors.clientId?.message)}>
                <Input autoComplete="off" {...form.register('clientId')} />
              </FormField>
              <FormField label={copy.clientSecret} name="clientSecret" error={errorText(errors.clientSecret?.message)}>
                <Input type="password" autoComplete="off" {...form.register('clientSecret')} />
              </FormField>
            </>
          )}
          {mode === 'oauth' ? (
            <Alert tone="info">
              <span className="mono-text">{interpolate(copy.redirectUrl, { url: redirectUri })}</span>
            </Alert>
          ) : null}

          <FormField label={copy.locationId} name="locationId" description={copy.locationIdHint}>
            <Input {...form.register('locationId')} />
          </FormField>

          <div className="form-actions">
            <Button type="submit" disabled={createConnection.isPending || startOAuth.isPending}>
              {mode === 'oauth' ? copy.submitOauth : copy.submitCreate}
            </Button>
          </div>
        </form>
      )}
    </>
  );
}

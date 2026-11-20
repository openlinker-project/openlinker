/**
 * Amazon Setup Form (#4186)
 *
 * Creates an Amazon connection from the UI: region and environment, the
 * marketplaces to sell on, the role (today the sales channel: orders and
 * offers), the merchant token, the LWA app credentials and, optionally, the
 * SQS queue Amazon delivers order notifications to. After the create the
 * operator can run the connection test, then open the connection page.
 *
 * The page renders it behind `AccessGate` (`connections:write`); a read-only
 * session sees an explanation instead.
 *
 * Only the marketplaces of the chosen region are offered, and changing the
 * region drops the ones it does not serve; the schema refuses a mix anyway.
 *
 * A notice up front says what a connection is on Amazon's side: one seller
 * account in one region. The region cannot be changed afterwards (the API
 * refuses it), and in a region without a unified account (Far East) the
 * picker takes a single marketplace.
 *
 * @module features/amazon/components
 */
import { useState, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import {
  describeConnectionTestFailure,
  useCreateConnectionMutation,
  useTestConnectionMutation,
  type ConnectionTestResult,
} from '../../connections';
import { describeApiError } from '../../../shared/api/describe-api-error';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { isSingleMarketplaceRegion, marketplacesForRegion, type AmazonRegion } from '../lib/amazon-marketplaces';
import { AmazonMarketplacePicker } from './amazon-marketplace-picker';
import {
  AMAZON_SETUP_DEFAULT_VALUES,
  AmazonSetupErrorKeyValues,
  amazonSetupSchema,
  toCreateConnectionInput,
  type AmazonSetupErrorKey,
  type AmazonSetupFormSubmission,
  type AmazonSetupFormValues,
} from './amazon-setup.schema';

export function AmazonSetupForm(): ReactElement {
  const copy = useMessages('amazon').setup;
  const createConnection = useCreateConnectionMutation();
  const testConnection = useTestConnectionMutation();
  const navigate = useNavigate();
  const [createdConnectionId, setCreatedConnectionId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  const form = useForm<AmazonSetupFormValues, undefined, AmazonSetupFormSubmission>({
    defaultValues: AMAZON_SETUP_DEFAULT_VALUES,
    resolver: zodResolver(amazonSetupSchema),
  });
  const region = form.watch('region');
  const environment = form.watch('environment');
  const selected = form.watch('marketplaceIds');
  const role = form.watch('role');
  const offers = form.watch('offers') && role !== 'master';
  const errors = form.formState.errors;

  const errorText = (message: string | undefined): string | undefined =>
    message !== undefined && (AmazonSetupErrorKeyValues as readonly string[]).includes(message)
      ? copy.errors[message as AmazonSetupErrorKey]
      : message;

  const onRegionChange = (next: AmazonRegion): void => {
    const served = new Set(marketplacesForRegion(next).map((marketplace) => marketplace.id));
    const kept = selected.filter((id) => served.has(id));
    form.setValue('region', next);
    form.setValue('marketplaceIds', isSingleMarketplaceRegion(next) ? kept.slice(0, 1) : kept, {
      shouldValidate: form.formState.submitCount > 0,
    });
  };

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const created = await createConnection.mutateAsync(toCreateConnectionInput(values));
      form.reset(values);
      setCreatedConnectionId(created.id);
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

  if (createdConnectionId) {
    return (
      <div className="wizard-card">
        <Alert tone="success" title={copy.createdTitle}>
          {copy.created}
        </Alert>
        {testResult ? (
          <Alert
            tone={testResult.success ? 'success' : 'error'}
            title={testResult.success ? copy.testPassed : copy.testFailed}
          >
            {/* The tester's own text is English; a failure is worded from its outcome. */}
            {testResult.success ? null : describeConnectionTestFailure(testResult)}
          </Alert>
        ) : null}
        {testConnection.error ? (
          <Alert tone="error" title={copy.testUnavailable}>
            {describeApiError(testConnection.error, 'amazon')}
          </Alert>
        ) : null}
        <div className="form-actions">
          <Button type="button" onClick={() => void onTest()} disabled={testConnection.isPending}>
            {testConnection.isPending ? copy.testing : copy.test}
          </Button>
          <Button
            tone="secondary"
            type="button"
            onClick={() => void navigate(`/connections/${createdConnectionId}`)}
          >
            {copy.done}
          </Button>
        </div>
      </div>
    );
  }

  const validationMessages = Object.values(errors).flatMap((fieldError) => {
    const text = errorText(fieldError?.message === undefined ? undefined : String(fieldError.message));
    return text ? [text] : [];
  });
  const marketplaces = marketplacesForRegion(region);
  const singleMarketplace = isSingleMarketplaceRegion(region);

  return (
    <form className="wizard-card" onSubmit={(event) => void onSubmit(event)} noValidate>
      {createConnection.error ? (
        <Alert tone="error">
          {interpolate(copy.createFailed, {
            message: describeApiError(createConnection.error, 'amazon'),
          })}
        </Alert>
      ) : null}
      {form.formState.submitCount > 0 && validationMessages.length > 0 ? (
        <FormErrorSummary errors={validationMessages} />
      ) : null}

      <Alert tone="info" title={copy.accountNotice.title}>
        {copy.accountNotice.oneRegion} {copy.accountNotice.regionFixed} {copy.accountNotice.farEast}
      </Alert>

      <FormField label={copy.connectionName} name="name" error={errorText(errors.name?.message)}>
        <Input {...form.register('name')} placeholder={copy.connectionNamePlaceholder} />
      </FormField>

      <FormField label={copy.region} name="region" description={copy.regionHint}>
        <Select value={region} onChange={(event) => onRegionChange(event.target.value as AmazonRegion)}>
          <option value="eu">{copy.regions.eu}</option>
          <option value="na">{copy.regions.na}</option>
          <option value="fe">{copy.regions.fe}</option>
        </Select>
      </FormField>

      <FormField label={copy.environment} name="environment">
        <Select {...form.register('environment')}>
          <option value="production">{copy.environments.production}</option>
          <option value="sandbox">{copy.environments.sandbox}</option>
        </Select>
      </FormField>
      {environment === 'sandbox' ? (
        <Alert tone="warning" density="compact">
          {copy.sandboxNotice}
        </Alert>
      ) : null}

      <FormField
        label={copy.marketplaces}
        name="amazon-marketplaces"
        description={
          marketplaces.length === 0
            ? copy.marketplacesNone
            : singleMarketplace
              ? copy.marketplacesHintSingle
              : copy.marketplacesHint
        }
        error={errorText(errors.marketplaceIds?.message)}
      >
        <AmazonMarketplacePicker
          marketplaces={marketplaces}
          selected={selected}
          onChange={(ids) =>
            form.setValue('marketplaceIds', ids, { shouldValidate: form.formState.submitCount > 0 })
          }
          labelOf={(marketplace) =>
            interpolate(copy.marketplaceOption, {
              country: copy.countries[marketplace.country as keyof typeof copy.countries] ?? marketplace.country,
              currency: marketplace.currency,
            })
          }
          placeholder={copy.marketplacesPlaceholder}
          invalid={Boolean(errors.marketplaceIds)}
          disabled={marketplaces.length === 0}
          single={singleMarketplace}
        />
      </FormField>

      <fieldset className="form-field">
        <legend className="form-field__label">{copy.role}</legend>
        <label className="amazon-checkbox-row">
          <input type="radio" value="sales-channel" {...form.register('role')} />
          <span>
            {copy.roleSalesChannel}
            <span className="form-field__description form-field__description--block">
              {copy.roleSalesChannelHint}
            </span>
          </span>
        </label>
        <label className="amazon-checkbox-row">
          <input type="radio" value="master" {...form.register('role')} />
          <span>
            {copy.roleMaster}
            <span className="form-field__description form-field__description--block">{copy.roleMasterHint}</span>
          </span>
        </label>
      </fieldset>

      <fieldset className="form-field">
        <legend className="form-field__label">{copy.handles}</legend>
        <label className="amazon-checkbox-row">
          <input type="checkbox" {...form.register('orders')} />
          <span>
            {copy.orders}
            <span className="form-field__description form-field__description--block">
              {copy.ordersHint}
            </span>
          </span>
        </label>
        <label className="amazon-checkbox-row">
          {/* Controlled rather than registered: a catalogue master never gets
              offers, so the box reads unticked, while the form keeps the
              sales-channel choice for a switch back. */}
          <input
            type="checkbox"
            checked={offers}
            disabled={role === 'master'}
            onChange={(event) => {
              form.setValue('offers', event.target.checked);
              // The "orders or offers" refusal is reported on `orders`.
              if (form.formState.submitCount > 0) void form.trigger(['orders', 'offers']);
            }}
          />
          <span className={role === 'master' ? 'muted-text' : undefined}>
            {copy.offers}
            <span className="form-field__description form-field__description--block">
              {role === 'master' ? copy.offersMasterHint : copy.offersHint}
            </span>
          </span>
        </label>
        {errors.orders ? (
          <p className="form-field__error" role="alert">
            {errorText(errors.orders.message)}
          </p>
        ) : null}
      </fieldset>

      <FormField
        label={copy.sellerId}
        name="sellerId"
        description={offers || role === 'master' ? copy.sellerIdHintRequired : copy.sellerIdHint}
        error={errorText(errors.sellerId?.message)}
      >
        <Input {...form.register('sellerId')} className="mono-text" placeholder="A2EXAMPLE12345" />
      </FormField>

      <FormField label={copy.clientId} name="clientId" error={errorText(errors.clientId?.message)}>
        <Input
          autoComplete="off"
          className="mono-text"
          placeholder="amzn1.application-oa2-client..."
          {...form.register('clientId')}
        />
      </FormField>
      <FormField label={copy.clientSecret} name="clientSecret" error={errorText(errors.clientSecret?.message)}>
        <Input type="password" autoComplete="off" {...form.register('clientSecret')} />
      </FormField>
      <FormField
        label={copy.refreshToken}
        name="refreshToken"
        description={copy.refreshTokenHint}
        error={errorText(errors.refreshToken?.message)}
      >
        <Input type="password" autoComplete="off" {...form.register('refreshToken')} />
      </FormField>

      <details className="form-field">
        <summary className="form-field__label">{copy.notifications}</summary>
        <p className="form-field__description">{copy.notificationsHint}</p>
        <FormField
          label={copy.queueUrl}
          name="notificationQueueUrl"
          error={errorText(errors.notificationQueueUrl?.message)}
        >
          <Input
            className="mono-text"
            placeholder="https://sqs.eu-west-1.amazonaws.com/123456789012/amazon-notifications"
            {...form.register('notificationQueueUrl')}
          />
        </FormField>
        <FormField
          label={copy.awsAccessKeyId}
          name="awsAccessKeyId"
          error={errorText(errors.awsAccessKeyId?.message)}
        >
          <Input autoComplete="off" className="mono-text" {...form.register('awsAccessKeyId')} />
        </FormField>
        <FormField label={copy.awsSecretAccessKey} name="awsSecretAccessKey">
          <Input type="password" autoComplete="off" {...form.register('awsSecretAccessKey')} />
        </FormField>
      </details>

      <div className="form-actions">
        <Button type="submit" disabled={createConnection.isPending}>
          {createConnection.isPending ? copy.creating : copy.submit}
        </Button>
      </div>
    </form>
  );
}

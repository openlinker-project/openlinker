import type { ReactElement } from 'react';
import { interpolate, renderRich, useMessages } from '../../../shared/i18n';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { usePlatform, usePlatforms } from '../../../shared/plugins';
import { useCreateConnectionMutation } from '../hooks/use-create-connection-mutation';
import { useAdaptersQuery } from '../../adapters';
import {
  buildCreateConnectionSchema,
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
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { demoReadOnlyActionMessage } from '../../../shared/config/demo-mode';
import { useDemoMode } from '../../system';
import { captureDemoEvent } from '../../demo';
import { describeApiError } from '../../../shared/api/describe-api-error';

const DEFAULT_CONFIG = JSON.stringify(
  {
    baseUrl: 'https://example.com',
  },
  null,
  2
);

const DEFAULT_VALUES: CreateConnectionFormValues = {
  adapterKey: '',
  configText: DEFAULT_CONFIG,
  credentialsRef: '',
  credentialsJson: '',
  enabledCapabilities: '',
  name: '',
  platformType: '',
};

// Technical examples, not prose: the same in every language.
const CREDENTIALS_REF_EXAMPLE = 'db:cred_123';
const CREDENTIALS_JSON_EXAMPLE = '{ "bridgeToken": "dev-bridge-key-2026" }';
const CAPABILITIES_EXAMPLE = 'Invoicing';
const ADAPTER_KEY_EXAMPLE = 'prestashop.webservice.v1';

export function CreateConnectionForm(): ReactElement {
  const copy = useMessages('connections').createConnectionForm;
  const createConnection = useCreateConnectionMutation();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const plugins = usePlatforms();
  const demoMode = useDemoMode();
  // The page-level "New connection" CTA that opens this form stays enabled
  // for a demo viewer (#1667); only this form's own final submit is locked,
  // matching EditConnectionForm's "Save changes" treatment (#1615).
  const write = useWriteAccess('connections:write', demoMode);
  const platformOptions = plugins
    .filter((p) => p.hideFromCreateConnection !== true)
    .map((p) => ({ value: p.platformType, label: p.displayName }));
  // The schema depends on the SELECTED platform's adapter, which is only known
  // after the operator picks one — so the resolver delegates through a ref
  // rather than being captured once at first render. Passing
  // `zodResolver(credentialSchema)` directly relies on RHF re-reading
  // `_options.resolver` every render, which is undocumented; moving the
  // assignment into an effect would make it stale for a submit in the same
  // tick as the platform change. Neither alternative is an improvement — do
  // not "simplify" this back.
  const schemaRef = useRef(buildCreateConnectionSchema());
  const form = useForm<CreateConnectionFormValues, undefined, CreateConnectionFormSubmission>({
    defaultValues: DEFAULT_VALUES,
    resolver: (values, context, options) =>
      zodResolver(schemaRef.current)(values, context, options),
  });

  const watchedPlatformType = form.watch('platformType');
  // Platforms that drive the operator through an OAuth redirect (today:
  // Allegro) suppress the inline create-submit affordances — the registered
  // platform wizard owns the rest of the flow.
  const selectedPlugin = usePlatform(watchedPlatformType);
  const requiresExternalAuthRedirect = selectedPlugin?.requiresExternalAuthRedirect === true;

  // Whether this destination needs credentials is the ADAPTER's own
  // declaration (#2405, ADR-055), read from `GET /adapters` — never a literal
  // `platformType` check, which is ESLint-banned (#578/#579) and would be
  // unavailable to a third-party OMS adapter. The comparison below is
  // variable-to-variable and therefore permitted.
  //
  // Absent (still loading, or an adapter that declares nothing) resolves to
  // `true`, mirroring the backend default: the pre-arrival state shows the
  // credential fields rather than briefly hiding them.
  const adaptersQuery = useAdaptersQuery();
  // Prefer the platform DEFAULT, because that is what the backend resolves when
  // the form omits `adapterKey` (`getDefaultAdapterKey`). First-match-wins would
  // read a non-default sibling if a platform ever ships two adapters.
  const platformAdapters =
    adaptersQuery.data?.filter((adapter) => adapter.platformType === watchedPlatformType) ?? [];
  const selectedAdapter =
    platformAdapters.find((adapter) => adapter.isDefault === true) ?? platformAdapters[0];
  const requiresCredentials = selectedAdapter?.requiresCredentials !== false;
  const credentialSchema = useMemo(
    () => buildCreateConnectionSchema({ requiresCredentials }),
    [requiresCredentials]
  );
  schemaRef.current = credentialSchema;

  // Clear any credential the operator typed for a PREVIOUS platform when the
  // selection changes. RHF keeps values across unmount, so without this a
  // credentials JSON typed for PrestaShop survives a switch to a
  // credential-less destination and is submitted invisibly — the inputs are no
  // longer on screen to show it. `toCreateConnectionInput` also drops them,
  // deliberately: this keeps the form state honest, that keeps the request
  // honest, and neither alone covers the other's caller.
  useEffect(() => {
    form.setValue('credentialsRef', '');
    form.setValue('credentialsJson', '');
    // Keyed on the platform change alone. `form` is a stable RHF instance, so
    // omitting it cannot go stale.
  }, [watchedPlatformType]);

  const validationMessages = Object.values(form.formState.errors).flatMap((fieldError) =>
    fieldError?.message ? [String(fieldError.message)] : []
  );

  const onSubmit = form.handleSubmit(async (values) => {
    // Guard against Enter-key form submission while a platform-specific wizard
    // (e.g. Allegro) is selected: the schema still validates hidden fields, so
    // submission would fail silently without visible feedback.
    if (requiresExternalAuthRedirect) return;
    try {
      const created = await createConnection.mutateAsync(
        toCreateConnectionInput(values, { requiresCredentials })
      );
      showToast({
        tone: 'success',
        title: copy.createdTitle,
        description: interpolate(copy.createdDescription, { name: created.name }),
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
            <p className="eyebrow">{copy.eyebrow}</p>
            <h3 className="section-title">{copy.title}</h3>
          </div>
          <span className="panel__meta">{copy.meta}</span>
        </div>

        {form.formState.submitCount > 0 ? <FormErrorSummary errors={validationMessages} /> : null}
        {createConnection.error ? (
          <Alert tone="error" title={copy.errorTitle}>
            {describeApiError(createConnection.error, 'connections')}
          </Alert>
        ) : null}

        <div className="form-grid">
          <FormField
            label={copy.fields.name.label}
            name="name"
            error={form.formState.errors.name?.message}
          >
            <Input
              {...form.register('name')}
              placeholder={copy.fields.name.placeholder}
              invalid={Boolean(form.formState.errors.name)}
            />
          </FormField>

          <FormField
            label={copy.fields.platformType.label}
            name="platformType"
            error={form.formState.errors.platformType?.message}
            description={copy.fields.platformType.description}
          >
            <Select
              {...form.register('platformType')}
              invalid={Boolean(form.formState.errors.platformType)}
            >
              <option value="">{copy.fields.platformType.placeholder}</option>
              {platformOptions.map((platform) => (
                <option key={platform.value} value={platform.value}>
                  {platform.label}
                </option>
              ))}
            </Select>
          </FormField>

          {!requiresCredentials && selectedPlugin ? (
            <Alert
              tone="info"
              title={interpolate(copy.noCredentials.title, { platform: selectedPlugin.displayName })}
            >
              {interpolate(copy.noCredentials.body, { platform: selectedPlugin.displayName })}
            </Alert>
          ) : null}

          {requiresExternalAuthRedirect || !requiresCredentials ? null : (
            <FormField
              label={copy.fields.credentialsRef.label}
              name="credentialsRef"
              error={form.formState.errors.credentialsRef?.message}
              description={copy.fields.credentialsRef.description}
            >
              <Input
                {...form.register('credentialsRef')}
                placeholder={CREDENTIALS_REF_EXAMPLE}
                invalid={Boolean(form.formState.errors.credentialsRef)}
              />
            </FormField>
          )}

          {requiresExternalAuthRedirect || !requiresCredentials ? null : (
            <FormField
              label={copy.fields.credentialsJson.label}
              name="credentialsJson"
              error={form.formState.errors.credentialsJson?.message}
              description={copy.fields.credentialsJson.description}
            >
              <Textarea
                {...form.register('credentialsJson')}
                rows={3}
                placeholder={CREDENTIALS_JSON_EXAMPLE}
                invalid={Boolean(form.formState.errors.credentialsJson)}
              />
            </FormField>
          )}

          {requiresExternalAuthRedirect ? null : (
            <FormField
              label={copy.fields.enabledCapabilities.label}
              name="enabledCapabilities"
              error={form.formState.errors.enabledCapabilities?.message}
              description={copy.fields.enabledCapabilities.description}
            >
              <Input
                {...form.register('enabledCapabilities')}
                placeholder={CAPABILITIES_EXAMPLE}
                invalid={Boolean(form.formState.errors.enabledCapabilities)}
              />
            </FormField>
          )}

          {requiresExternalAuthRedirect ? null : (
            <FormField
              label={copy.fields.adapterKey.label}
              name="adapterKey"
              error={form.formState.errors.adapterKey?.message}
              description={copy.fields.adapterKey.description}
            >
              <Input
                {...form.register('adapterKey')}
                placeholder={ADAPTER_KEY_EXAMPLE}
                invalid={Boolean(form.formState.errors.adapterKey)}
              />
            </FormField>
          )}
        </div>

        {requiresExternalAuthRedirect && selectedPlugin ? (
          <Alert
            tone="info"
            title={interpolate(copy.oauth.title, { platform: selectedPlugin.displayName })}
          >
            {renderRich(
              copy.oauth.body,
              {
                link: (text) =>
                  selectedPlugin.setupCard ? (
                    <Link to={selectedPlugin.setupCard.to}>{text}</Link>
                  ) : (
                    text
                  ),
              },
              { platform: selectedPlugin.displayName },
            )}
          </Alert>
        ) : (
          <FormField
            label={copy.fields.configJson.label}
            name="configText"
            error={form.formState.errors.configText?.message}
            description={copy.fields.configJson.description}
          >
            <Textarea
              {...form.register('configText')}
              rows={10}
              invalid={Boolean(form.formState.errors.configText)}
            />
          </FormField>
        )}

        {requiresExternalAuthRedirect ? null : (
          <div className="form-actions">
            <ReadOnlyLock
              active={write.demoReadOnly}
              message={demoReadOnlyActionMessage()}
              onLockedClick={() =>
                captureDemoEvent('demo_connection_create_attempted', {
                  platform: watchedPlatformType,
                })
              }
            >
              <Button type="submit" disabled={createConnection.isPending || write.demoReadOnly}>
                {createConnection.isPending ? copy.creating : copy.create}
              </Button>
            </ReadOnlyLock>
            <Button
              tone="secondary"
              onClick={() => setIsResetDialogOpen(true)}
              disabled={createConnection.isPending}
            >
              {copy.reset.action}
            </Button>
          </div>
        )}
      </form>

      <ConfirmDialog
        open={isResetDialogOpen}
        onOpenChange={setIsResetDialogOpen}
        title={copy.reset.title}
        description={copy.reset.description}
        confirmLabel={copy.reset.action}
        cancelLabel={copy.reset.cancel}
        tone="danger"
        onConfirm={() => {
          form.reset(DEFAULT_VALUES);
          createConnection.reset();
          setIsResetDialogOpen(false);
          showToast({
            tone: 'info',
            title: copy.reset.doneTitle,
            description: copy.reset.doneDescription,
          });
        }}
      />
    </>
  );
}

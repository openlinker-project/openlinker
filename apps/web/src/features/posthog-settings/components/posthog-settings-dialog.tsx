/**
 * PostHog Settings Dialog
 *
 * Edit modal for the DB-backed PostHog analytics settings. Wraps the Dialog
 * primitive + React Hook Form / Zod, mirroring
 * `mailer-settings/components/mailer-settings-dialog.tsx`. Submitting the
 * form updates the non-secret settings fields and — only when a new API key
 * was typed — rotates the key in a second request. The API key field is
 * never pre-filled; `view.apiKeyConfigured` drives the "Configured" /
 * "Not set" hint instead.
 *
 * The region select replaces a raw host text field (#1685): a real incident
 * (API key on US cloud, host defaulting to EU) was caught only by manual
 * testing, since PostHog silently accepts events for any key on `/capture`
 * but rejects a region mismatch on `/flags/`. "Send test event" below calls
 * `/flags/` directly so an admin catches that mismatch before saving.
 *
 * @module apps/web/src/features/posthog-settings/components
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { describeApiError } from '../../../shared/api/describe-api-error';
import { useMessages, usePlural } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../shared/ui/dialog';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { useToast } from '../../../shared/ui/toast-provider';
import { PosthogRegionValues, type PosthogRegion, type PosthogSettingsView } from '../api/posthog-settings.types';
import { useClearPosthogCredentialsMutation } from '../hooks/use-clear-posthog-credentials-mutation';
import { useSetPosthogCredentialsMutation } from '../hooks/use-set-posthog-credentials-mutation';
import { useUpdatePosthogSettingsMutation } from '../hooks/use-update-posthog-settings-mutation';
import { ProductEventsSection } from './product-events-section';
import {
  createPosthogSettingsFormSchema,
  type PosthogSettingsFormSubmission,
  type PosthogSettingsFormValues,
} from './posthog-settings-form.schema';

interface PosthogSettingsDialogProps {
  open: boolean;
  view: PosthogSettingsView;
  onClose: () => void;
}

const REGION_HOST: Record<Exclude<PosthogRegion, 'custom'>, string> = {
  eu: 'https://eu.i.posthog.com',
  us: 'https://us.i.posthog.com',
};

type TestEventStatus = 'idle' | 'testing' | 'success' | 'error' | 'missing-input';

function toFormValues(view: PosthogSettingsView): PosthogSettingsFormValues {
  return {
    enabled: view.enabled,
    region: view.region,
    customHost: view.customHost ?? '',
    autocapture: view.autocapture,
    sessionRecording: view.sessionRecording,
    productEventsEnabled: view.productEventsEnabled,
    enabledEventGroups: view.enabledEventGroups,
    apiKey: '',
  };
}

function resolveHost(region: PosthogRegion, customHost: string): string | null {
  if (region === 'custom') {
    return customHost.length > 0 ? customHost : null;
  }
  return REGION_HOST[region];
}

export function PosthogSettingsDialog({
  open,
  view,
  onClose,
}: PosthogSettingsDialogProps): ReactElement {
  const { showToast } = useToast();
  const messages = useMessages('posthog-settings');
  const copy = messages.posthogSettingsDialog;
  const plural = usePlural();
  const schema = useMemo(
    () => createPosthogSettingsFormSchema(messages.posthogSettingsFormSchema),
    [messages.posthogSettingsFormSchema],
  );
  const updateMutation = useUpdatePosthogSettingsMutation();
  const setCredentialsMutation = useSetPosthogCredentialsMutation();
  const clearCredentialsMutation = useClearPosthogCredentialsMutation();
  const [testStatus, setTestStatus] = useState<TestEventStatus>('idle');

  const form = useForm<PosthogSettingsFormValues, undefined, PosthogSettingsFormSubmission>({
    defaultValues: toFormValues(view),
    resolver: zodResolver(schema),
  });

  // Reset the form (and any prior mutation error) whenever the dialog opens —
  // matches the #478 fix in ai-provider-key-dialog.tsx: depend on the
  // destructured stable methods, not the wrapping `form` / mutation objects,
  // which get a fresh identity every render and would loop the effect.
  const { reset: resetForm } = form;
  const { reset: resetUpdateMutation } = updateMutation;
  const { reset: resetCredentialsMutation } = setCredentialsMutation;
  useEffect(() => {
    if (open) {
      resetForm(toFormValues(view));
      resetUpdateMutation();
      resetCredentialsMutation();
      setTestStatus('idle');
    }
    // `view` is intentionally excluded: resetting on every background
    // refetch (not just on open) would clobber an in-progress edit.
  }, [open, resetForm, resetUpdateMutation, resetCredentialsMutation]);

  const enabled = form.watch('enabled');
  const region = form.watch('region');
  const customHost = form.watch('customHost');
  const apiKey = form.watch('apiKey');
  const resolvedHost = resolveHost(region, customHost);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await updateMutation.mutateAsync({
        enabled: values.enabled,
        region: values.region,
        customHost: values.region === 'custom' ? values.customHost : null,
        autocapture: values.autocapture,
        sessionRecording: values.sessionRecording,
        productEventsEnabled: values.productEventsEnabled,
        enabledEventGroups: values.enabledEventGroups,
      });

      if (values.apiKey.length > 0) {
        await setCredentialsMutation.mutateAsync({ apiKey: values.apiKey });
      }

      showToast({
        tone: 'success',
        title: copy.savedToastTitle,
        description: copy.savedToastDescription,
      });
      onClose();
    } catch {
      // Surfaced via mutationError → <Alert> below.
    }
  });

  const handleResetToEnvironment = async (): Promise<void> => {
    try {
      await clearCredentialsMutation.mutateAsync();
      await updateMutation.mutateAsync({
        enabled: false,
        region: view.region,
        customHost: view.customHost,
        autocapture: view.autocapture,
        sessionRecording: view.sessionRecording,
        productEventsEnabled: false,
        enabledEventGroups: [],
      });
      form.setValue('apiKey', '');
      form.setValue('enabled', false);
      showToast({
        tone: 'success',
        title: copy.resetToastTitle,
        description: copy.resetToastDescription,
      });
    } catch (error) {
      showToast({
        tone: 'error',
        title: copy.resetErrorTitle,
        description: describeApiError(error, 'posthog-settings'),
      });
    }
  };

  const handleSendTestEvent = async (): Promise<void> => {
    if (!resolvedHost || apiKey.trim().length === 0) {
      setTestStatus('missing-input');
      return;
    }
    setTestStatus('testing');
    try {
      // Deliberately NOT routed through the shared API client — this fires a
      // request directly against PostHog's own public endpoint (from the
      // browser, using the not-yet-saved key the admin just typed) to
      // validate the key+region pair before persisting. PostHog's /capture
      // endpoint always returns 200 regardless of key validity; /flags/ is
      // the endpoint that actually rejects a region/key mismatch (confirmed
      // manually — see #1685).
      // PostHog's own public endpoint directly, not our API, so the shared
      // API client (which targets VITE_API_BASE_URL) does not apply here.
      // eslint-disable-next-line no-restricted-globals -- intentional external fetch, see comment above
      const response = await fetch(`${resolvedHost}/flags/?v=2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey.trim(), distinct_id: 'openlinker-settings-test' }),
      });
      setTestStatus(response.ok ? 'success' : 'error');
    } catch {
      setTestStatus('error');
    }
  };

  const validationMessages = Object.values(form.formState.errors)
    .map((entry) => entry?.message)
    .filter((message): message is string => typeof message === 'string');

  const showValidationSummary = form.formState.submitCount > 0 && validationMessages.length > 0;

  const mutationError = updateMutation.error ?? setCredentialsMutation.error;
  const isSaving = updateMutation.isPending || setCredentialsMutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>

        {view.wouldOverrideEnv ? (
          <Alert tone="warning" title={copy.overrideTitle}>
            {plural(view.overriddenEnvVars.length, copy.overrideMessage, {
              vars: view.overriddenEnvVars.join(', '),
            })}
          </Alert>
        ) : null}

        {mutationError ? (
          <Alert tone="error" title={copy.saveErrorTitle}>
            {describeApiError(mutationError, 'posthog-settings')}
          </Alert>
        ) : null}

        <form
          onSubmit={(event) => {
            void onSubmit(event);
          }}
          noValidate
        >
          {showValidationSummary ? <FormErrorSummary errors={validationMessages} /> : null}

          <label className="posthog-settings-checkbox">
            <input type="checkbox" {...form.register('enabled')} />
            <span>{copy.enableLabel}</span>
          </label>

          <FormField
            label={copy.apiKeyLabel}
            name="apiKey"
            description={
              view.apiKeyConfigured
                ? copy.apiKeyConfigured
                : copy.apiKeyNotSet
            }
            error={form.formState.errors.apiKey?.message}
          >
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={copy.apiKeyPlaceholder}
              {...form.register('apiKey')}
            />
          </FormField>

          <FormField label={copy.regionLabel} name="region">
            <Select {...form.register('region')}>
              {PosthogRegionValues.map((value) => (
                <option key={value} value={value}>
                  {copy.region[value]}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label={copy.resolvedHostLabel} name="resolvedHost">
            <Input className="mono-text" disabled value={resolvedHost ?? copy.resolvedHostEmpty} />
          </FormField>

          {region === 'custom' ? (
            <FormField
              label={copy.customHostLabel}
              name="customHost"
              error={form.formState.errors.customHost?.message}
            >
              <Input
                type="url"
                placeholder={copy.customHostPlaceholder}
                {...form.register('customHost')}
              />
            </FormField>
          ) : null}

          <label className="posthog-settings-checkbox">
            <input type="checkbox" {...form.register('autocapture')} />
            <span>{copy.autocaptureLabel}</span>
          </label>

          <label className="posthog-settings-checkbox">
            <input type="checkbox" {...form.register('sessionRecording')} />
            <span>{copy.sessionRecordingLabel}</span>
          </label>

          <ProductEventsSection
            form={form}
            disabled={!enabled || !form.watch('productEventsEnabled')}
          />

          <div className="posthog-settings-test-row">
            <Button
              type="button"
              tone="secondary"
              className="button--sm"
              disabled={testStatus === 'testing'}
              onClick={() => {
                void handleSendTestEvent();
              }}
            >
              {testStatus === 'testing' ? copy.sending : copy.sendTest}
            </Button>
            {testStatus === 'success' ? (
              <span className="context-chip context-chip--success posthog-settings-test-result">
                {copy.testAccepted}
              </span>
            ) : null}
            {testStatus === 'error' ? (
              <span className="context-chip context-chip--warning posthog-settings-test-result">
                {copy.testRejected}
              </span>
            ) : null}
            {testStatus === 'missing-input' ? (
              <span className="context-chip context-chip--neutral posthog-settings-test-result">
                {copy.testMissingInput}
              </span>
            ) : null}
          </div>

          {view.apiKeyConfigured ? (
            <Button
              type="button"
              tone="danger"
              className="button--sm"
              disabled={clearCredentialsMutation.isPending || updateMutation.isPending}
              onClick={() => {
                void handleResetToEnvironment();
              }}
            >
              {clearCredentialsMutation.isPending ? copy.resetting : copy.reset}
            </Button>
          ) : null}

          {enabled && !view.apiKeyConfigured && apiKey.trim().length === 0 ? (
            <p className="muted-text posthog-settings-hint" role="status">
              {copy.noKeyHint}
            </p>
          ) : null}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" tone="ghost">
                {copy.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? copy.saving : copy.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

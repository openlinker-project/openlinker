/**
 * Infakt Setup Form
 *
 * Single-step wizard for creating an inFakt connection. Collects:
 *   - Connection name
 *   - inFakt API key (the only credential)
 *   - Environment (Production/Sandbox, #2174) — persisted as the neutral
 *     `config.environment` choice; the BE resolves it to a base URL
 *   - Default payment method sent on every issued invoice/correction (#1303)
 *
 * Mirrors `ErliSetupForm`: one credential, no capabilities step (capabilities
 * default silently to the adapter manifest's supported set on the omitted
 * path). After a successful create the form surfaces a "Test connection"
 * affordance that calls the generic `/connections/:id/test` endpoint and
 * renders the `ConnectionTestResult`. Abandon-prevention triggers a native
 * confirm dialog when the form is dirty and the tab is closed.
 *
 * @module features/connections/components
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import {
  useCreateConnectionMutation,
  useTestConnectionMutation,
  useUpdateConnectionMutation,
  useBankAccountsQuery,
  usePickBankAccount,
  type Connection,
  type ConnectionTestResult,
  describeConnectionTestFailure,
} from '../../../features/connections';
import { useNavigate } from 'react-router-dom';
import {
  INFAKT_SETUP_DEFAULT_VALUES,
  createInfaktSetupSchema,
  toCreateConnectionInput,
  type InfaktSetupFormSubmission,
  type InfaktSetupFormValues,
} from './infakt-setup.schema';
import { Alert } from '../../../shared/ui/alert';
import { BackLink } from '../../../shared/ui/back-link';
import { Button } from '../../../shared/ui/button';
import { FormErrorSummary } from '../../../shared/ui/form-error-summary';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { useToast } from '../../../shared/ui/toast-provider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../shared/ui/dialog';
import { InfaktWebhookConfigDialog } from './infakt-webhook-config';
import { interpolate, renderRich } from '../../../shared/i18n';
import { useInfaktMessages } from '../messages';
import { describeApiError } from '../../../shared/api/describe-api-error';

const INFAKT_SANDBOX_URL = 'https://api.sandbox-infakt.pl';
const INFAKT_PRODUCTION_URL = 'https://api.infakt.pl';
const strong = { strong: (text: string): ReactElement => <strong>{text}</strong> };

export function InfaktSetupForm(): ReactElement {
  const messages = useInfaktMessages();
  const copy = messages.infaktSetupForm;
  const schemaCopy = messages.infaktSetupSchema;
  const setupSchema = useMemo(() => createInfaktSetupSchema(schemaCopy), [schemaCopy]);
  const createConnection = useCreateConnectionMutation();
  const testConnection = useTestConnectionMutation();
  const updateConnection = useUpdateConnectionMutation();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [createdConnection, setCreatedConnection] = useState<Connection | null>(null);
  // Post-create webhook flow (#1770): a prompt fires once on successful create;
  // choosing "Configure webhooks" closes it and opens the full config dialog.
  const [webhookPromptOpen, setWebhookPromptOpen] = useState(false);
  const [webhookConfigOpen, setWebhookConfigOpen] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [selectedBankAccountId, setSelectedBankAccountId] = useState<string | null>(null);
  // inFakt reported zero bank accounts, so the auto-apply effect forced the
  // payment method back to Cash — kept as state so the explanation stays
  // visible after the Transfer-gated picker section unmounts.
  const [forcedCashNoAccounts, setForcedCashNoAccounts] = useState(false);
  // Guards the auto-apply-default effect so it fires once per created
  // connection, not on every re-render once the bank-accounts query resolves.
  const bankAccountDefaultApplied = useRef(false);

  const createdConnectionId = createdConnection?.id ?? null;

  const form = useForm<InfaktSetupFormValues, undefined, InfaktSetupFormSubmission>({
    defaultValues: INFAKT_SETUP_DEFAULT_VALUES,
    resolver: zodResolver(setupSchema),
    mode: 'onBlur',
  });

  // Mirrors the edit screen's gating (#1310 review): the picker (and the
  // account fetch behind it) only matter when Transfer is selected.
  const paymentMethodIsTransfer = form.watch('defaultPaymentMethod') === 'transfer';
  const bankAccountsQuery = useBankAccountsQuery(createdConnectionId ?? undefined, {
    enabled: createdConnectionId !== null && paymentMethodIsTransfer,
  });
  // Shared persist-then-flip choreography (#1310 review) — both the auto-apply
  // effect and a manual pick route through it, so a failed persist can never
  // leave inFakt's default flipped while OL still stamps the old account, and
  // `isPending` disables the Select to block a double-pick race.
  const { pickAccount, isPending: bankAccountPickPending } = usePickBankAccount({
    connectionId: createdConnectionId ?? '',
    persistErrorHint: copy.persistErrorHint,
  });

  // Abandon-prevention.
  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent): void {
      if (!form.formState.isDirty || createdConnectionId !== null) return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [form.formState.isDirty, createdConnectionId]);

  const validationMessages = Object.values(form.formState.errors).flatMap((fieldError) =>
    fieldError?.message ? [String(fieldError.message)] : [],
  );

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const created = await createConnection.mutateAsync(toCreateConnectionInput(values));
      form.reset(values, { keepValues: true, keepDirty: false });
      setCreatedConnection(created);
      setWebhookPromptOpen(true);
      showToast({
        tone: 'success',
        title: copy.created.title,
        description: interpolate(copy.created.description, { name: created.name }),
      });
    } catch {
      return;
    }
  });

  // Bank-account default (#1303 follow-up) — the select is locked until the
  // connection exists (the server needs the saved API key to call inFakt).
  // Once the live list resolves: ≥1 accounts picks whichever inFakt itself
  // marks as `isDefault` (falling back to the first entry if none is marked,
  // though inFakt always reports exactly one); 0 accounts forces the payment
  // method back to Cash (Transfer isn't viable without one), even if the
  // operator picked Transfer before the connection was created.
  useEffect(() => {
    if (!createdConnection || !bankAccountsQuery.isSuccess || bankAccountDefaultApplied.current) {
      return;
    }
    bankAccountDefaultApplied.current = true;
    const accounts = bankAccountsQuery.data;
    const currentConfig = createdConnection.config ?? {};

    if (accounts.length > 0) {
      const defaultAccount = accounts.find((a) => a.isDefault) ?? accounts[0]!;
      setSelectedBankAccountId(defaultAccount.id);
      // Route through the shared choreography so the fallback-to-first branch
      // (no account flagged default) also syncs inFakt's own default, instead
      // of persisting OL's snapshot while inFakt keeps pointing elsewhere
      // (#1310 review, finding 7).
      pickAccount(defaultAccount, currentConfig);
    } else if (currentConfig.defaultPaymentMethod === 'transfer') {
      // Keep the (now read-only) form control in agreement with what is
      // persisted — without the setValue the select would keep showing
      // "Transfer" while the server issues everything as cash.
      setForcedCashNoAccounts(true);
      form.setValue('defaultPaymentMethod', 'cash');
      updateConnection.mutate(
        {
          connectionId: createdConnection.id,
          input: { config: { ...currentConfig, defaultPaymentMethod: 'cash' } },
        },
        {
          onError: (error) => {
            // The optimistic Cash flip failed to persist: the server still
            // holds Transfer, so revert the UI rather than leave it asserting a
            // Cash state the server rejected (#1310 review, finding 3). The
            // operator recovers from the edit screen, per the toast.
            setForcedCashNoAccounts(false);
            form.setValue('defaultPaymentMethod', 'transfer');
            showToast({
              tone: 'error',
              title: copy.forcedCashFailed.title,
              description: interpolate(copy.forcedCashFailed.description, {
                error: describeApiError(error, 'infakt'),
              }),
            });
          },
        },
      );
    }
  }, [
    createdConnection,
    bankAccountsQuery.isSuccess,
    bankAccountsQuery.data,
    updateConnection,
    pickAccount,
    showToast,
    form,
    copy,
  ]);

  const onBankAccountChange = (accountId: string): void => {
    if (!createdConnection) return;
    setSelectedBankAccountId(accountId);
    const account = (bankAccountsQuery.data ?? []).find((a) => a.id === accountId);
    if (!account) return;
    pickAccount(account, createdConnection.config ?? {});
  };

  const onTest = async (): Promise<void> => {
    if (!createdConnectionId) return;
    // Clear any prior result first: otherwise a re-test that rejects would render
    // a stale resolved-result Alert alongside the "unable to test" error Alert.
    setTestResult(null);
    try {
      const result = await testConnection.mutateAsync(createdConnectionId);
      setTestResult(result);
    } catch {
      // surfaced via testConnection.error
    }
  };

  return (
    <form className="wizard-card" onSubmit={(event) => void onSubmit(event)} noValidate>
      <BackLink to="/connections/new" label={copy.back} className="wizard-card__back" />

      {form.formState.submitCount > 0 && validationMessages.length > 0 ? (
        <FormErrorSummary errors={validationMessages} />
      ) : null}
      {createConnection.error ? (
        <Alert tone="error" title={copy.createError}>
          {describeApiError(createConnection.error, 'infakt')}
        </Alert>
      ) : null}

      <Alert tone="info" title={copy.beforeYouStart.title}>
        {renderRich(copy.beforeYouStart.body, strong)}
      </Alert>

      <FormField
        label={copy.name.label}
        name="name"
        error={form.formState.errors.name?.message}
        description={copy.name.description}
      >
        <Input
          {...form.register('name')}
          placeholder={copy.name.placeholder}
          autoComplete="off"
          invalid={Boolean(form.formState.errors.name)}
        />
      </FormField>

      <FormField
        label={copy.apiKey.label}
        name="apiKey"
        error={form.formState.errors.apiKey?.message}
        description={copy.apiKey.description}
      >
        <Input
          {...form.register('apiKey')}
          type="password"
          placeholder="••••••••••••••••••••••••••••••••"
          autoComplete="off"
          invalid={Boolean(form.formState.errors.apiKey)}
        />
      </FormField>

      <FormField
        label={copy.environment.label}
        name="environment"
        error={form.formState.errors.environment?.message}
        description={copy.environment.description}
      >
        <Select {...form.register('environment')}>
          <option value="sandbox">
            {interpolate(copy.environment.sandbox, { url: INFAKT_SANDBOX_URL })}
          </option>
          <option value="production">
            {interpolate(copy.environment.production, { url: INFAKT_PRODUCTION_URL })}
          </option>
        </Select>
      </FormField>

      <FormField
        label={copy.paymentMethod.label}
        name="defaultPaymentMethod"
        error={form.formState.errors.defaultPaymentMethod?.message}
        description={
          createdConnection
            ? copy.paymentMethod.descriptionLocked
            : copy.paymentMethod.descriptionBefore
        }
      >
        <Select
          {...form.register('defaultPaymentMethod')}
          disabled={createdConnection !== null}
          invalid={Boolean(form.formState.errors.defaultPaymentMethod)}
        >
          <option value="cash">{copy.paymentMethod.cash}</option>
          <option value="transfer">{copy.paymentMethod.transfer}</option>
        </Select>
      </FormField>

      {createdConnection ? (
        <>
          {/* Bank-account picker — gated on Transfer, mirroring the edit
              screen (a bank account is only stamped on Transfer invoices). */}
          {paymentMethodIsTransfer ? (
            bankAccountsQuery.isLoading ? (
              <p className="muted-text">{copy.bankAccount.checking}</p>
            ) : bankAccountsQuery.isError ? (
              <p className="muted-text">{renderRich(copy.bankAccount.unreachable, strong)}</p>
            ) : bankAccountsQuery.data && bankAccountsQuery.data.length > 0 ? (
              <FormField label={copy.bankAccount.label} name="bankAccount">
                <Select
                  value={selectedBankAccountId ?? ''}
                  onChange={(event) => onBankAccountChange(event.target.value)}
                  disabled={bankAccountPickPending}
                >
                  <option value="" disabled>
                    {copy.bankAccount.placeholder}
                  </option>
                  {bankAccountsQuery.data.map((account) => (
                    <option key={account.id} value={account.id}>
                      {interpolate(
                        account.isDefault
                          ? copy.bankAccount.optionDefault
                          : copy.bankAccount.option,
                        { bank: account.bankName, number: account.accountNumber },
                      )}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : null
          ) : null}

          {/* Rendered outside the Transfer gate: the zero-accounts fallback
              flips the form's own payment method to Cash, which unmounts the
              gated section above — the explanation must survive that. */}
          {forcedCashNoAccounts ? (
            <p className="muted-text">{renderRich(copy.forcedCash, strong)}</p>
          ) : null}

          {testResult ? (
            <Alert
              tone={testResult.success ? 'success' : 'error'}
              title={testResult.success ? copy.test.passed : copy.test.failed}
            >
              {testResult.success ? null : describeConnectionTestFailure(testResult)}
              {typeof testResult.latencyMs === 'number'
                ? ` ${interpolate(copy.test.latency, { ms: testResult.latencyMs })}`
                : null}
            </Alert>
          ) : null}
          {testConnection.error ? (
            <Alert tone="error" title={copy.test.unable}>
              {describeApiError(testConnection.error, 'infakt')}
            </Alert>
          ) : null}

          {/* Delivery webhooks (#1770) — optional and post-create (they need the
              connection id + a live endpoint). A prompt opens the config dialog
              automatically on create; this row reopens it after a dismiss. */}
          <Alert tone="info" title={copy.webhooks.title}>
            {copy.webhooks.body}
            <div className="form-actions" style={{ marginTop: 'var(--space-3)' }}>
              <Button type="button" tone="secondary" onClick={() => setWebhookConfigOpen(true)}>
                {copy.configureWebhooks}
              </Button>
            </div>
          </Alert>

          <div className="form-actions">
            <Button type="button" onClick={() => void onTest()} disabled={testConnection.isPending}>
              {testConnection.isPending ? copy.test.running : copy.test.run}
            </Button>
            <Button tone="secondary" type="button" onClick={() => void navigate('/connections')}>
              {copy.done}
            </Button>
          </div>

          {/* Fires once on successful create: offer webhooks now, or point to
              where they live later. "Configure" closes this and opens the
              full config dialog (#1770). */}
          <Dialog open={webhookPromptOpen} onOpenChange={setWebhookPromptOpen}>
            <DialogContent aria-describedby={undefined}>
              <DialogTitle>{copy.webhookPrompt.title}</DialogTitle>
              <DialogDescription>{copy.webhookPrompt.description}</DialogDescription>
              <DialogFooter>
                <Button
                  tone="secondary"
                  type="button"
                  onClick={() => {
                    setWebhookPromptOpen(false);
                    showToast({
                      tone: 'success',
                      title: copy.webhookPrompt.ready.title,
                      description: copy.webhookPrompt.ready.description,
                    });
                  }}
                >
                  {copy.webhookPrompt.notNow}
                </Button>
                <Button
                  tone="primary"
                  type="button"
                  onClick={() => {
                    setWebhookPromptOpen(false);
                    setWebhookConfigOpen(true);
                  }}
                >
                  {copy.webhookPrompt.configure}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <InfaktWebhookConfigDialog
            connection={createdConnection}
            open={webhookConfigOpen}
            onOpenChange={setWebhookConfigOpen}
          />
        </>
      ) : (
        <div className="form-actions">
          <Button type="submit" disabled={createConnection.isPending}>
            {createConnection.isPending ? copy.connecting : copy.connect}
          </Button>
        </div>
      )}
    </form>
  );
}

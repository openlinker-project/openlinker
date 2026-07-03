/**
 * Infakt Setup Form
 *
 * Single-step wizard for creating an inFakt connection. Collects:
 *   - Connection name
 *   - inFakt API key (the only credential)
 *   - Optional advanced base URL override (config) — sandbox vs. production
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
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useCreateConnectionMutation } from '../hooks/use-create-connection-mutation';
import { useTestConnectionMutation } from '../hooks/use-test-connection-mutation';
import { useUpdateConnectionMutation } from '../hooks/use-update-connection-mutation';
import { useBankAccountsQuery } from '../hooks/use-bank-accounts-query';
import { usePickBankAccount } from '../hooks/use-pick-bank-account';
import type { Connection, ConnectionTestResult } from '../api/connections.types';
import {
  INFAKT_SETUP_DEFAULT_VALUES,
  infaktSetupSchema,
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

export function InfaktSetupForm(): ReactElement {
  const createConnection = useCreateConnectionMutation();
  const testConnection = useTestConnectionMutation();
  const updateConnection = useUpdateConnectionMutation();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [createdConnection, setCreatedConnection] = useState<Connection | null>(null);
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
    resolver: zodResolver(infaktSetupSchema),
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
    persistErrorHint: "re-pick it from the connection's edit screen.",
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

  const validationMessages = Object.values(form.formState.errors).flatMap((error) =>
    error?.message ? [String(error.message)] : [],
  );

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const created = await createConnection.mutateAsync(toCreateConnectionInput(values));
      form.reset(values, { keepValues: true, keepDirty: false });
      setCreatedConnection(created);
      showToast({
        tone: 'success',
        title: 'Connection created',
        description: `inFakt connection "${created.name}" was created.`,
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
              title: 'Could not switch the payment method to Cash',
              description:
                'inFakt has no bank account for Transfer invoices, but switching this ' +
                "connection to Cash didn't save - change the payment method from the " +
                `connection's edit screen. ${error.message}`,
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
      <BackLink to="/connections/new" label="Connections" className="wizard-card__back" />

      {form.formState.submitCount > 0 && validationMessages.length > 0 ? (
        <FormErrorSummary errors={validationMessages} />
      ) : null}
      {createConnection.error ? (
        <Alert tone="error" title="Unable to create connection">
          {createConnection.error.message}
        </Alert>
      ) : null}

      <Alert tone="info" title="Before you start">
        In your inFakt account settings, generate an <strong>API key</strong>. OpenLinker uses
        it to issue invoices and read KSeF clearance status through inFakt's native
        integration. The key is stored securely on the server and only shown once.
      </Alert>

      <FormField
        label="Connection name"
        name="name"
        error={form.formState.errors.name?.message}
        description="A label to identify this inFakt account in OpenLinker."
      >
        <Input
          {...form.register('name')}
          placeholder="My inFakt Account"
          autoComplete="off"
          invalid={Boolean(form.formState.errors.name)}
        />
      </FormField>

      <FormField
        label="API key"
        name="apiKey"
        error={form.formState.errors.apiKey?.message}
        description="Your inFakt API key — generated in your inFakt account settings."
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
        label="Base URL (optional)"
        name="baseUrl"
        error={form.formState.errors.baseUrl?.message}
        description="Advanced — override the default inFakt API base URL for sandbox testing. Must use HTTPS. Leave blank to use production."
      >
        <Input
          {...form.register('baseUrl')}
          className="mono-text"
          placeholder="https://api.infakt.pl"
          autoComplete="off"
          invalid={Boolean(form.formState.errors.baseUrl)}
        />
      </FormField>

      <FormField
        label="Default payment method"
        name="defaultPaymentMethod"
        error={form.formState.errors.defaultPaymentMethod?.message}
        description={
          createdConnection
            ? 'Locked now that the connection is created — change the payment method from ' +
              "the connection's edit screen (post-create changes here would not be saved)."
            : '"Transfer" 422s on inFakt unless a bank account is configured on the seller’s ' +
              'inFakt account. Choosing a specific bank account unlocks after connecting — it ' +
              'defaults to whichever account is set as default in inFakt, or falls back to Cash ' +
              'if none exist.'
        }
      >
        <Select
          {...form.register('defaultPaymentMethod')}
          disabled={createdConnection !== null}
          invalid={Boolean(form.formState.errors.defaultPaymentMethod)}
        >
          <option value="cash">Cash</option>
          <option value="transfer">Transfer</option>
        </Select>
      </FormField>

      {createdConnection ? (
        <>
          {/* Bank-account picker — gated on Transfer, mirroring the edit
              screen (a bank account is only stamped on Transfer invoices). */}
          {paymentMethodIsTransfer ? (
            bankAccountsQuery.isLoading ? (
              <p className="muted-text">Checking inFakt for bank accounts…</p>
            ) : bankAccountsQuery.isError ? (
              <p className="muted-text">
                Couldn't reach inFakt to list bank accounts. This connection stays on{' '}
                <strong>Transfer</strong>, so invoices will keep being issued as Transfer and
                may be rejected by inFakt until you pick a bank account from the connection's
                edit screen.
              </p>
            ) : bankAccountsQuery.data && bankAccountsQuery.data.length > 0 ? (
              <FormField label="Bank account for Transfer invoices" name="bankAccount">
                <Select
                  value={selectedBankAccountId ?? ''}
                  onChange={(event) => onBankAccountChange(event.target.value)}
                  disabled={bankAccountPickPending}
                >
                  <option value="" disabled>
                    Select a bank account…
                  </option>
                  {bankAccountsQuery.data.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.bankName} — {account.accountNumber}
                      {account.isDefault ? ' (default in inFakt)' : ''}
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
            <p className="muted-text">
              No bank account is configured on this inFakt account, so <strong>Transfer</strong>{' '}
              isn't available yet — invoices will use <strong>Cash</strong>. Add a bank account in
              your inFakt settings, then switch the payment method from the connection's edit
              screen.
            </p>
          ) : null}

          {testResult ? (
            <Alert
              tone={testResult.success ? 'success' : 'error'}
              title={testResult.success ? 'Connection test passed' : 'Connection test failed'}
            >
              {testResult.message}
              {typeof testResult.latencyMs === 'number' ? ` (${testResult.latencyMs}ms)` : null}
            </Alert>
          ) : null}
          {testConnection.error ? (
            <Alert tone="error" title="Unable to test connection">
              {testConnection.error.message}
            </Alert>
          ) : null}
          <div className="form-actions">
            <Button type="button" onClick={() => void onTest()} disabled={testConnection.isPending}>
              {testConnection.isPending ? 'Testing…' : 'Test connection'}
            </Button>
            <Button tone="secondary" type="button" onClick={() => void navigate('/connections')}>
              Done
            </Button>
          </div>
        </>
      ) : (
        <div className="form-actions">
          <Button type="submit" disabled={createConnection.isPending}>
            {createConnection.isPending ? 'Connecting…' : 'Connect inFakt'}
          </Button>
        </div>
      )}
    </form>
  );
}

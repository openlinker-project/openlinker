/**
 * Infakt Structured Section
 *
 * Plugin-owned structured-config inputs rendered inside `EditConnectionForm`
 * when the connection's `platformType` is `'infakt'`. Carries:
 *
 *   - Environment (`config.environment`, #2174) — used to point an existing
 *     connection at inFakt's sandbox host instead of production. Mirrors
 *     InPost's `inpostEnvironment` structured field. The legacy free-text
 *     `config.baseUrl` override still exists on the BE config type for
 *     backward compatibility and always takes precedence over Environment
 *     (`resolveInfaktBaseUrl`) - see the legacy-override banner below.
 *   - Legacy Base URL override banner (#2179 review, Important #1) - a
 *     connection created before this Environment select existed may still
 *     carry a `config.baseUrl` override. Because `resolveInfaktBaseUrl`
 *     prefers it unconditionally, picking a new Environment value on such a
 *     connection would silently have no effect: the select would round-trip
 *     into `config.environment` but the resolved host would stay whatever
 *     `baseUrl` says. The banner surfaces that value and offers a "Clear
 *     legacy override" action that reuses the generic host `baseUrl` field
 *     (`syncStructuredToJson('baseUrl', '')`, which already deletes the key
 *     via `mergeStructuredIntoConfig`'s pre-existing generic clause) - no new
 *     merge clause needed, since `baseUrl` was already a host-structured field
 *     before this plugin section stopped rendering a control for it.
 *   - Default payment method (`config.defaultPaymentMethod`, #1303) — sent
 *     on every issued invoice/correction. Empty selection means "no
 *     override", the adapter falls back to `'cash'`. Tucked behind an
 *     `InlineDisclosure` — most operators never touch it, so it reads as an
 *     inline fact ("Payment method for invoice: Cash") rather than a
 *     permanently-open control competing with Base URL for attention.
 *   - Bank account (`config.bankAccount`, #1303 follow-up) — only shown
 *     when Transfer is selected; live-fetched via `useBankAccountsQuery`. No
 *     select at all when inFakt reports zero accounts — Transfer isn't a
 *     viable choice without one. A pick persists `config.bankAccount`
 *     eagerly (not on Save) and only then flips inFakt's own "default
 *     account" via the shared `usePickBankAccount` choreography — both sides
 *     commit together, so abandoning the edit form (or a failed Save) can
 *     never leave inFakt flipped while OL still stamps the old account.
 *
 * Note: the picker gates on the *unsaved* `infaktPaymentMethod` form value,
 * so an operator who flips Cash→Transfer in the form (without Save) and then
 * picks an account triggers the eager persist + inFakt default flip while the
 * persisted method is still Cash. This is accepted: it is the natural setup
 * order (pick the account you're about to save Transfer for), a Cash adapter
 * ignores `config.bankAccount`, and the pick is persisted server-side anyway,
 * so nothing drifts (#1310 review, finding 8).
 *
 * Credentials (the API key) are NOT edited here — they live in the
 * write-only `InfaktCredentialsPanel`.
 *
 * @module plugins/infakt/components
 */
import type { ReactElement } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { FormField } from '../../../shared/ui/form-field';
import { InlineDisclosure } from '../../../shared/ui/inline-disclosure';
import { Select } from '../../../shared/ui/select';
import type { StructuredConfigSectionProps } from '../../../shared/plugins';
import { useBankAccountsQuery, usePickBankAccount } from '../../../features/connections';

const PAYMENT_METHOD_LABELS: Record<'cash' | 'transfer', string> = {
  cash: 'Cash',
  transfer: 'Transfer',
};

export function InfaktStructuredSection({
  connection,
  form,
  configIsParseable,
  syncStructuredToJson,
  syncInfaktBankAccountToJson,
}: StructuredConfigSectionProps): ReactElement {
  const paymentMethod = form.watch('infaktPaymentMethod') ?? '';
  const isTransfer = paymentMethod === 'transfer';
  // Mirrors the adapter's own fallback (`config.defaultPaymentMethod ?? 'cash'`)
  // so the collapsed summary always reflects what will actually be sent.
  const effectiveLabel = PAYMENT_METHOD_LABELS[isTransfer ? 'transfer' : 'cash'];
  const bankAccount = form.watch('infaktBankAccount') ?? null;
  // #2179 review, Important #1 - `baseUrl` is the generic host-structured
  // field (`EditConnectionForm` hydrates it from `connection.config.baseUrl`
  // for every platform); this section renders no control bound to it, but
  // `resolveInfaktBaseUrl` still prefers it over `infaktEnvironment` when
  // present. Watched here only to decide whether the legacy-override banner
  // below should render.
  const legacyBaseUrl = form.watch('baseUrl') ?? '';

  function clearLegacyBaseUrl(): void {
    syncStructuredToJson('baseUrl', '');
  }

  const bankAccountsQuery = useBankAccountsQuery(connection.id, { enabled: isTransfer });
  // Shared persist-then-flip choreography (#1310 review) — see the file header
  // for the eager-persist / abandon-safety invariant it enforces.
  const { pickAccount, isPending: bankAccountPickPending } = usePickBankAccount({
    connectionId: connection.id,
    persistErrorHint: 'pick it again or use Save changes.',
  });

  function onBankAccountChange(accountId: string): void {
    const account = (bankAccountsQuery.data ?? []).find((a) => a.id === accountId);
    if (!account) return;
    const snapshot = {
      id: account.id,
      accountNumber: account.accountNumber,
      bankName: account.bankName,
    };
    form.setValue('infaktBankAccount', snapshot, { shouldDirty: true });
    syncInfaktBankAccountToJson?.();
    // Persist from the server-side config snapshot (so unrelated unsaved form
    // edits don't leak) and flip inFakt's default only after that succeeds.
    pickAccount(account, connection.config ?? {});
  }

  return (
    <>
      {legacyBaseUrl ? (
        <Alert
          tone="warning"
          title="Legacy Base URL override in effect"
          action={
            <Button
              type="button"
              tone="secondary"
              className="button--sm"
              onClick={clearLegacyBaseUrl}
              disabled={!configIsParseable}
            >
              Clear legacy override
            </Button>
          }
        >
          This connection has a legacy Base URL override (<code>{legacyBaseUrl}</code>) that takes
          precedence over Environment below - invoices keep going to that host until it's cleared,
          even after picking a different Environment and saving.
        </Alert>
      ) : null}
      <FormField
        label="Environment"
        name="infaktEnvironment"
        error={form.formState.errors.infaktEnvironment?.message}
        description="inFakt API environment. Use Sandbox to test before switching to Production. Leaving this not set falls back to Production."
      >
        <Select
          value={form.watch('infaktEnvironment') ?? ''}
          onChange={(event) => syncStructuredToJson('infaktEnvironment', event.target.value)}
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.infaktEnvironment)}
        >
          <option value="">— not set —</option>
          <option value="sandbox">Sandbox</option>
          <option value="production">Production</option>
        </Select>
      </FormField>
      <InlineDisclosure label="Payment method for invoice:" value={effectiveLabel}>
        <FormField
          label="Default payment method"
          name="infaktPaymentMethod"
          error={form.formState.errors.infaktPaymentMethod?.message}
          description={
            'Transfer needs a bank account on your inFakt account — without one, inFakt ' +
            'rejects the invoice. Stay on Cash until you have added one in inFakt.'
          }
        >
          <Select
            value={paymentMethod}
            onChange={(event) => syncStructuredToJson('infaktPaymentMethod', event.target.value)}
            disabled={!configIsParseable}
            invalid={Boolean(form.formState.errors.infaktPaymentMethod)}
          >
            <option value="cash">{PAYMENT_METHOD_LABELS.cash}</option>
            <option value="transfer">{PAYMENT_METHOD_LABELS.transfer}</option>
          </Select>
        </FormField>

        {isTransfer ? (
          bankAccountsQuery.isLoading ? (
            <p className="muted-text">Checking inFakt for bank accounts…</p>
          ) : bankAccountsQuery.isError ? (
            <p className="muted-text">
              Couldn't check inFakt for bank accounts — invoices will use whatever was last saved.
            </p>
          ) : bankAccountsQuery.data && bankAccountsQuery.data.length > 0 ? (
            <FormField
              label="Bank account for Transfer invoices"
              name="infaktBankAccount"
              description={
                bankAccount && !bankAccountsQuery.data.some((a) => a.id === bankAccount.id)
                  ? `The saved account (${bankAccount.accountNumber}) no longer exists in inFakt — ` +
                    'invoices keep stamping the saved snapshot until you pick a current account.'
                  : undefined
              }
            >
              <Select
                value={bankAccount ? bankAccount.id : ''}
                onChange={(event) => onBankAccountChange(event.target.value)}
                disabled={!configIsParseable || bankAccountPickPending}
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
          ) : (
            <p className="muted-text">
              No bank account is configured on this inFakt account, so{' '}
              <strong>Transfer</strong> isn't viable yet. This connection's saved payment method
              is still Transfer, so invoices may be rejected by inFakt - switch the payment
              method to Cash above, or add a bank account in your inFakt settings and reload this
              page to pick it.
            </p>
          )
        ) : null}
      </InlineDisclosure>
    </>
  );
}

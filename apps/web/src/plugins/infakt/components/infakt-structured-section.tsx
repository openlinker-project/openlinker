/**
 * Infakt Structured Section
 *
 * Plugin-owned structured-config inputs rendered inside `EditConnectionForm`
 * when the connection's `platformType` is `'infakt'`. Carries:
 *
 *   - Base URL (`config.baseUrl`) — used to point an existing connection at
 *     inFakt's sandbox environment instead of production.
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
 *     account" via `useSetDefaultBankAccountMutation` — both sides commit
 *     together, so abandoning the edit form (or a failed Save) can never
 *     leave inFakt flipped while OL still stamps the old account.
 *
 * Credentials (the API key) are NOT edited here — they live in the
 * write-only `InfaktCredentialsPanel`.
 *
 * @module plugins/infakt/components
 */
import type { ReactElement } from 'react';
import { FormField } from '../../../shared/ui/form-field';
import { InlineDisclosure } from '../../../shared/ui/inline-disclosure';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import type { StructuredConfigSectionProps } from '../../../shared/plugins';
import { useToast } from '../../../shared/ui/toast-provider';
import {
  useBankAccountsQuery,
  useSetDefaultBankAccountMutation,
  useUpdateConnectionMutation,
} from '../../../features/connections';

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

  const bankAccountsQuery = useBankAccountsQuery(connection.id, { enabled: isTransfer });
  const setDefaultBankAccount = useSetDefaultBankAccountMutation();
  const updateConnection = useUpdateConnectionMutation();
  const { showToast } = useToast();

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
    // Persist `config.bankAccount` eagerly (from the server-side config
    // snapshot, so unrelated unsaved form edits don't leak), and flip
    // inFakt's own "default account" only after that persist succeeds —
    // otherwise abandoning the edit form would leave inFakt's default
    // flipped while OL still stamps the previous account on invoices.
    updateConnection.mutate(
      {
        connectionId: connection.id,
        input: { config: { ...(connection.config ?? {}), bankAccount: snapshot } },
      },
      {
        onSuccess: () => {
          if (!account.isDefault) {
            setDefaultBankAccount.mutate({ connectionId: connection.id, accountId });
          }
        },
        onError: (error) => {
          showToast({
            tone: 'error',
            title: 'Could not save the bank account',
            description: `The selection was not persisted — pick it again or use Save changes. ${error.message}`,
          });
        },
      },
    );
  }

  return (
    <>
      <FormField
        label="Base URL (optional)"
        name="baseUrl"
        error={form.formState.errors.baseUrl?.message}
        description="Advanced — override the default inFakt API base URL for sandbox testing. Leave blank to use production."
      >
        <Input
          value={form.watch('baseUrl') ?? ''}
          onChange={(event) => syncStructuredToJson('baseUrl', event.target.value)}
          placeholder="https://api.infakt.pl"
          className="mono-text"
          autoComplete="off"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.baseUrl)}
        />
      </FormField>
      <InlineDisclosure label="Payment method for invoice:" value={effectiveLabel}>
        <FormField
          label="Default payment method"
          name="infaktPaymentMethod"
          error={form.formState.errors.infaktPaymentMethod?.message}
          description={
            '"Transfer" 422s on inFakt unless a bank account is configured on the seller’s ' +
            'inFakt account. Leave "Cash" unless you have confirmed that prerequisite.'
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
            <FormField label="Bank account for Transfer invoices" name="infaktBankAccount">
              <Select
                value={bankAccount ? bankAccount.id : ''}
                onChange={(event) => onBankAccountChange(event.target.value)}
                disabled={!configIsParseable}
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
              No bank account is configured on this inFakt account, so <strong>Transfer</strong>{' '}
              isn't available yet — invoices will use <strong>Cash</strong>. Add a bank account in
              your inFakt settings, then reload this page to pick it.
            </p>
          )
        ) : null}
      </InlineDisclosure>
    </>
  );
}

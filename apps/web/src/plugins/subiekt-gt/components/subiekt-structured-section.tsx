/**
 * Subiekt Structured Section (#759 + #1324)
 *
 * Plugin-owned structured-config inputs rendered inside `EditConnectionForm`
 * when the connection's `platformType` is `'subiekt-gt'`. Carries:
 *
 *   - Bridge URL  → flat `config.subiektBridgeUrl` (synced via syncStructuredToJson)
 *   - Trigger Model dropdown (AC-2) → NESTED `config.invoicing.triggerModel`
 *   - Payment / bank / cash-register (#1324) → one `InlineDisclosure`:
 *       - payment method (cash/transfer) → flat `config.defaultPaymentMethod`
 *       - bank account (transfer only) → flat `config.bankAccountId`, picked from
 *         the OWNER-AWARE Subiekt endpoint so options group by płatnik and a
 *         payer-routing warning shows ONLY when >1 seller Podmiot exists
 *         (decisions 5/6). On a non-default pick we also flip the provider
 *         default via the generic set-default mutation.
 *       - cash register (Stanowisko Kasowe) → flat `config.defaultStanowiskoKasoweId`.
 *         A real, working per-document selector. There is deliberately NO Oddział
 *         selector — the branch is bound read-only to the bridge's Sfera session
 *         and cannot be overridden per request (issue #1324 decision 8b); one
 *         help line states this.
 *   - Capability toggles → whole-object `config.capabilities` via
 *     `CapabilityTogglesSection`
 *
 * @module plugins/subiekt-gt/components
 */
import { useMemo, type ReactElement } from 'react';
import { FormField } from '../../../shared/ui/form-field';
import { InlineDisclosure } from '../../../shared/ui/inline-disclosure';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { interpolate } from '../../../shared/i18n';
import { usePlatform } from '../../../shared/plugins';
import {
  CapabilityTogglesSection,
  useSetDefaultBankAccountMutation,
  useSubiektBankAccountsQuery,
  useSubiektCashRegistersQuery,
} from '../../../features/connections';
import type { StructuredConfigSectionProps } from '../../../shared/plugins';
import {
  SUBIEKT_TRIGGER_MODELS,
  SUBIEKT_TRIGGER_MODEL_LABELS,
} from '../subiekt-capability-descriptors';
import { useSubiektGtMessages } from '../messages';

export function SubiektStructuredSection({
  connection,
  form,
  configIsParseable,
  syncStructuredToJson,
  syncObjectToJson,
}: StructuredConfigSectionProps): ReactElement {
  const copy = useSubiektGtMessages().subiektStructuredSection;
  const plugin = usePlatform(connection.platformType);
  const descriptors = plugin?.capabilityDescriptors ?? {};

  const paymentMethodLabels: Record<'cash' | 'transfer', string> = {
    cash: copy.payment.method.cash,
    transfer: copy.payment.method.transfer,
  };
  const paymentUnsetLabel = copy.payment.method.unset;

  // Tri-state: '' (unset — send-nothing, bridge keeps its own default) | 'cash' | 'transfer'.
  const paymentMethod = form.watch('subiektPaymentMethod') ?? '';
  const isTransfer = paymentMethod === 'transfer';
  // Summary reflects the real tri-state — an unset method shows "Not set",
  // never a misleading "Cash" (PR review IMPORTANT #2).
  const effectiveLabel =
    paymentMethod === 'cash' || paymentMethod === 'transfer'
      ? paymentMethodLabels[paymentMethod]
      : paymentUnsetLabel;
  const bankAccountId = form.watch('subiektBankAccountId') ?? '';
  const stanowiskoKasoweId = form.watch('subiektStanowiskoKasoweId') ?? '';

  const bankAccountsQuery = useSubiektBankAccountsQuery(connection.id, { enabled: isTransfer });
  const cashRegistersQuery = useSubiektCashRegistersQuery(connection.id);
  const setDefaultBankAccount = useSetDefaultBankAccountMutation();

  const accounts = bankAccountsQuery.data ?? [];
  // Payer-routing warning shows ONLY when the live list spans more than one
  // seller Podmiot — on a single-payer install it stays hidden (decision 5/6).
  const hasMultiplePayers = useMemo(
    () => new Set(accounts.map((a) => a.ownerPodmiotId)).size > 1,
    [accounts],
  );
  // Group by the stable numeric `ownerPodmiotId` (not the display name) so two
  // Podmioty sharing a name never merge into one optgroup (PR review). The
  // group's rendered label still prefers `ownerName`.
  const accountsByOwner = useMemo(() => {
    const groups = new Map<number, { label: string; accounts: typeof accounts }>();
    for (const account of accounts) {
      const existing = groups.get(account.ownerPodmiotId);
      if (existing) existing.accounts.push(account);
      else
        groups.set(account.ownerPodmiotId, {
          label:
            account.ownerName ??
            interpolate(copy.payment.account.ownerFallback, { id: account.ownerPodmiotId }),
          accounts: [account],
        });
    }
    return groups;
  }, [accounts]);

  const registers = cashRegistersQuery.data ?? [];

  function accountLabel(account: (typeof accounts)[number]): string {
    const params = { bankName: account.bankName, accountNumber: account.accountNumber };
    return interpolate(
      account.isDefault ? copy.payment.account.optionDefault : copy.payment.account.option,
      params,
    );
  }

  function registerLabel(register: (typeof registers)[number]): string {
    const name = register.name ?? interpolate(copy.cashRegister.idFallback, { id: register.id });
    return register.symbol
      ? interpolate(copy.cashRegister.optionWithSymbol, { name, symbol: register.symbol })
      : name;
  }

  function onBankAccountChange(accountId: string): void {
    syncStructuredToJson('subiektBankAccountId', accountId);
    const account = accounts.find((a) => a.id === accountId);
    // Keep Subiekt's own "default account" in sync with the operator's pick.
    // `.mutate()` (not `mutateAsync`) so a bridge failure is handled by the
    // hook's `onError` toast and never surfaces as an unhandled rejection.
    if (account && !account.isDefault) {
      setDefaultBankAccount.mutate({ connectionId: connection.id, accountId });
    }
  }

  return (
    <>
      <FormField
        label={copy.bridgeUrl.label}
        name="subiektBridgeUrl"
        error={form.formState.errors.subiektBridgeUrl?.message}
      >
        <Input
          value={form.watch('subiektBridgeUrl') ?? ''}
          onChange={(event) => syncStructuredToJson('subiektBridgeUrl', event.target.value)}
          placeholder="https://localhost:5005"
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.subiektBridgeUrl)}
        />
      </FormField>

      <FormField
        label={copy.triggerModel.label}
        name="subiektTriggerModel"
        error={form.formState.errors.subiektTriggerModel?.message}
      >
        <Select
          value={form.watch('subiektTriggerModel') ?? ''}
          onChange={(event) => syncStructuredToJson('subiektTriggerModel', event.target.value)}
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.subiektTriggerModel)}
        >
          <option value="">{copy.triggerModel.unset}</option>
          {SUBIEKT_TRIGGER_MODELS.map((model) => (
            <option key={model} value={model}>
              {SUBIEKT_TRIGGER_MODEL_LABELS[model]}
            </option>
          ))}
        </Select>
      </FormField>

      <InlineDisclosure
        label={copy.payment.summary}
        value={effectiveLabel}
      >
        <FormField
          label={copy.payment.method.label}
          name="subiektPaymentMethod"
          error={form.formState.errors.subiektPaymentMethod?.message}
          description={copy.payment.method.help}
        >
          <Select
            value={paymentMethod}
            onChange={(event) => syncStructuredToJson('subiektPaymentMethod', event.target.value)}
            disabled={!configIsParseable}
            invalid={Boolean(form.formState.errors.subiektPaymentMethod)}
          >
            <option value="">{paymentUnsetLabel}</option>
            <option value="cash">{paymentMethodLabels.cash}</option>
            <option value="transfer">{paymentMethodLabels.transfer}</option>
          </Select>
        </FormField>

        {isTransfer ? (
          bankAccountsQuery.isLoading ? (
            <p className="muted-text">
              {copy.payment.account.loading}
            </p>
          ) : bankAccountsQuery.isError ? (
            <p className="muted-text">
              {copy.payment.account.error}
            </p>
          ) : accounts.length > 0 ? (
            <>
              <FormField
                label={copy.payment.account.label}
                name="subiektBankAccountId"
              >
                <Select
                  value={bankAccountId}
                  onChange={(event) => onBankAccountChange(event.target.value)}
                  disabled={!configIsParseable}
                >
                  <option value="" disabled>
                    {copy.payment.account.placeholder}
                  </option>
                  {hasMultiplePayers
                    ? Array.from(accountsByOwner.entries()).map(([ownerPodmiotId, group]) => (
                        <optgroup key={ownerPodmiotId} label={group.label}>
                          {group.accounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {accountLabel(account)}
                            </option>
                          ))}
                        </optgroup>
                      ))
                    : accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {accountLabel(account)}
                        </option>
                      ))}
                </Select>
              </FormField>
              {hasMultiplePayers ? (
                <p className="muted-text">
                  {copy.payment.account.multiPayerWarning}
                </p>
              ) : null}
            </>
          ) : (
            <p className="muted-text">
              {copy.payment.account.empty}
            </p>
          )
        ) : null}

        <FormField
          label={copy.cashRegister.label}
          name="subiektStanowiskoKasoweId"
          description={copy.cashRegister.help}
        >
          {cashRegistersQuery.isLoading ? (
            <p className="muted-text">
              {copy.cashRegister.loading}
            </p>
          ) : cashRegistersQuery.isError ? (
            <p className="muted-text">
              {copy.cashRegister.error}
            </p>
          ) : (
            <Select
              value={stanowiskoKasoweId}
              onChange={(event) =>
                syncStructuredToJson('subiektStanowiskoKasoweId', event.target.value)
              }
              disabled={!configIsParseable}
            >
              <option value="">
                {copy.cashRegister.unset}
              </option>
              {registers.map((register) => (
                <option key={register.id} value={String(register.id)}>
                  {registerLabel(register)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </InlineDisclosure>

      <CapabilityTogglesSection
        descriptors={descriptors}
        form={form}
        configIsParseable={configIsParseable}
        syncObjectToJson={syncObjectToJson}
      />
    </>
  );
}

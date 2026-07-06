/**
 * Subiekt Structured Section (#759 + #1324)
 *
 * Plugin-owned structured-config inputs rendered inside `EditConnectionForm`
 * when the connection's `platformType` is `'subiekt'`. Carries:
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
 * @module plugins/subiekt/components
 */
import { useMemo, type ReactElement } from 'react';
import { FormField } from '../../../shared/ui/form-field';
import { InlineDisclosure } from '../../../shared/ui/inline-disclosure';
import { Input } from '../../../shared/ui/input';
import { Select } from '../../../shared/ui/select';
import { useTranslation } from '../../../shared/i18n';
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

export function SubiektStructuredSection({
  connection,
  form,
  configIsParseable,
  syncStructuredToJson,
  syncObjectToJson,
}: StructuredConfigSectionProps): ReactElement {
  const { t } = useTranslation();
  const plugin = usePlatform(connection.platformType);
  const descriptors = plugin?.capabilityDescriptors ?? {};

  // Human labels for the payment method are routed through the i18n seam so a
  // future PL catalog localizes them (matches the trigger-model precedent).
  const paymentMethodLabels: Record<'cash' | 'transfer', string> = {
    cash: t('subiekt.settings.payment.method.cash', 'Cash'),
    transfer: t('subiekt.settings.payment.method.transfer', 'Transfer'),
  };
  const paymentUnsetLabel = t('subiekt.settings.payment.method.unset', 'Not set (Subiekt default)');

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
          label: account.ownerName ?? `Podmiot ${account.ownerPodmiotId}`,
          accounts: [account],
        });
    }
    return groups;
  }, [accounts]);

  const registers = cashRegistersQuery.data ?? [];

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
        label={t('subiekt.settings.bridgeUrl.label', 'Bridge URL')}
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
        label={t('subiekt.settings.triggerModel.label', 'Invoice trigger')}
        name="subiektTriggerModel"
        error={form.formState.errors.subiektTriggerModel?.message}
      >
        <Select
          value={form.watch('subiektTriggerModel') ?? ''}
          onChange={(event) => syncStructuredToJson('subiektTriggerModel', event.target.value)}
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.subiektTriggerModel)}
        >
          <option value="">{t('subiekt.settings.triggerModel.unset', 'Not set')}</option>
          {SUBIEKT_TRIGGER_MODELS.map((model) => (
            <option key={model} value={model}>
              {t(`subiekt.settings.triggerModel.${model}`, SUBIEKT_TRIGGER_MODEL_LABELS[model])}
            </option>
          ))}
        </Select>
      </FormField>

      <InlineDisclosure
        label={t('subiekt.settings.payment.summary', 'Payment method for invoice:')}
        value={effectiveLabel}
      >
        <FormField
          label={t('subiekt.settings.payment.method.label', 'Default payment method')}
          name="subiektPaymentMethod"
          error={form.formState.errors.subiektPaymentMethod?.message}
          description={t(
            'subiekt.settings.payment.method.help',
            'Sent on every issued invoice. Leave unset to let Subiekt apply its own default; pick Transfer only when the seller has a bank account configured in Subiekt.',
          )}
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
              {t('subiekt.settings.payment.account.loading', 'Checking Subiekt for bank accounts…')}
            </p>
          ) : bankAccountsQuery.isError ? (
            <p className="muted-text">
              {t(
                'subiekt.settings.payment.account.error',
                "Couldn't check Subiekt for bank accounts — invoices will use whatever was last saved.",
              )}
            </p>
          ) : accounts.length > 0 ? (
            <>
              <FormField
                label={t('subiekt.settings.payment.account.label', 'Bank account for Transfer invoices')}
                name="subiektBankAccountId"
              >
                <Select
                  value={bankAccountId}
                  onChange={(event) => onBankAccountChange(event.target.value)}
                  disabled={!configIsParseable}
                >
                  <option value="" disabled>
                    {t('subiekt.settings.payment.account.placeholder', 'Select a bank account…')}
                  </option>
                  {hasMultiplePayers
                    ? Array.from(accountsByOwner.entries()).map(([ownerPodmiotId, group]) => (
                        <optgroup key={ownerPodmiotId} label={group.label}>
                          {group.accounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.bankName} — {account.accountNumber}
                              {account.isDefault ? ' (default in Subiekt)' : ''}
                            </option>
                          ))}
                        </optgroup>
                      ))
                    : accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.bankName} — {account.accountNumber}
                          {account.isDefault ? ' (default in Subiekt)' : ''}
                        </option>
                      ))}
                </Select>
              </FormField>
              {hasMultiplePayers ? (
                <p className="muted-text">
                  {t(
                    'subiekt.settings.payment.account.multiPayerWarning',
                    'This Subiekt install has more than one płatnik. OpenLinker cannot yet confirm which płatnik an invoice is issued under, so the account picked here is not guaranteed to match the issuing payer.',
                  )}
                </p>
              ) : null}
            </>
          ) : (
            <p className="muted-text">
              {t(
                'subiekt.settings.payment.account.empty',
                'No bank account is configured in Subiekt, so Transfer invoices will use whatever form Subiekt applies by default. Add an account under Konfiguracja systemu → Rachunki bankowe, then reload this page.',
              )}
            </p>
          )
        ) : null}

        <FormField
          label={t('subiekt.settings.cashRegister.label', 'Cash register (Stanowisko Kasowe)')}
          name="subiektStanowiskoKasoweId"
          description={t(
            'subiekt.settings.cashRegister.help',
            'Invoices are always issued from the Centrala branch — the bridge does not support switching Oddział.',
          )}
        >
          {cashRegistersQuery.isLoading ? (
            <p className="muted-text">
              {t('subiekt.settings.cashRegister.loading', 'Checking Subiekt for cash registers…')}
            </p>
          ) : cashRegistersQuery.isError ? (
            <p className="muted-text">
              {t(
                'subiekt.settings.cashRegister.error',
                "Couldn't check Subiekt for cash registers — invoices will use the default register.",
              )}
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
                {t('subiekt.settings.cashRegister.unset', 'Default (Subiekt decides)')}
              </option>
              {registers.map((register) => (
                <option key={register.id} value={String(register.id)}>
                  {register.name ?? `#${register.id}`}
                  {register.symbol ? ` (${register.symbol})` : ''}
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

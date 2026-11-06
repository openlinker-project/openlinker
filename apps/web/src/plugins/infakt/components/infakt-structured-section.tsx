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
 *     (`resolveInfaktBaseUrl`) - see the legacy-override banner below. Its
 *     label, description and option labels go through the shared i18n seam
 *     under `infakt.settings.environment.*`, matching the InPost structured
 *     section's identical field (#2179 review round 3, Suggestion #4).
 *   - Legacy Base URL override banner (#2179 review, Important #1) - a
 *     connection created before this Environment select existed may still
 *     carry a `config.baseUrl` override. Because `resolveInfaktBaseUrl`
 *     prefers it unconditionally, picking a new Environment value on such a
 *     connection would silently have no effect: the select would round-trip
 *     into `config.environment` but the resolved host would stay whatever
 *     `baseUrl` says. The banner surfaces that value and offers a clear action
 *     that reuses the generic host `baseUrl` field
 *     (`syncStructuredToJson('baseUrl', '')`, which already deletes the key
 *     via `mergeStructuredIntoConfig`'s pre-existing generic clause) - no new
 *     merge clause needed, since `baseUrl` was already a host-structured field
 *     before this plugin section stopped rendering a control for it.
 *
 *     The clear action NAMES the host it leaves behind (#2179 review round 3,
 *     Important #2). The legacy field existed for sandbox testing, so an
 *     affected connection's override is most likely the sandbox host, while
 *     `readInfaktEnvironment` yields `''` for any connection that never had
 *     `config.environment` - and an unset Environment resolves to PRODUCTION.
 *     A bare clear would therefore promote a sandbox connection to production
 *     and start issuing real invoices that inFakt submits to KSeF. So: when
 *     the override's host is recognised, the clear first syncs
 *     `infaktEnvironment` to that same environment and only then clears
 *     `baseUrl`, keeping the resolved host identical; when it is not
 *     recognised and no Environment is picked, the action is DISABLED rather
 *     than silently defaulting.
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
import { interpolate, renderRich } from '../../../shared/i18n';
import type { StructuredConfigSectionProps } from '../../../shared/plugins';
import { useBankAccountsQuery, usePickBankAccount } from '../../../features/connections';
import { useInfaktMessages } from '../messages';

/**
 * Hosts of the two inFakt API environments, mirroring the BE
 * `INFAKT_SANDBOX_BASE_URL` / `INFAKT_DEFAULT_BASE_URL` constants. Duplicated
 * deliberately rather than imported: FE and BE are separate deployables (same
 * reasoning already recorded for `INFAKT_ENVIRONMENT_VALUES` in
 * `infakt-setup.schema.ts`).
 */
const INFAKT_SANDBOX_API_HOST = 'api.sandbox-infakt.pl';
const INFAKT_PRODUCTION_API_HOST = 'api.infakt.pl';

type InfaktEnvironmentValue = 'sandbox' | 'production';

/**
 * Which environment a legacy `config.baseUrl` override actually points at, or
 * `null` when the host is neither inFakt environment (an operator proxy, a
 * stale value, or an unparseable string). Pure - no host-specific behaviour
 * beyond the two literals above.
 */
function resolveLegacyBaseUrlEnvironment(value: string): InfaktEnvironmentValue | null {
  let host: string;
  try {
    host = new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === INFAKT_SANDBOX_API_HOST) return 'sandbox';
  if (host === INFAKT_PRODUCTION_API_HOST) return 'production';
  return null;
}

export function InfaktStructuredSection({
  connection,
  form,
  configIsParseable,
  syncStructuredToJson,
  syncInfaktBankAccountToJson,
}: StructuredConfigSectionProps): ReactElement {
  const copy = useInfaktMessages().infaktStructuredSection;
  const environmentLabels: Record<InfaktEnvironmentValue, string> = {
    sandbox: copy.environment.sandbox,
    production: copy.environment.production,
  };
  const paymentMethodLabels: Record<'cash' | 'transfer', string> = {
    cash: copy.paymentMethod.cash,
    transfer: copy.paymentMethod.transfer,
  };
  const paymentMethod = form.watch('infaktPaymentMethod') ?? '';
  const isTransfer = paymentMethod === 'transfer';
  // Mirrors the adapter's own fallback (`config.defaultPaymentMethod ?? 'cash'`)
  // so the collapsed summary always reflects what will actually be sent.
  const effectiveLabel = paymentMethodLabels[isTransfer ? 'transfer' : 'cash'];
  const bankAccount = form.watch('infaktBankAccount') ?? null;
  // #2179 review, Important #1 - `baseUrl` is the generic host-structured
  // field (`EditConnectionForm` hydrates it from `connection.config.baseUrl`
  // for every platform); this section renders no control bound to it, but
  // `resolveInfaktBaseUrl` still prefers it over `infaktEnvironment` when
  // present. Watched here only to decide whether the legacy-override banner
  // below should render.
  const legacyBaseUrl = form.watch('baseUrl') ?? '';
  const selectedEnvironment = form.watch('infaktEnvironment') ?? '';
  // The environment the override resolves to today (null = unrecognised host).
  const legacyEnvironment = legacyBaseUrl ? resolveLegacyBaseUrlEnvironment(legacyBaseUrl) : null;
  // What the connection will target once the override is gone: the override's
  // own environment when recognised, otherwise the picked Environment. `null`
  // means the outcome is unknowable, which is the one case the clear is blocked.
  const environmentAfterClear: InfaktEnvironmentValue | null =
    legacyEnvironment ??
    (selectedEnvironment === 'sandbox' || selectedEnvironment === 'production'
      ? selectedEnvironment
      : null);
  const clearBlocked = environmentAfterClear === null;
  const clearLabel = environmentAfterClear
    ? legacyEnvironment
      ? interpolate(copy.legacyOverride.clearKeep, {
          environment: environmentLabels[environmentAfterClear],
        })
      : interpolate(copy.legacyOverride.clearUse, {
          environment: environmentLabels[environmentAfterClear],
        })
    : copy.legacyOverride.clear;

  function clearLegacyBaseUrl(): void {
    if (environmentAfterClear === null) return;
    // Sequential syncs compose: `syncStructuredToJson` re-reads `configText`
    // from the form on every call, so the second merge sees the first one's
    // write. Environment goes first so the resolved host never passes through
    // an unset (⇒ production) state.
    if (legacyEnvironment !== null) {
      syncStructuredToJson('infaktEnvironment', legacyEnvironment);
    }
    syncStructuredToJson('baseUrl', '');
  }

  const bankAccountsQuery = useBankAccountsQuery(connection.id, { enabled: isTransfer });
  // Shared persist-then-flip choreography (#1310 review) — see the file header
  // for the eager-persist / abandon-safety invariant it enforces.
  const { pickAccount, isPending: bankAccountPickPending } = usePickBankAccount({
    connectionId: connection.id,
    persistErrorHint: copy.persistErrorHint,
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
          title={copy.legacyOverride.title}
          action={
            <Button
              type="button"
              tone="secondary"
              className="button--sm"
              onClick={clearLegacyBaseUrl}
              disabled={!configIsParseable || clearBlocked}
            >
              {clearLabel}
            </Button>
          }
        >
          {renderRich(
            copy.legacyOverride.body,
            { code: (text: string) => <code>{text}</code> },
            { url: legacyBaseUrl },
          )}{' '}
          {environmentAfterClear === null
            ? copy.legacyOverride.unknownHost
            : legacyEnvironment !== null
              ? interpolate(copy.legacyOverride.keeps, {
                  environment: environmentLabels[legacyEnvironment],
                })
              : interpolate(copy.legacyOverride.switches, {
                  environment: environmentLabels[environmentAfterClear],
                })}
        </Alert>
      ) : null}
      <FormField
        label={copy.environment.label}
        name="infaktEnvironment"
        error={form.formState.errors.infaktEnvironment?.message}
        description={copy.environment.description}
      >
        <Select
          value={selectedEnvironment}
          onChange={(event) => syncStructuredToJson('infaktEnvironment', event.target.value)}
          disabled={!configIsParseable}
          invalid={Boolean(form.formState.errors.infaktEnvironment)}
        >
          <option value="">{copy.environment.unset}</option>
          <option value="sandbox">{environmentLabels.sandbox}</option>
          <option value="production">{environmentLabels.production}</option>
        </Select>
      </FormField>
      <InlineDisclosure label={copy.paymentMethod.disclosure} value={effectiveLabel}>
        <FormField
          label={copy.paymentMethod.label}
          name="infaktPaymentMethod"
          error={form.formState.errors.infaktPaymentMethod?.message}
          description={copy.paymentMethod.description}
        >
          <Select
            value={paymentMethod}
            onChange={(event) => syncStructuredToJson('infaktPaymentMethod', event.target.value)}
            disabled={!configIsParseable}
            invalid={Boolean(form.formState.errors.infaktPaymentMethod)}
          >
            <option value="cash">{paymentMethodLabels.cash}</option>
            <option value="transfer">{paymentMethodLabels.transfer}</option>
          </Select>
        </FormField>

        {isTransfer ? (
          bankAccountsQuery.isLoading ? (
            <p className="muted-text">{copy.bankAccount.checking}</p>
          ) : bankAccountsQuery.isError ? (
            <p className="muted-text">{copy.bankAccount.checkFailed}</p>
          ) : bankAccountsQuery.data && bankAccountsQuery.data.length > 0 ? (
            <FormField
              label={copy.bankAccount.label}
              name="infaktBankAccount"
              description={
                bankAccount && !bankAccountsQuery.data.some((a) => a.id === bankAccount.id)
                  ? interpolate(copy.bankAccount.stale, { number: bankAccount.accountNumber })
                  : undefined
              }
            >
              <Select
                value={bankAccount ? bankAccount.id : ''}
                onChange={(event) => onBankAccountChange(event.target.value)}
                disabled={!configIsParseable || bankAccountPickPending}
              >
                <option value="" disabled>
                  {copy.bankAccount.placeholder}
                </option>
                {bankAccountsQuery.data.map((account) => (
                  <option key={account.id} value={account.id}>
                    {interpolate(
                      account.isDefault ? copy.bankAccount.optionDefault : copy.bankAccount.option,
                      { bank: account.bankName, number: account.accountNumber },
                    )}
                  </option>
                ))}
              </Select>
            </FormField>
          ) : (
            <p className="muted-text">
              {renderRich(copy.bankAccount.none, {
                strong: (text: string) => <strong>{text}</strong>,
              })}
            </p>
          )
        ) : null}
      </InlineDisclosure>
    </>
  );
}

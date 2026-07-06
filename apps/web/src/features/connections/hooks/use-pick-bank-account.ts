/**
 * usePickBankAccount Hook
 *
 * Shared persist-then-flip choreography for the inFakt bank-account picker
 * (#1303 follow-up, #1310 review). Both picker surfaces (the setup wizard and
 * the edit screen's structured section) delegate here so the ordering
 * invariant lives in exactly one place:
 *
 *   1. Persist the picked account snapshot into `config.bankAccount` via the
 *      generic update-connection mutation (from the caller-supplied base
 *      config, so unrelated unsaved form edits don't leak).
 *   2. Only after that persist succeeds, flip inFakt's own "default account"
 *      via `useSetDefaultBankAccountMutation` — a failed persist must never
 *      leave inFakt flipped while OL still stamps the previous account.
 *      Accounts inFakt already reports as `isDefault` skip the flip.
 *
 * Error surfacing: a failed persist toasts here with a caller-supplied
 * recovery hint (the two surfaces recover differently); a failed flip toasts
 * inside `useSetDefaultBankAccountMutation` itself.
 *
 * `isPending` is true while either leg is in flight — callers disable the
 * picker `Select` on it so a quick double-pick can't race two persist+flip
 * chains into an OL<->inFakt divergence (#1310 review, finding 4).
 *
 * @module features/connections/hooks
 */
import { useCallback } from 'react';
import { useUpdateConnectionMutation } from './use-update-connection-mutation';
import { useSetDefaultBankAccountMutation } from './use-set-default-bank-account-mutation';
import type { BankAccount } from '../api/connections.types';
import { useToast } from '../../../shared/ui/toast-provider';

interface UsePickBankAccountOptions {
  connectionId: string;
  /**
   * Surface-specific recovery hint appended to the persist-failure toast,
   * e.g. "re-pick it from the connection's edit screen." — the wizard and
   * the edit screen recover differently.
   */
  persistErrorHint: string;
}

interface UsePickBankAccountResult {
  /**
   * Persist `account` as `config.bankAccount` on top of `baseConfig`, then
   * (success-gated) flip inFakt's default when the account isn't already it.
   */
  pickAccount: (account: BankAccount, baseConfig: Record<string, unknown>) => void;
  /** True while the persist or the default flip is in flight. */
  isPending: boolean;
}

export function usePickBankAccount(
  options: UsePickBankAccountOptions,
): UsePickBankAccountResult {
  const { connectionId, persistErrorHint } = options;
  const updateConnection = useUpdateConnectionMutation();
  const setDefaultBankAccount = useSetDefaultBankAccountMutation();
  const { showToast } = useToast();

  const pickAccount = useCallback(
    (account: BankAccount, baseConfig: Record<string, unknown>): void => {
      // Persisted snapshot intentionally omits `isDefault` — it's a live
      // provider-side fact, not part of the stamped configuration.
      const snapshot = {
        id: account.id,
        accountNumber: account.accountNumber,
        bankName: account.bankName,
      };
      updateConnection.mutate(
        {
          connectionId,
          input: { config: { ...baseConfig, bankAccount: snapshot } },
        },
        {
          onSuccess: () => {
            if (!account.isDefault) {
              setDefaultBankAccount.mutate({ connectionId, accountId: account.id });
            }
          },
          onError: (error) => {
            showToast({
              tone: 'error',
              title: 'Could not save the bank account',
              description: `The selection was not persisted - ${persistErrorHint} ${error.message}`,
            });
          },
        },
      );
    },
    [connectionId, persistErrorHint, updateConnection, setDefaultBankAccount, showToast],
  );

  return {
    pickAccount,
    isPending: updateConnection.isPending || setDefaultBankAccount.isPending,
  };
}

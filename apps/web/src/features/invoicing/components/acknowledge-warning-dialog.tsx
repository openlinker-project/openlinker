/**
 * useWarningAcknowledgement (DEF-23 / DEF-26 / DEF-30 / DEF-31)
 *
 * OpenLinker suggests, the operator decides. Where the server reads a sale as
 * one it would not issue by default - a cancelled order, a buyer tax number
 * changed in a correction, a public-sector flag with no unit named - it
 * refuses once and names a warning code. This hook turns that refusal into a
 * confirm dialog: it shows the server's own sentence, and on confirm re-sends
 * the same request with the code added to `acknowledgeWarnings`.
 *
 * Codes accumulate across one attempt, because a request can carry more than
 * one warning and the server reports them one at a time. They reset when the
 * caller starts a new attempt (`reset`), so a confirmation never silently
 * carries over to a different sale.
 *
 * @module features/invoicing/components
 */
import { type ReactElement, useRef, useState } from 'react';
import { useTranslation } from '../../../shared/i18n';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { readAcknowledgementRequest, type AcknowledgementRequest } from '../lib/issue-error-message';

export interface WarningAcknowledgement {
  /**
   * Offer the operator the choice to proceed past `error`. Returns true when
   * the error was such a refusal (the dialog is now open and the caller
   * should not also show a toast), false for any other error.
   */
  offer: (error: unknown, resubmit: (acknowledgeWarnings: string[]) => void) => boolean;
  /** The codes confirmed so far in this attempt. */
  acknowledged: string[];
  /** Forget earlier confirmations - call when a new, different attempt starts. */
  reset: () => void;
  dialog: ReactElement;
}

export function useWarningAcknowledgement(isConfirming = false): WarningAcknowledgement {
  const { t } = useTranslation();
  const [request, setRequest] = useState<AcknowledgementRequest | null>(null);
  const acknowledgedRef = useRef<string[]>([]);
  const resubmitRef = useRef<((codes: string[]) => void) | null>(null);

  function offer(error: unknown, resubmit: (codes: string[]) => void): boolean {
    const found = readAcknowledgementRequest(error);
    // A code already confirmed coming back means the server still refuses:
    // that is a real failure, not a question, so it falls through to a toast.
    if (!found || acknowledgedRef.current.includes(found.warningCode)) {
      return false;
    }
    resubmitRef.current = resubmit;
    setRequest(found);
    return true;
  }

  function confirm(): void {
    if (!request) {
      return;
    }
    const codes = [...acknowledgedRef.current, request.warningCode];
    acknowledgedRef.current = codes;
    setRequest(null);
    resubmitRef.current?.(codes);
  }

  function reset(): void {
    acknowledgedRef.current = [];
  }

  const dialog = (
    <ConfirmDialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) {
          setRequest(null);
        }
      }}
      title={t('invoice.acknowledge.title', 'Check before you continue')}
      description={request?.message ?? ''}
      body={
        <p className="acknowledge-warning__note">
          {t(
            'invoice.acknowledge.note',
            'OpenLinker flags this from its own reading of the rules, which may not fit your case. You decide whether to go ahead.',
          )}
        </p>
      }
      confirmLabel={t('invoice.acknowledge.confirm', 'Continue anyway')}
      cancelLabel={t('invoice.acknowledge.cancel', 'Go back')}
      isConfirming={isConfirming}
      onConfirm={confirm}
    />
  );

  return { offer, acknowledged: acknowledgedRef.current, reset, dialog };
}

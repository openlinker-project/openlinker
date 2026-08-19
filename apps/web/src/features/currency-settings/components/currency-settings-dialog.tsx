/**
 * Currency Settings Dialog
 *
 * Edit modal for the system-level reporting currency (ADR-040). Plain local
 * state rather than React Hook Form / Zod — the only field is a `<select>`
 * constrained to `supportedCurrencies`, so there is no free-text validation
 * to run.
 *
 * The `<select>` options come from the response's `supportedCurrencies`,
 * which is what makes the backend's 400 (bad ISO shape) / 422 (unreachable
 * code) paths unreachable from this UI and leaves them as protection for a
 * direct caller only.
 *
 * The coverage advisory WARNS and NEVER BLOCKS by contract (ADR-040): a
 * single junk currency in old order history must not make a legitimate
 * reporting currency permanently unselectable. So the checkbox gates the
 * primary action locally, in this dialog, rather than the backend rejecting
 * an unacknowledged submit.
 *
 * A11Y (#2135 review, finding 8): both warnings appear REACTIVELY, on a
 * `<select>` change rather than on submit, and the coverage one gates Save behind
 * a checkbox. `Alert` already carries `role="status"` for its warning tone, but a
 * live region that is INSERTED together with its content is not reliably
 * announced - screen readers watch an existing region for mutations. So a single
 * persistently-mounted visually-hidden region below announces which warnings
 * materialised, following `category-search-results.tsx`. Its text is derived, not
 * duplicated: it names the warning and the required acknowledgement rather than
 * re-reading the per-currency counts, which are available on the visible Alert.
 *
 * @module apps/web/src/features/currency-settings/components
 */
import { useEffect, useState, type ReactElement } from 'react';
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
import { FormField } from '../../../shared/ui/form-field';
import { Select } from '../../../shared/ui/select';
import { useToast } from '../../../shared/ui/toast-provider';
import { useSetReportingCurrencyMutation } from '../hooks/use-set-reporting-currency-mutation';
import type { CurrencySettingsView } from '../api/currency-settings.types';

interface CurrencySettingsDialogProps {
  open: boolean;
  view: CurrencySettingsView;
  onClose: () => void;
}

export function CurrencySettingsDialog({
  open,
  view,
  onClose,
}: CurrencySettingsDialogProps): ReactElement {
  const { showToast } = useToast();
  const mutation = useSetReportingCurrencyMutation();
  const [selected, setSelected] = useState(view.reportingCurrency);
  const [acknowledged, setAcknowledged] = useState(false);

  // Reset whenever the dialog opens, matching the ai-provider-key-dialog /
  // posthog-settings-dialog #478 fix: depend only on `open` + the stable
  // mutation.reset, not on `view` (a background refetch must not clobber an
  // in-progress edit) or on the wrapping mutation object (fresh identity
  // every render would loop the effect).
  // `view` is intentionally excluded: resetting on every background refetch
  // (not just on open) would clobber an in-progress edit — same #478 shape
  // as the posthog-settings / mailer-settings dialogs.
  const { reset: resetMutation } = mutation;
  useEffect(() => {
    if (open) {
      setSelected(view.reportingCurrency);
      setAcknowledged(false);
      resetMutation();
    }
  }, [open, resetMutation]);

  const selectedCoverage = view.coverage.find((entry) => entry.reportingCurrency === selected);
  const hasCoverageGap = (selectedCoverage?.uncoverableCurrencies.length ?? 0) > 0;

  const otherEraStamped = view.stampedOrders.filter((entry) => entry.reportingCurrency !== selected);
  const willSplitHistory = selected !== view.reportingCurrency && otherEraStamped.length > 0;

  const canSubmit = selected.length > 0 && (!hasCoverageGap || acknowledged);

  // One string, so the region has exactly one announcement per state change
  // rather than two competing ones. Empty when neither warning applies, which is
  // what returns the region to silence after the operator picks a clean currency.
  const warningAnnouncement = [
    willSplitHistory
      ? `Warning: switching to ${selected} splits reporting history. Orders already stamped in ` +
        `${otherEraStamped.map((entry) => entry.reportingCurrency).join(', ')} keep that stamp.`
      : null,
    hasCoverageGap
      ? `Warning: coverage gap. ` +
        `${selectedCoverage?.uncoverableCurrencies.join(', ') ?? ''} cannot be converted to ` +
        `${selected}. Acknowledge before saving.`
      : null,
  ]
    .filter(Boolean)
    .join(' ');

  const handleSubmit = async (): Promise<void> => {
    try {
      await mutation.mutateAsync({
        reportingCurrency: selected,
        acknowledgeCoverageGaps: acknowledged,
      });
      showToast({
        tone: 'success',
        title: 'Reporting currency saved',
        description: `Analytics now reports in ${selected}.`,
      });
      onClose();
    } catch {
      // Surfaced via mutation.error -> <Alert> below.
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>Currency</DialogTitle>
        <DialogDescription>Read by Analytics · never used on an invoice</DialogDescription>

        {/*
          PERSISTENTLY MOUNTED, deliberately: this element must already exist when
          its text changes, or the announcement is unreliable. Rendering it only
          while a warning applies would reproduce the exact gap it closes.
        */}
        <p className="sr-only" role="status" aria-live="polite">
          {warningAnnouncement}
        </p>

        {mutation.error ? (
          <Alert tone="error" title="Could not save the reporting currency">
            {mutation.error.message}
          </Alert>
        ) : null}

        {willSplitHistory ? (
          <Alert tone="warning" title={`Report in ${selected} from now on?`}>
            {otherEraStamped.map((entry) => (
              <p key={entry.reportingCurrency}>
                <span className="alert__count">{entry.count}</span> orders already carry a{' '}
                {entry.reportingCurrency} stamp. Those keep it — stamps are immutable — so this
                deployment will hold more than one reporting-currency era and no single figure will
                span them.
              </p>
            ))}
          </Alert>
        ) : null}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
          noValidate
        >
          <FormField label="Report in" name="reportingCurrency">
            <Select
              value={selected}
              onChange={(event) => {
                setSelected(event.target.value);
                setAcknowledged(false);
              }}
            >
              {view.supportedCurrencies.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </FormField>

          {hasCoverageGap ? (
            <Alert tone="warning" title="Coverage gap">
              <p>
                {selectedCoverage?.uncoverableCurrencies.join(', ')} order
                {selectedCoverage && selectedCoverage.uncoverableCurrencies.length > 1 ? 's' : ''}{' '}
                cannot be converted to {selected} by the registered rate source. Those orders will
                record as not convertible rather than blocking this change.
              </p>
              <label className="currency-settings-ack">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => {
                    setAcknowledged(event.target.checked);
                  }}
                />
                <span>I understand.</span>
              </label>
            </Alert>
          ) : null}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" tone="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!canSubmit || mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

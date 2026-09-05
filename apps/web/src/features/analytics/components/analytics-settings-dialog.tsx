/**
 * Analytics Settings Dialog
 *
 * Reproduces the mockup's `settings-open` state (#2473, ADR-064). Two
 * independent concerns share this dialog, and their reversibility framing
 * must NOT be merged into one blanket claim (regression caught twice during
 * mockup design review — see the top-level description below):
 *
 *   1. "Show amounts in" / "Rate basis" — the SAME URL-encoded view
 *      preference the toolbar picker (`AnalyticsCurrencyPicker`, #2472)
 *      already drives. Genuinely non-destructive: Apply only pushes a
 *      search-param change, exactly like the date-range toolbar's own
 *      Apply. This is NOT `AnalyticsSettingsView.displayCurrency`/
 *      `rateBasis` (the persisted, admin-only DEFAULT those fields resolve
 *      from when no URL override is present) — a different axis, never
 *      written by this section.
 *   2. "Currency — recalculation" / "Tax rates" / "Default VAT basis" — real,
 *      persisted actions. Recalculating enqueues a real remediation run
 *      (`POST /analytics/coverage/currency/recalculate`, #2468); the tax
 *      toggle and the VAT-basis default both write via
 *      `useUpdateAnalyticsSettingsMutation` (#2471, #2895), preserving
 *      whatever `displayCurrency`/`rateBasis`/other fields are already
 *      persisted, since this dialog must never overwrite an admin default
 *      with an ephemeral view preference. "Default VAT basis" is the
 *      save-as-default counterpart to the toolbar's `AnalyticsNetGrossToggle`
 *      (rendered stacked directly below the currency picker, #2895): the
 *      toggle is the URL-encoded session choice — see (1) — while this
 *      section is what a returning operator's future visits fall back to
 *      when no session override is present.
 *
 * The "automatically recalculate" toggle from the reference mockup has no
 * backend counterpart yet (no persisted setting exists for it) — rendered
 * disabled rather than fabricated as a working control.
 *
 * @module apps/web/src/features/analytics/components
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../shared/ui/dialog';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { Select } from '../../../shared/ui/select';
import { useToast } from '../../../shared/ui/toast-provider';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { useDemoMode } from '../../system';
import { useAnalyticsSettingsQuery } from '../hooks/use-analytics-settings-query';
import { useUpdateAnalyticsSettingsMutation } from '../hooks/use-update-analytics-settings-mutation';
import { useAnalyticsCoverageQuery } from '../hooks/use-analytics-coverage-query';
import { useRecalculateCurrencyMutation } from '../hooks/use-recalculate-currency-mutation';
import { DISPLAY_CURRENCY_OPTIONS } from '../lib/display-currency.lib';
import type { AnalyticsCoverageFilters } from '../api/analytics-coverage.types';
import type { DisplayCurrencyRateBasis } from '../api/sales-analytics.types';
import type { NetGrossBasis } from '../api/analytics-settings.types';

interface AnalyticsSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` means no override — mirrors the toolbar picker's own state. */
  displayCurrency: string | null;
  rateBasis: DisplayCurrencyRateBasis;
  reportingCurrency: string | null;
  onApplyView: (displayCurrency: string | null, rateBasis: DisplayCurrencyRateBasis) => void;
  /** Bucketing window for the coverage counts / recalculation action, ISO 8601. */
  coverageFilters: AnalyticsCoverageFilters;
}

const NATIVE_VALUE = '';

export function AnalyticsSettingsDialog({
  open,
  onOpenChange,
  displayCurrency,
  rateBasis,
  reportingCurrency,
  onApplyView,
  coverageFilters,
}: AnalyticsSettingsDialogProps): ReactElement {
  const { showToast } = useToast();
  const demoMode = useDemoMode();
  const write = useWriteAccess('analytics:write', demoMode);

  const [draftDisplayCurrency, setDraftDisplayCurrency] = useState(displayCurrency ?? NATIVE_VALUE);
  const [draftRateBasis, setDraftRateBasis] = useState<DisplayCurrencyRateBasis>(rateBasis);

  useEffect(() => {
    if (open) {
      setDraftDisplayCurrency(displayCurrency ?? NATIVE_VALUE);
      setDraftRateBasis(rateBasis);
    }
  }, [open, displayCurrency, rateBasis]);

  const settingsQuery = useAnalyticsSettingsQuery();
  const updateSettings = useUpdateAnalyticsSettingsMutation();
  const coverageQuery = useAnalyticsCoverageQuery(coverageFilters, { enabled: open });
  const recalculate = useRecalculateCurrencyMutation();

  const [confirmingRecalculate, setConfirmingRecalculate] = useState(false);

  const currencyRow = coverageQuery.data?.categories.find((row) => row.category === 'currency');
  const currencyPendingCount = currencyRow?.affectedCount ?? 0;
  // A live run (the panel's own `currencyRunPhase`, mirrored here off the
  // same coverage row) must disable this button too — otherwise a second
  // click during an in-progress run posts again and surfaces the server's
  // 409 as a raw error toast (#2668 review, finding 14).
  const currencyRunInProgress = currencyRow?.status === 'in-progress';
  const taxA = coverageQuery.data?.categories.find((row) => row.category === 'tax-a')?.affectedCount ?? 0;
  const taxB = coverageQuery.data?.categories.find((row) => row.category === 'tax-b')?.affectedCount ?? 0;
  const taxC = coverageQuery.data?.categories.find((row) => row.category === 'tax-c')?.affectedCount ?? 0;

  function handleApply(): void {
    onApplyView(draftDisplayCurrency === NATIVE_VALUE ? null : draftDisplayCurrency, draftRateBasis);
    onOpenChange(false);
  }

  function handleRecalculate(): void {
    setConfirmingRecalculate(false);
    recalculate.mutate(coverageFilters, {
      onSuccess: () => {
        showToast({
          tone: 'success',
          title: 'Recalculation started',
          description: 'Affected orders are being restated in the background.',
        });
      },
      onError: (error) => {
        showToast({ tone: 'error', description: error.message });
      },
    });
  }

  function handleTaxToggleChange(nextInclude: boolean): void {
    if (!settingsQuery.data) {
      return;
    }
    updateSettings.mutate(
      {
        // Only echo back a real, previously-stored override — `GET` resolves
        // `displayCurrency` to the system reporting currency whenever no
        // override exists (`displayCurrencySource: 'default'`), and echoing
        // that resolved value into `PUT` would pin it as a literal override
        // that never existed (#2668 review, finding 10): flip this toggle
        // once and a later reporting-currency change stops moving the
        // default for this deployment.
        displayCurrency:
          settingsQuery.data.displayCurrencySource === 'setting'
            ? settingsQuery.data.displayCurrency
            : null,
        rateBasis: settingsQuery.data.rateBasis,
        includeBackfilledTaxRatesInNetSales: nextInclude,
        netGrossBasis: settingsQuery.data.netGrossBasis,
      },
      {
        onError: (error) => {
          showToast({ tone: 'error', description: error.message });
        },
      }
    );
  }

  // Persists the ORG-WIDE default a view opens in when no `?netGrossBasis=`
  // URL override is present — the save-as-default counterpart to the
  // toolbar's `AnalyticsNetGrossToggle`, exactly mirroring how the tax-rate
  // toggle above is this dialog's one already-shipped immediate-write
  // pattern (Apply only ever pushes a URL param, never a persisted write).
  function handleNetGrossBasisDefaultChange(next: NetGrossBasis): void {
    if (!settingsQuery.data) {
      return;
    }
    updateSettings.mutate(
      {
        displayCurrency:
          settingsQuery.data.displayCurrencySource === 'setting'
            ? settingsQuery.data.displayCurrency
            : null,
        rateBasis: settingsQuery.data.rateBasis,
        includeBackfilledTaxRatesInNetSales: settingsQuery.data.includeBackfilledTaxRatesInNetSales,
        netGrossBasis: next,
      },
      {
        onError: (error) => {
          showToast({ tone: 'error', description: error.message });
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-label="Analytics settings">
        <DialogTitle>Analytics settings</DialogTitle>
        {/* Scoped to the two view-preference fields only — the Currency
            section below carries its own, separate permanent-write caveat.
            Do not widen this back into a blanket "nothing is saved". */}
        <DialogDescription>
          Display currency and rate basis (below) only change what you see on this screen — nothing
          is saved. Actions further down can write data permanently — each one says so plainly.
        </DialogDescription>

        <div className="analytics-settings-dialog__field">
          <span className="analytics-settings-dialog__label">Show amounts in</span>
          <Select
            aria-label="Show amounts in"
            value={draftDisplayCurrency}
            onChange={(event) => setDraftDisplayCurrency(event.target.value)}
          >
            <option value={NATIVE_VALUE}>
              {reportingCurrency ? `${reportingCurrency} · reporting currency` : 'Reporting currency'}
            </option>
            {DISPLAY_CURRENCY_OPTIONS.filter((code) => code !== reportingCurrency).map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </div>

        <fieldset className="analytics-settings-dialog__field">
          <legend className="analytics-settings-dialog__label">Rate basis</legend>
          <label className="analytics-settings-dialog__rate-basis-option">
            <input
              type="radio"
              name="rate-basis"
              checked={draftRateBasis === 'current-rate'}
              onChange={() => setDraftRateBasis('current-rate')}
            />
            <span>
              <strong>Current rate</strong>
              <span className="analytics-settings-dialog__rate-basis-desc">
                What it&rsquo;s worth today — sums each order&rsquo;s real amount and converts it at
                today&rsquo;s rate.
              </span>
            </span>
          </label>
          <label className="analytics-settings-dialog__rate-basis-option">
            <input
              type="radio"
              name="rate-basis"
              checked={draftRateBasis === 'order-date'}
              onChange={() => setDraftRateBasis('order-date')}
            />
            <span>
              <strong>Rate on order date</strong>
              <span className="analytics-settings-dialog__rate-basis-desc">
                Keeps each order at its own order-date rate. Showing a different currency converts
                that total at today&rsquo;s rate - analytics only, not a figure for tax filings.
              </span>
            </span>
          </label>
        </fieldset>

        <section className="analytics-settings-dialog__section">
          <h3 className="analytics-settings-dialog__section-title">Default VAT basis</h3>
          <p className="analytics-settings-dialog__status">
            Saved immediately and applies to every future visit that doesn&rsquo;t pick its own basis
            via the toolbar toggle.
          </p>
          {write.visible && (
            <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
              <fieldset className="analytics-settings-dialog__field">
                <legend className="sr-only">Default VAT basis</legend>
                <label className="analytics-settings-dialog__rate-basis-option">
                  <input
                    type="radio"
                    name="net-gross-basis-default"
                    checked={(settingsQuery.data?.netGrossBasis ?? 'gross') === 'gross'}
                    disabled={!settingsQuery.data || updateSettings.isPending || write.demoReadOnly}
                    onChange={() => handleNetGrossBasisDefaultChange('gross')}
                  />
                  <span>
                    <strong>Gross</strong>
                    <span className="analytics-settings-dialog__rate-basis-desc">
                      VAT-inclusive figures, by default.
                    </span>
                  </span>
                </label>
                <label className="analytics-settings-dialog__rate-basis-option">
                  <input
                    type="radio"
                    name="net-gross-basis-default"
                    checked={settingsQuery.data?.netGrossBasis === 'net'}
                    disabled={!settingsQuery.data || updateSettings.isPending || write.demoReadOnly}
                    onChange={() => handleNetGrossBasisDefaultChange('net')}
                  />
                  <span>
                    <strong>Net</strong>
                    <span className="analytics-settings-dialog__rate-basis-desc">
                      VAT-exclusive figures, by default.
                    </span>
                  </span>
                </label>
              </fieldset>
            </ReadOnlyLock>
          )}
        </section>

        <section className="analytics-settings-dialog__section">
          <h3 className="analytics-settings-dialog__section-title">Currency — recalculation</h3>
          <Alert tone="warning">
            This section writes data permanently: &ldquo;Recalculate now&rdquo; saves the real
            exchange rate from each order&rsquo;s date to the database — this isn&rsquo;t a preview.
          </Alert>
          <label className="analytics-settings-dialog__toggle">
            <input type="checkbox" disabled checked={false} onChange={() => undefined} />
            <span>
              <strong>Automatically recalculate outstanding orders when the reporting currency changes</strong>
              <span className="analytics-settings-dialog__toggle-desc">Not available yet.</span>
            </span>
          </label>
          {coverageQuery.isLoading ? (
            <p className="analytics-settings-dialog__status">Checking for outstanding orders…</p>
          ) : currencyPendingCount > 0 ? (
            <div className="analytics-settings-dialog__status">
              <span>
                {currencyPendingCount} order{currencyPendingCount === 1 ? '' : 's'} waiting to be
                recalculated
              </span>
              {write.visible && (
                <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
                  <Button
                    type="button"
                    className="button--sm"
                    disabled={recalculate.isPending || write.demoReadOnly || currencyRunInProgress}
                    onClick={() => setConfirmingRecalculate(true)}
                  >
                    {currencyRunInProgress
                      ? 'Recalculating…'
                      : recalculate.isPending
                        ? 'Starting…'
                        : 'Recalculate now'}
                  </Button>
                </ReadOnlyLock>
              )}
            </div>
          ) : (
            <p className="analytics-settings-dialog__status">Everything&rsquo;s up to date</p>
          )}
        </section>

        <section className="analytics-settings-dialog__section">
          <h3 className="analytics-settings-dialog__section-title">Tax rates</h3>
          {write.visible && (
            <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
              <label className="analytics-settings-dialog__toggle">
                <input
                  type="checkbox"
                  checked={settingsQuery.data?.includeBackfilledTaxRatesInNetSales ?? false}
                  disabled={!settingsQuery.data || updateSettings.isPending || write.demoReadOnly}
                  onChange={(event) => handleTaxToggleChange(event.target.checked)}
                />
                <span>
                  <strong>Use the rate found in the product catalog</strong>
                  <span className="analytics-settings-dialog__toggle-desc">
                    Trust a tax rate found retroactively in the catalog and include such orders in Net
                    Sales automatically. This applies to everyone and to every date range, not just the
                    one you&rsquo;re viewing - turning it off removes these orders from Net Sales again
                    the next time the figures are queried.
                  </span>
                </span>
              </label>
            </ReadOnlyLock>
          )}
          {coverageQuery.isLoading || settingsQuery.isLoading ? (
            <p className="analytics-settings-dialog__status">Checking tax-rate coverage…</p>
          ) : coverageQuery.isError || settingsQuery.isError ? (
            <Alert tone="error">
              Couldn&rsquo;t load tax-rate coverage — the counts and setting state below may be
              wrong.
            </Alert>
          ) : (
            <ul className="analytics-settings-dialog__tax-summary">
              <li>{taxA} orders — rate found, {settingsQuery.data?.includeBackfilledTaxRatesInNetSales ? 'included automatically' : 'waiting for confirmation'}</li>
              <li>{taxB} orders — no rate at the source (needs fixing at the source)</li>
              <li>{taxC} orders — product added after launch, rate still unresolved</li>
            </ul>
          )}
        </section>

        <DialogFooter>
          <Button type="button" tone="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleApply}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
      <ConfirmDialog
        open={confirmingRecalculate}
        onOpenChange={setConfirmingRecalculate}
        title="Recalculate now?"
        description="This saves the real exchange rate from each order's own date to the database, for good — this is not a preview and cannot be undone from here."
        confirmLabel="Recalculate"
        isConfirming={recalculate.isPending}
        onConfirm={handleRecalculate}
        overlayClassName="dialog__overlay--elevated"
        className="dialog__content--elevated"
      />
    </Dialog>
  );
}

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
 *   2. "Currency — recalculation" / "Tax rates" — real, persisted actions.
 *      Recalculating enqueues a real remediation run
 *      (`POST /analytics/coverage/currency/recalculate`, #2468); the tax
 *      toggle writes `includeBackfilledTaxRatesInNetSales` via
 *      `useUpdateAnalyticsSettingsMutation` (#2471), preserving whatever
 *      `displayCurrency`/`rateBasis` defaults are already persisted, since
 *      this dialog must never overwrite an admin default with an ephemeral
 *      view preference.
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

  const currencyPendingCount =
    coverageQuery.data?.categories.find((row) => row.category === 'currency')?.affectedCount ?? 0;
  const taxA = coverageQuery.data?.categories.find((row) => row.category === 'tax-a')?.affectedCount ?? 0;
  const taxB = coverageQuery.data?.categories.find((row) => row.category === 'tax-b')?.affectedCount ?? 0;
  const taxC = coverageQuery.data?.categories.find((row) => row.category === 'tax-c')?.affectedCount ?? 0;

  function handleApply(): void {
    onApplyView(draftDisplayCurrency === NATIVE_VALUE ? null : draftDisplayCurrency, draftRateBasis);
    onOpenChange(false);
  }

  function handleRecalculate(): void {
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
        displayCurrency: settingsQuery.data.displayCurrency,
        rateBasis: settingsQuery.data.rateBasis,
        includeBackfilledTaxRatesInNetSales: nextInclude,
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
                    disabled={recalculate.isPending || write.demoReadOnly}
                    onClick={handleRecalculate}
                  >
                    {recalculate.isPending ? 'Starting…' : 'Recalculate now'}
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
          <ul className="analytics-settings-dialog__tax-summary">
            <li>{taxA} orders — rate found, {settingsQuery.data?.includeBackfilledTaxRatesInNetSales ? 'included automatically' : 'waiting for confirmation'}</li>
            <li>{taxB} orders — no rate at the source (needs fixing at the source)</li>
            <li>{taxC} orders — product added after launch, rate still unresolved</li>
          </ul>
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
    </Dialog>
  );
}

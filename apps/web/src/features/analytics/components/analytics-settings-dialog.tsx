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
 *      `rateBasis` — a different axis, never written by this section.
 *
 *      **Those two persisted fields are not a default the dashboard falls
 *      back to** (#2668 review, finding 5 — the earlier wording here said
 *      they were). `analytics-page.tsx` resolves `displayCurrency` and
 *      `rateBasis` from the URL alone, with `null` / `'current-rate'` as the
 *      hardcoded fallbacks, and never consults the settings response for
 *      either. That is ADR-064's own design — the display currency "lives in
 *      the URL like the date range, never in a saved preference", so it is
 *      shareable and reversible with no persisted side effect — and it is
 *      deliberately asymmetric with `netGrossBasis` on the same object,
 *      which IS resolved from the persisted value when no URL override is
 *      present. What is left is a stored value with no reader: the settings
 *      row still carries `displayCurrency` / `displayCurrencySource` /
 *      `rateBasis`, and `PUT /analytics/settings` still requires them, so a
 *      caller can persist a display currency the dashboard will never honour.
 *      Stated here so nobody reads the round trip as working; removing those
 *      fields from the contract, or giving them a reader, is a follow-up.
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
import { describeApiError } from '../../../shared/api/describe-api-error';
import { interpolate, useMessages, usePlural } from '../../../shared/i18n';
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
import { demoReadOnlyActionMessage } from '../../../shared/config/demo-mode';
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
  const copy = useMessages('analytics').analyticsSettingsDialog;
  const plural = usePlural();
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
  const [confirmingTaxInclude, setConfirmingTaxInclude] = useState(false);

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
          title: copy.toast.recalculationStarted.title,
          description: copy.toast.recalculationStarted.description,
        });
      },
      onError: (error) => {
        showToast({ tone: 'error', description: describeApiError(error, 'analytics') });
      },
    });
  }

  // A real, deployment-wide financial-reporting write triggered from one
  // click — same class of action as `handleRecalculate` above, so it gets
  // the same confirm gate (#2857, mirroring #2668 review, finding 14). It is
  // NOT a permanent write — per `docs/architecture-overview.md` § Orders
  // (#2469), it's a pure query-time gate, instantly reversible in both
  // directions, and no `order_records` row is mutated. The gate is
  // warranted anyway because the write is deployment-wide (affects every
  // operator, every date range) and invisible to whoever flipped it — the
  // operator reading THIS date range has no way to see it silently change
  // Net Sales for every other range too (#2993 review, IMPORTANT 4). Only
  // the ON direction is gated: turning the setting back OFF is the safe,
  // reversing direction (mockup's `tax-confirm` state only offers a confirm
  // button next to "turn on").
  function handleConfirmTaxInclude(): void {
    setConfirmingTaxInclude(false);
    handleTaxToggleChange(true);
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
          showToast({ tone: 'error', description: describeApiError(error, 'analytics') });
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
          showToast({ tone: 'error', description: describeApiError(error, 'analytics') });
        },
      }
    );
  }

  // Immediate write, like the two toggles above. The other writers in this
  // file omit `trackMargin`, which the API reads as "keep the stored value".
  function handleTrackMarginChange(next: boolean): void {
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
        netGrossBasis: settingsQuery.data.netGrossBasis,
        trackMargin: next,
      },
      {
        onError: (error) => {
          showToast({ tone: 'error', description: describeApiError(error, 'analytics') });
        },
      }
    );
  }

  const trackMargin = settingsQuery.data?.trackMargin !== false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-label={copy.title}>
        <DialogTitle>{copy.title}</DialogTitle>
        {/* Scoped to the two view-preference fields only — the Currency
            section below carries its own, separate permanent-write caveat.
            Do not widen this back into a blanket "nothing is saved". */}
        <DialogDescription>{copy.description}</DialogDescription>

        <div className="analytics-settings-dialog__field">
          <span className="analytics-settings-dialog__label">{copy.showAmountsIn}</span>
          <Select
            aria-label={copy.showAmountsIn}
            value={draftDisplayCurrency}
            onChange={(event) => setDraftDisplayCurrency(event.target.value)}
          >
            <option value={NATIVE_VALUE}>
              {reportingCurrency
                ? interpolate(copy.reportingCurrencyNamed, { currency: reportingCurrency })
                : copy.reportingCurrency}
            </option>
            {DISPLAY_CURRENCY_OPTIONS.filter((code) => code !== reportingCurrency).map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </div>

        <fieldset className="analytics-settings-dialog__field">
          <legend className="analytics-settings-dialog__label">{copy.rateBasis.legend}</legend>
          <label className="analytics-settings-dialog__rate-basis-option">
            <input
              type="radio"
              name="rate-basis"
              checked={draftRateBasis === 'current-rate'}
              onChange={() => setDraftRateBasis('current-rate')}
            />
            <span>
              <strong>{copy.rateBasis.current.title}</strong>
              <span className="analytics-settings-dialog__rate-basis-desc">
                {copy.rateBasis.current.description}
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
              <strong>{copy.rateBasis.orderDate.title}</strong>
              <span className="analytics-settings-dialog__rate-basis-desc">
                {copy.rateBasis.orderDate.description}
              </span>
            </span>
          </label>
        </fieldset>

        <section className="analytics-settings-dialog__section">
          <h3 className="analytics-settings-dialog__section-title">{copy.vatBasis.title}</h3>
          <p className="analytics-settings-dialog__status">{copy.vatBasis.status}</p>
          {write.visible && (
            <ReadOnlyLock active={write.demoReadOnly} message={demoReadOnlyActionMessage()}>
              <fieldset className="analytics-settings-dialog__field">
                <legend className="sr-only">{copy.vatBasis.title}</legend>
                <label className="analytics-settings-dialog__rate-basis-option">
                  <input
                    type="radio"
                    name="net-gross-basis-default"
                    checked={(settingsQuery.data?.netGrossBasis ?? 'gross') === 'gross'}
                    disabled={!settingsQuery.data || updateSettings.isPending || write.demoReadOnly}
                    onChange={() => handleNetGrossBasisDefaultChange('gross')}
                  />
                  <span>
                    <strong>{copy.vatBasis.gross.title}</strong>
                    <span className="analytics-settings-dialog__rate-basis-desc">
                      {copy.vatBasis.gross.description}
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
                    <strong>{copy.vatBasis.net.title}</strong>
                    <span className="analytics-settings-dialog__rate-basis-desc">
                      {copy.vatBasis.net.description}
                    </span>
                  </span>
                </label>
              </fieldset>
            </ReadOnlyLock>
          )}
        </section>

        <section
          className="analytics-settings-dialog__section"
          data-testid="settings-margin-tracking"
        >
          <h3 className="analytics-settings-dialog__section-title">{copy.margin.title}</h3>
          <ReadOnlyLock active={write.demoReadOnly} message={demoReadOnlyActionMessage()}>
            <label className="analytics-settings-dialog__toggle">
              <input
                type="checkbox"
                data-testid="settings-margin-tracking-toggle"
                checked={trackMargin}
                disabled={
                  !settingsQuery.data || updateSettings.isPending || !write.canWrite
                }
                onChange={(event) => handleTrackMarginChange(event.target.checked)}
              />
              <span>
                <strong>{copy.margin.toggle}</strong>
                <span className="analytics-settings-dialog__toggle-desc">
                  {copy.margin.description}
                </span>
              </span>
            </label>
          </ReadOnlyLock>
          {!write.canWrite && !write.demoReadOnly ? (
            <Alert tone="info">
              {trackMargin ? copy.margin.onAdminOnly : copy.margin.offAdminOnly}
            </Alert>
          ) : null}
        </section>

        <section className="analytics-settings-dialog__section">
          <h3 className="analytics-settings-dialog__section-title">{copy.currency.title}</h3>
          <Alert tone="warning">{copy.currency.warning}</Alert>
          <label className="analytics-settings-dialog__toggle">
            <input type="checkbox" disabled checked={false} onChange={() => undefined} />
            <span>
              <strong>{copy.currency.autoToggle}</strong>
              <span className="analytics-settings-dialog__toggle-desc">
                {copy.currency.notAvailable}
              </span>
            </span>
          </label>
          {coverageQuery.isLoading ? (
            <p className="analytics-settings-dialog__status">{copy.currency.checking}</p>
          ) : currencyPendingCount > 0 ? (
            <div className="analytics-settings-dialog__status">
              <span>{plural(currencyPendingCount, copy.currency.pending)}</span>
              {write.visible && (
                <ReadOnlyLock active={write.demoReadOnly} message={demoReadOnlyActionMessage()}>
                  <Button
                    type="button"
                    className="button--sm"
                    disabled={recalculate.isPending || write.demoReadOnly || currencyRunInProgress}
                    onClick={() => setConfirmingRecalculate(true)}
                  >
                    {currencyRunInProgress
                      ? copy.currency.recalculating
                      : recalculate.isPending
                        ? copy.currency.starting
                        : copy.currency.recalculateNow}
                  </Button>
                </ReadOnlyLock>
              )}
            </div>
          ) : (
            <p className="analytics-settings-dialog__status">{copy.currency.upToDate}</p>
          )}
        </section>

        <section className="analytics-settings-dialog__section">
          <h3 className="analytics-settings-dialog__section-title">{copy.tax.title}</h3>
          {write.visible && (
            <ReadOnlyLock active={write.demoReadOnly} message={demoReadOnlyActionMessage()}>
              <label className="analytics-settings-dialog__toggle">
                <input
                  type="checkbox"
                  checked={settingsQuery.data?.includeBackfilledTaxRatesInNetSales ?? false}
                  disabled={!settingsQuery.data || updateSettings.isPending || write.demoReadOnly}
                  onChange={(event) => {
                    if (event.target.checked) {
                      setConfirmingTaxInclude(true);
                    } else {
                      handleTaxToggleChange(false);
                    }
                  }}
                />
                <span>
                  <strong>{copy.tax.toggle}</strong>
                  <span className="analytics-settings-dialog__toggle-desc">
                    {copy.tax.consequence}
                  </span>
                </span>
              </label>
            </ReadOnlyLock>
          )}
          {coverageQuery.isLoading || settingsQuery.isLoading ? (
            <p className="analytics-settings-dialog__status">{copy.tax.checking}</p>
          ) : coverageQuery.isError || settingsQuery.isError ? (
            <Alert tone="error">{copy.tax.loadError}</Alert>
          ) : (
            <ul className="analytics-settings-dialog__tax-summary">
              <li>
                {plural(
                  taxA,
                  settingsQuery.data?.includeBackfilledTaxRatesInNetSales
                    ? copy.tax.foundIncluded
                    : copy.tax.foundWaiting
                )}
              </li>
              <li>{plural(taxB, copy.tax.noRate)}</li>
              <li>{plural(taxC, copy.tax.unresolved)}</li>
            </ul>
          )}
        </section>

        <DialogFooter>
          <Button type="button" tone="secondary" onClick={() => onOpenChange(false)}>
            {copy.cancel}
          </Button>
          <Button type="button" onClick={handleApply}>
            {copy.apply}
          </Button>
        </DialogFooter>
      </DialogContent>
      <ConfirmDialog
        open={confirmingRecalculate}
        onOpenChange={setConfirmingRecalculate}
        title={copy.recalculateConfirm.title}
        description={copy.recalculateConfirm.description}
        confirmLabel={copy.recalculateConfirm.confirm}
        isConfirming={recalculate.isPending}
        onConfirm={handleRecalculate}
        overlayClassName="dialog__overlay--elevated"
        className="dialog__content--elevated"
      />
      <ConfirmDialog
        open={confirmingTaxInclude}
        onOpenChange={setConfirmingTaxInclude}
        title={copy.taxConfirm.title}
        description={copy.tax.consequence}
        body={
          <>
            <Alert tone="warning">{copy.taxConfirm.warning}</Alert>
            {coverageQuery.isLoading ? (
              <p className="analytics-settings-dialog__status" style={{ marginBottom: 0 }}>
                {copy.taxConfirm.checking}
              </p>
            ) : coverageQuery.isError ? (
              <p className="analytics-settings-dialog__status" style={{ marginBottom: 0 }}>
                {copy.taxConfirm.countUnknown}
              </p>
            ) : (
              <p className="analytics-settings-dialog__status" style={{ marginBottom: 0 }}>
                {plural(taxA, copy.taxConfirm.affects)}
              </p>
            )}
          </>
        }
        confirmLabel={copy.taxConfirm.confirm}
        isConfirming={updateSettings.isPending}
        onConfirm={handleConfirmTaxInclude}
        overlayClassName="dialog__overlay--elevated"
        className="dialog__content--elevated"
        initialFocus="cancel"
      />
    </Dialog>
  );
}

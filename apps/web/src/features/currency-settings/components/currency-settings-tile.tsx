/**
 * Currency Settings Tile
 *
 * Read-only summary of the system-level reporting currency (ADR-040),
 * rendered on `/settings` under `Platform` / `Currency` — not
 * `Analytics` / `Reporting currency`. The value is a property of the
 * deployment, not a setting owned by one module: analytics is merely its
 * first consumer, and invoices compute their own rate and never read this.
 * An `Analytics` eyebrow would under-claim (it reads as a module-local
 * preference) and a title like `Instance currency` would over-claim (it
 * implies invoices use it) — so scope lives in the body copy, where it can
 * be precise, not in the name.
 *
 * Renders THREE distinct source states, not the two the plan's `EUR
 * (default)`-whenever-`source !== 'setting'` collapse would give: "nobody
 * has decided" (`default`) and "an operator pinned this in configuration"
 * (`env`) are different facts, and only one of them is a problem.
 *
 * `stampedOrders` is deliberately NOT rendered as a bare number here — see
 * `CurrencyCoverageDialog` for why a raw count reads as an alarm ("0
 * problems") rather than the coverage fact it actually is. It's tucked
 * behind a secondary "Coverage" action instead of shown on first paint.
 *
 * @module apps/web/src/features/currency-settings/components
 */
import { useState, type ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { useCurrencySettingsQuery } from '../hooks/use-currency-settings-query';
import { CurrencyCoverageDialog } from './currency-coverage-dialog';
import { CurrencySettingsDialog } from './currency-settings-dialog';
import type { ReportingCurrencySource } from '../api/currency-settings.types';

const SOURCE_QUALIFIER: Record<ReportingCurrencySource, string | null> = {
  setting: null,
  env: 'from env',
  default: 'default',
};

function formatReportingValue(reportingCurrency: string, source: ReportingCurrencySource): string {
  const qualifier = SOURCE_QUALIFIER[source];
  return qualifier ? `${reportingCurrency} (${qualifier})` : reportingCurrency;
}

export function CurrencySettingsTile(): ReactElement {
  const query = useCurrencySettingsQuery();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [coverageOpen, setCoverageOpen] = useState(false);

  return (
    <article className="panel panel--dense">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Platform</p>
          <h3 className="section-title">Currency</h3>
        </div>
        <span className="panel__meta">Admin only</span>
      </div>

      {query.isLoading ? (
        <p className="muted-text" aria-live="polite">
          Loading currency settings…
        </p>
      ) : null}

      {query.isError ? (
        <p className="muted-text" role="alert">
          Could not load currency settings: {query.error.message}
        </p>
      ) : null}

      {query.data ? (
        <>
          <dl className="definition-list">
            <div>
              <dt>Reporting in</dt>
              <dd className="mono-text">
                {formatReportingValue(query.data.reportingCurrency, query.data.source)}
              </dd>
            </div>
            <div>
              <dt>Rate source</dt>
              <dd>{query.data.rateSource ?? 'Not configured'}</dd>
            </div>
            <div>
              <dt>Rate date rule</dt>
              <dd className="mono-text">{query.data.rateDateRule}</dd>
            </div>
          </dl>

          <p className="muted-text panel-copy">
            Every figure on Analytics is reported in this. Invoices are unaffected — they compute
            their own rate.
          </p>

          <div className="currency-settings-tile__actions">
            <Button
              tone="secondary"
              className="button--sm"
              onClick={() => {
                setDialogOpen(true);
              }}
            >
              Edit
            </Button>
            <Button
              tone="ghost"
              className="button--sm"
              onClick={() => {
                setCoverageOpen(true);
              }}
            >
              Coverage
            </Button>
          </div>

          <CurrencySettingsDialog
            open={dialogOpen}
            view={query.data}
            onClose={() => {
              setDialogOpen(false);
            }}
          />

          <CurrencyCoverageDialog
            open={coverageOpen}
            view={query.data}
            onClose={() => {
              setCoverageOpen(false);
            }}
          />
        </>
      ) : null}
    </article>
  );
}

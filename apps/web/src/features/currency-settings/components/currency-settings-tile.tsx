/**
 * Currency Settings Tile
 *
 * Settings-index row for the system-level reporting currency (ADR-040),
 * rendered on `/settings` under `Data and sync`. The value is a property of the
 * deployment, not a setting owned by one module: analytics is merely its first
 * consumer, and invoices compute their own rate and never read this. Scope
 * therefore lives in the description, where it can be precise, not in the name.
 *
 * Renders THREE distinct source states, not two: "nobody has decided"
 * (`default`) and "an operator pinned this in configuration" (`env`) are
 * different facts, and only one of them is a problem.
 *
 * `stampedOrders` is deliberately NOT rendered as a bare number here - see
 * `CurrencyCoverageDialog` for why a raw count reads as an alarm ("0 problems")
 * rather than the coverage fact it actually is. It sits behind the secondary
 * "Coverage" action instead of on first paint.
 *
 * @module apps/web/src/features/currency-settings/components
 */
import { useState, type ReactElement } from 'react';
import { describeApiError } from '../../../shared/api/describe-api-error';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { SettingsIndexRow } from '../../../shared/ui/settings-index-row';
import { useCurrencySettingsQuery } from '../hooks/use-currency-settings-query';
import { CurrencyCoverageDialog } from './currency-coverage-dialog';
import { CurrencySettingsDialog } from './currency-settings-dialog';
import type { ReportingCurrencySource } from '../api/currency-settings.types';

function CurrencySettingsLive(): ReactElement {
  const copy = useMessages('currency-settings').currencySettingsTile;
  const query = useCurrencySettingsQuery();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [coverageOpen, setCoverageOpen] = useState(false);

  const formatReportingValue = (
    reportingCurrency: string,
    source: ReportingCurrencySource,
  ): string => {
    if (source === 'setting') return reportingCurrency;
    return interpolate(copy.reportingValue, {
      currency: reportingCurrency,
      qualifier: copy.sourceQualifier[source],
    });
  };

  return (
    <SettingsIndexRow
      icon="coins"
      tone={query.data?.source === 'setting' ? 'info' : 'neutral'}
      title={copy.title}
      description={copy.body}
      valueState={query.isLoading ? 'loading' : query.isError ? 'error' : 'ready'}
      stateText={
        query.isError
          ? `${copy.loadError} ${describeApiError(query.error, 'currency-settings')}`
          : copy.loading
      }
      value={query.data ? formatReportingValue(query.data.reportingCurrency, query.data.source) : undefined}
      note={query.data ? copy.reportingIn : undefined}
      action={
        query.data
          ? {
              label: copy.actions.edit,
              onClick: (): void => {
                setDialogOpen(true);
              },
            }
          : undefined
      }
      secondary={
        query.data ? (
          <Button
            tone="ghost"
            className="button--sm"
            onClick={() => {
              setCoverageOpen(true);
            }}
          >
            {copy.actions.coverage}
          </Button>
        ) : undefined
      }
    >
      {query.data ? (
        <>
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
    </SettingsIndexRow>
  );
}

export function CurrencySettingsTile({ locked = false }: { locked?: boolean }): ReactElement {
  const copy = useMessages('currency-settings').currencySettingsTile;
  return locked ? (
    <SettingsIndexRow locked icon="coins" title={copy.title} description={copy.body} />
  ) : (
    <CurrencySettingsLive />
  );
}

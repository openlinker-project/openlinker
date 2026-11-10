/**
 * Export CSV button (#3590)
 *
 * One button per report surface, driving the shared export mutation. Four
 * visible states: idle, preparing (disabled, spinner, aria-busy), ready (a
 * success toast naming the file) and failed (an inline alert carrying the
 * server's own reason with "Change range" / "Try again").
 *
 * The file is always in the REPORTING currency. When the page shows another
 * display currency the button says so up front, because the figures in the
 * file would otherwise differ from the screen without warning.
 *
 * @module features/analytics/components
 */
import type { ReactElement } from 'react';
import { describeApiError } from '../../../shared/api/describe-api-error';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { useAnalyticsCsvExport } from '../hooks/use-analytics-csv-export';
import type { AnalyticsCsvExportRequest } from '../api/analytics-export.types';

interface ExportCsvButtonProps {
  testId: string;
  /** Human name of the report, used in the status line. */
  reportLabel: string;
  request: AnalyticsCsvExportRequest;
  /** Currency shown on screen when it is not the reporting currency. */
  displayCurrency?: string | null;
  reportingCurrency?: string | null;
  /** When set the button is disabled and this is its reason (shown as the title). */
  disabledReason?: string;
}

/** Moves the operator to the date range controls: the one fix for a refused range. */
function focusDateRange(): void {
  const input = document.querySelector<HTMLInputElement>('input[data-analytics-range-from]');
  input?.scrollIntoView({ block: 'center' });
  input?.focus();
}

export function ExportCsvButton({
  testId,
  reportLabel,
  request,
  displayCurrency,
  reportingCurrency,
  disabledReason,
}: ExportCsvButtonProps): ReactElement {
  const copy = useMessages('analytics').exportCsvButton;
  const exportCsv = useAnalyticsCsvExport();
  const preparing = exportCsv.isPending;
  const currencyDiffers =
    Boolean(displayCurrency) && Boolean(reportingCurrency) && displayCurrency !== reportingCurrency;
  const title = disabledReason
    ? disabledReason
    : currencyDiffers
      ? interpolate(copy.currencyTitle, {
          reporting: reportingCurrency ?? '',
          display: displayCurrency ?? '',
        })
      : undefined;

  function run(): void {
    exportCsv.mutate(request);
  }

  return (
    <div className="analytics-export">
      <Button
        type="button"
        tone="secondary"
        className="button--sm"
        data-testid={testId}
        disabled={preparing || Boolean(disabledReason)}
        aria-busy={preparing || undefined}
        title={title}
        onClick={run}
      >
        {preparing ? (
          <>
            <span className="button__spinner" aria-hidden="true" />
            {copy.preparing}
          </>
        ) : (
          copy.export
        )}
      </Button>
      {currencyDiffers && !preparing && !exportCsv.isError ? (
        <p className="analytics-export__note">
          {interpolate(copy.currencyNote, { reporting: reportingCurrency ?? '' })}
        </p>
      ) : null}
      {preparing ? (
        <p className="analytics-export__note" role="status" data-testid="export-status">
          {interpolate(copy.status, { report: reportLabel })}
        </p>
      ) : null}
      {exportCsv.isError ? (
        <Alert
          tone="error"
          title={copy.refused}
          data-testid="export-status"
          action={
            <>
              <Button
                type="button"
                tone="secondary"
                className="button--sm"
                data-testid="export-change-range"
                onClick={focusDateRange}
              >
                {copy.changeRange}
              </Button>
              <Button
                type="button"
                tone="ghost"
                className="button--sm"
                data-testid="export-retry"
                onClick={run}
              >
                {copy.tryAgain}
              </Button>
            </>
          }
        >
          {describeApiError(exportCsv.error, 'analytics')}
        </Alert>
      ) : null}
    </div>
  );
}

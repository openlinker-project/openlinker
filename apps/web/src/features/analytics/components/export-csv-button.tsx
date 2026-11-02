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
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Order date from"]');
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
  const exportCsv = useAnalyticsCsvExport();
  const preparing = exportCsv.isPending;
  const currencyDiffers =
    Boolean(displayCurrency) && Boolean(reportingCurrency) && displayCurrency !== reportingCurrency;
  const title = disabledReason
    ? disabledReason
    : currencyDiffers
      ? `The file is in ${reportingCurrency}, the reporting currency, not ${displayCurrency}.`
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
            Preparing CSV…
          </>
        ) : (
          'Export CSV'
        )}
      </Button>
      {currencyDiffers && !preparing && !exportCsv.isError ? (
        <p className="analytics-export__note">
          File is in {reportingCurrency}, the reporting currency.
        </p>
      ) : null}
      {preparing ? (
        <p className="analytics-export__note" role="status" data-testid="export-status">
          Preparing “{reportLabel}”. The download starts when it is ready; you can keep working.
        </p>
      ) : null}
      {exportCsv.isError ? (
        <Alert
          tone="error"
          title="Export refused"
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
                Change range
              </Button>
              <Button
                type="button"
                tone="ghost"
                className="button--sm"
                data-testid="export-retry"
                onClick={run}
              >
                Try again
              </Button>
            </>
          }
        >
          {exportCsv.error.message}
        </Alert>
      ) : null}
    </div>
  );
}

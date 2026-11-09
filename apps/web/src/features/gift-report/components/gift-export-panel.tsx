/**
 * Per-customer gift export (#3943, mockup state `report/export`)
 *
 * A disclosure with the one thing an accountant needs: a CSV of every gift in
 * the chosen period, by the resolved customer. It states plainly that the
 * yearly thresholds are the accountant's to judge; OpenLinker neither watches
 * nor enforces them (rule C2).
 *
 * @module features/gift-report/components
 */
import { useState, type ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { useMessages } from '../../../shared/i18n';
import { useAnalyticsCsvExport } from '../../analytics';
import type { GiftReportFilters } from '../api/gift-report.types';

interface GiftExportPanelProps {
  filters: GiftReportFilters;
}

export function GiftExportPanel({ filters }: GiftExportPanelProps): ReactElement {
  const copy = useMessages('gift-report').export;
  const [open, setOpen] = useState(false);
  const exportCsv = useAnalyticsCsvExport();

  return (
    <div className="gift-report-export">
      <Button
        type="button"
        tone="secondary"
        data-testid="gift-report-export"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {copy.button}
      </Button>
      {open ? (
        <div className="panel" data-testid="gift-report-export-panel">
          <h3 className="section-title">{copy.title}</h3>
          <p>{copy.body}</p>
          <Button
            type="button"
            data-testid="gift-report-export-download"
            disabled={exportCsv.isPending}
            aria-busy={exportCsv.isPending || undefined}
            onClick={() =>
              exportCsv.mutate({
                report: 'gifts-customer',
                filters,
                giftSource: filters.giftSource,
              })
            }
          >
            {exportCsv.isPending ? copy.preparing : copy.download}
          </Button>
          {exportCsv.isError ? (
            <p role="alert" className="text-error">
              {exportCsv.error.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

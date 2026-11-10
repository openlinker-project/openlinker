/**
 * Per-customer gift export dialog
 *
 * What an accountant needs: a CSV of every gift in the chosen period, by the
 * resolved customer. It states plainly that the yearly thresholds are the
 * accountant's to judge; OpenLinker neither watches nor enforces them.
 *
 * @module features/gift-report/components
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../../shared/ui/dialog';
import { SaveButton, type SaveButtonState } from '../../../shared/ui/save-button';
import { useAnalyticsCsvExport } from '../../analytics';
import type { GiftReportFilters } from '../api/gift-report.types';
import { useEffect, useRef, useState } from 'react';

interface GiftExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: GiftReportFilters;
}

export function GiftExportDialog({ open, onOpenChange, filters }: GiftExportDialogProps): ReactElement {
  const copy = useMessages('gift-report').export;
  const exportCsv = useAnalyticsCsvExport();
  const [state, setState] = useState<SaveButtonState>('idle');
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  function download(): void {
    setState('saving');
    exportCsv.mutate(
      { report: 'gifts-customer', filters, giftSource: filters.giftSource },
      {
        onSuccess: () => {
          setState('saved');
          timer.current = window.setTimeout(() => setState('idle'), 2600);
        },
        onError: () => setState('idle'),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gift-dlg" data-testid="gift-report-export-panel">
        <span className="eyebrow">{copy.eyebrow}</span>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{copy.body}</DialogDescription>
        <p className="gift-dlg__p">{copy.thresholds}</p>
        {exportCsv.isError ? (
          <p role="alert" className="text-error">
            {exportCsv.error.message}
          </p>
        ) : null}
        <div className="gift-dlg__f">
          <DialogClose asChild>
            <Button tone="secondary" className="button--sm">
              {copy.close}
            </Button>
          </DialogClose>
          <SaveButton
            state={state}
            labels={{ idle: copy.download, saving: copy.preparing, saved: copy.downloaded }}
            onClick={download}
            data-testid="gift-report-export-download"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Currency Coverage Dialog
 *
 * Read-only detail view for `CurrencySettingsView.stampedOrders` — how many
 * orders already carry a reporting-currency figure. Deliberately NOT shown
 * as a bare number on the settings tile: a `0` read as "0 problems" to an
 * operator, and the per-currency grouping (`GROUP BY reportingCurrency`)
 * only ever produces more than one row when the deployment has changed its
 * reporting currency before — otherwise every stamped order groups into the
 * single active reporting currency, which isn't a "breakdown" of anything.
 *
 * This is a coverage/eras readout, not a health check or an anomaly count:
 * `stampedOrders` includes same-currency stamps too (an order already in the
 * reporting currency still gets stamped), so it never means "orders in a
 * foreign currency".
 *
 * @module apps/web/src/features/currency-settings/components
 */
import type { ReactElement } from 'react';
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
import { KeyValueList, type KeyValueItem } from '../../../shared/ui/key-value-list';
import type { CurrencySettingsView } from '../api/currency-settings.types';

interface CurrencyCoverageDialogProps {
  open: boolean;
  view: CurrencySettingsView;
  onClose: () => void;
}

export function CurrencyCoverageDialog({
  open,
  view,
  onClose,
}: CurrencyCoverageDialogProps): ReactElement {
  const total = view.stampedOrders.reduce((sum, entry) => sum + entry.count, 0);
  const hasMultipleEras = view.stampedOrders.length > 1;

  const items: KeyValueItem[] = [
    {
      id: 'total',
      label: 'Orders with a reporting figure',
      value: <span className="tabular">{total}</span>,
      mono: true,
    },
    ...(hasMultipleEras
      ? view.stampedOrders.map((entry) => ({
          id: entry.reportingCurrency,
          label: `— stamped in ${entry.reportingCurrency}`,
          value: <span className="tabular">{entry.count}</span>,
          mono: true,
        }))
      : []),
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>Analytics coverage</DialogTitle>
        <DialogDescription>
          How many orders already carry a reporting-currency figure. This is a coverage readout,
          not a health check — invoices are unaffected either way.
        </DialogDescription>

        {total === 0 ? (
          <p className="muted-text">
            No orders have been stamped yet. This fills in automatically as new orders sync in{' '}
            {view.reportingCurrency}, or after the next hourly reconcile sweep runs across
            existing history.
          </p>
        ) : (
          <>
            <KeyValueList items={items} />
            {hasMultipleEras ? (
              <Alert tone="info" title="More than one reporting-currency era">
                <p>
                  This deployment has changed its reporting currency before. Older stamps are
                  never rewritten, so those orders keep the currency that was active when they
                  were stamped.
                </p>
              </Alert>
            ) : null}
          </>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" tone="ghost">
              Close
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

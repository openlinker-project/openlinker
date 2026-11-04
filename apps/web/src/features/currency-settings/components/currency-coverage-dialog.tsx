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
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
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
  const copy = useMessages('currency-settings').currencyCoverageDialog;
  const { number: formatNumber } = useFormat();
  const total = view.stampedOrders.reduce((sum, entry) => sum + entry.count, 0);
  const hasMultipleEras = view.stampedOrders.length > 1;

  const items: KeyValueItem[] = [
    {
      id: 'total',
      label: copy.totalLabel,
      value: <span className="tabular">{formatNumber(total)}</span>,
      mono: true,
    },
    ...(hasMultipleEras
      ? view.stampedOrders.map((entry) => ({
          id: entry.reportingCurrency,
          label: interpolate(copy.eraLabel, { currency: entry.reportingCurrency }),
          value: <span className="tabular">{formatNumber(entry.count)}</span>,
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
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>
          {copy.description}
        </DialogDescription>

        {total === 0 ? (
          <p className="muted-text">
            {interpolate(copy.empty, { currency: view.reportingCurrency })}
          </p>
        ) : (
          <>
            <KeyValueList items={items} />
            {hasMultipleEras ? (
              <Alert tone="info" title={copy.multipleEras.title}>
                <p>{copy.multipleEras.message}</p>
              </Alert>
            ) : null}
          </>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" tone="ghost">
              {copy.close}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

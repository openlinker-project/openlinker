/**
 * Routing dialog (#3958)
 *
 * Opens the routing editor for one order source without leaving the page the
 * operator is on: order detail, a carrier's or a shop's connection page. It
 * renders `FulfillmentRoutingSection`, the same editor as the mappings page,
 * so a route is changed in exactly one component wherever it is changed from.
 *
 * Closing with unsaved routing asks first, the same guard the mappings page
 * applies when switching tabs.
 *
 * @module apps/web/src/features/mappings/components
 */
import { useState, type ReactElement } from 'react';

import { Button } from '../../../shared/ui/button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '../../../shared/ui/dialog';
import { useShippingRouteCopy } from '../hooks/use-shipping-route-copy';
import { FulfillmentRoutingSection } from './fulfillment-routing-section';

export interface RoutingDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The order-source connection whose delivery methods are routed. */
  readonly sourceConnectionId: string;
  readonly sourceName: string;
  /** The delivery method the operator came from, named so they know which row to look at. */
  readonly methodLabel?: string;
  /** The method's code, named beside the label so a shared display name stays unambiguous. */
  readonly methodId?: string;
}

export function RoutingDialog({
  open,
  onOpenChange,
  sourceConnectionId,
  sourceName,
  methodLabel,
  methodId,
}: RoutingDialogProps): ReactElement {
  const routeCopy = useShippingRouteCopy();
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const requestOpenChange = (next: boolean): void => {
    if (!next && dirty) {
      setConfirmClose(true);
      return;
    }
    onOpenChange(next);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={requestOpenChange}>
        <DialogContent className="routing-dialog" aria-describedby="routing-dialog-desc">
          <DialogTitle>{routeCopy.dialogTitle(sourceName)}</DialogTitle>
          <DialogDescription id="routing-dialog-desc">
            {routeCopy.dialogDescription(sourceName, methodLabel ?? null, methodId ?? null)}
          </DialogDescription>
          {open ? (
            <FulfillmentRoutingSection
              sourceConnectionId={sourceConnectionId}
              onDirtyChange={setDirty}
              embedded
              focusMethodId={methodId}
            />
          ) : null}
          <DialogFooter>
            <Button tone="secondary" onClick={() => requestOpenChange(false)}>
              {routeCopy.dialogDone}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title={routeCopy.discardTitle}
        description={routeCopy.discardDescription}
        confirmLabel={routeCopy.discardConfirm}
        cancelLabel={routeCopy.discardCancel}
        tone="danger"
        onConfirm={() => {
          setConfirmClose(false);
          setDirty(false);
          onOpenChange(false);
        }}
      />
    </>
  );
}

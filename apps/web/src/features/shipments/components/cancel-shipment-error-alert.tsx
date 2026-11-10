/**
 * Cancel Shipment Error Alert
 *
 * The notice the cancel dialog shows when the cancellation failed. Shared by
 * both cancel dialogs (the order's shipment panel and the shipments row
 * detail), so the two always say the same thing.
 *
 * @module apps/web/src/features/shipments/components
 */
import type { ReactElement } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { useMessages } from '../../../shared/i18n';
import { classifyCancelShipmentError } from '../lib/cancel-shipment-error';

interface CancelShipmentErrorAlertProps {
  error: unknown;
}

export function CancelShipmentErrorAlert({ error }: CancelShipmentErrorAlertProps): ReactElement {
  const copy = useMessages('shipments').cancelError;
  const kind = classifyCancelShipmentError(error);
  const view = {
    'carrier-refused': copy.carrierRefused,
    'no-longer-active': copy.noLongerActive,
    'not-supported': copy.notSupported,
    failed: copy.failed,
  }[kind];

  return (
    <Alert tone="error" title={view.title} data-testid={`cancel-shipment-error-${kind}`}>
      {view.message}
    </Alert>
  );
}

/**
 * Order Sync Restart Dialog
 *
 * Lets an admin move where a connection's order sync starts after it was
 * created (#4228): only new orders, orders since a date, or the whole history.
 * Reuses the create-time choice so the two cannot describe the same option
 * differently. Orders already imported are never removed.
 *
 * @module features/connections/components
 */
import { useState, type ReactElement } from 'react';
import { describeApiError } from '../../../shared/api/describe-api-error';
import { useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../shared/ui/dialog';
import { useToast } from '../../../shared/ui/toast-provider';
import { useAdaptersQuery } from '../../adapters';
import type { Connection } from '../api/connections.types';
import { useRestartOrderSyncMutation } from '../hooks/use-restart-order-sync-mutation';
import {
  ORDER_SYNC_START_DEFAULT_MODES,
  ORDER_SYNC_START_DEFAULT_VALUE,
  orderSyncStartSchema,
  type OrderSyncStartValue,
} from '../lib/order-sync-start';
import { OrderSyncStartField } from './order-sync-start-field';

interface OrderSyncRestartDialogProps {
  connection: Pick<Connection, 'id' | 'platformType' | 'adapterKey'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OrderSyncRestartDialog({
  connection,
  open,
  onOpenChange,
}: OrderSyncRestartDialogProps): ReactElement {
  const copy = useMessages('connections').orderSyncPanel.restart;
  const { showToast } = useToast();
  const adapters = useAdaptersQuery();
  const restart = useRestartOrderSyncMutation();
  const [value, setValue] = useState<OrderSyncStartValue>(ORDER_SYNC_START_DEFAULT_VALUE);

  const adapter =
    adapters.data?.find((a) => a.adapterKey === connection.adapterKey) ??
    adapters.data?.find((a) => a.platformType === connection.platformType && a.isDefault);
  const supportedModes = adapter?.orderSyncStartModes ?? ORDER_SYNC_START_DEFAULT_MODES;

  const parsed = orderSyncStartSchema.safeParse(value);
  const dateError = parsed.success ? undefined : parsed.error.issues[0]?.message;
  // An untouched empty date reads as "pick one", not as an error shown up front.
  const showDateError = value.mode === 'from' && (value.from ?? '') !== '' ? dateError : undefined;

  function handleOpenChange(next: boolean): void {
    if (restart.isPending) return;
    if (!next) {
      setValue(ORDER_SYNC_START_DEFAULT_VALUE);
      restart.reset();
    }
    onOpenChange(next);
  }

  async function handleConfirm(): Promise<void> {
    if (!parsed.success) return;
    const start =
      value.mode === 'from'
        ? { mode: 'from' as const, from: value.from ?? '' }
        : { mode: value.mode };
    try {
      await restart.mutateAsync({ connectionId: connection.id, start });
      showToast({ tone: 'success', title: copy.successTitle, description: copy.successMessage });
      handleOpenChange(false);
    } catch {
      // Shown by the alert below.
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="order-sync-restart-dialog">
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>

        <div className="order-sync-restart-dialog__body">
          {restart.error ? (
            <Alert tone="error" title={copy.failedTitle}>
              {describeApiError(restart.error, 'connections')}
            </Alert>
          ) : null}
          <OrderSyncStartField
            value={value}
            onChange={setValue}
            supportedModes={supportedModes}
            error={showDateError}
            restart
          />
          {value.mode === 'now' ? <Alert tone="warning">{copy.gapNote}</Alert> : null}
          {value.mode !== 'now' ? <p className="muted-text">{copy.repeatNote}</p> : null}
        </div>

        <DialogFooter>
          <Button tone="secondary" onClick={() => handleOpenChange(false)} disabled={restart.isPending}>
            {copy.cancel}
          </Button>
          <Button
            tone="primary"
            onClick={() => void handleConfirm()}
            disabled={!parsed.success || restart.isPending}
          >
            {restart.isPending ? copy.confirming : copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

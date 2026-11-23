/**
 * Order Sync Dialog
 *
 * Two separate jobs for an admin, each opened from its own button (#4228): get
 * the orders of a period once (an ACTION, a range read oldest or newest first),
 * or change where syncing starts (a SETTING). They are kept apart because one
 * runs once and the other changes what every later check reads. Reuses the
 * create-time start choice so the two cannot describe the same option
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
import {
  ORDER_RANGE_DEFAULT_VALUE,
  OrderRangeFields,
  validateOrderRange,
  type OrderRangeValue,
} from '../../sync-jobs';
import type { Connection } from '../api/connections.types';
import { useImportOrdersMutation } from '../hooks/use-import-orders-mutation';
import { useRestartOrderSyncMutation } from '../hooks/use-restart-order-sync-mutation';
import {
  ORDER_SYNC_START_DEFAULT_MODES,
  ORDER_SYNC_START_DEFAULT_VALUE,
  orderSyncStartSchema,
  toOrderSyncStart,
  type OrderSyncStartValue,
} from '../lib/order-sync-start';
import { OrderSyncStartField } from './order-sync-start-field';

export type OrderSyncDialogKind = 'range' | 'start';

interface OrderSyncRestartDialogProps {
  /** Which job this dialog does: a one-off period read, or a change of the start. */
  kind: OrderSyncDialogKind;
  connection: Pick<Connection, 'id' | 'platformType' | 'adapterKey'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The connection already follows the shop's order feed, so "only new orders"
   * would change nothing: that choice is not offered as an action.
   */
  hasFeedPosition?: boolean;
}

export function OrderSyncRestartDialog({
  kind,
  connection,
  open,
  onOpenChange,
  hasFeedPosition = false,
}: OrderSyncRestartDialogProps): ReactElement {
  const copy = useMessages('connections').orderSyncPanel.restart;
  const copyRange = useMessages('sync-jobs').triggerSyncDialog.orderRange;
  const { showToast } = useToast();
  const adapters = useAdaptersQuery();
  const restart = useRestartOrderSyncMutation();
  const enqueue = useImportOrdersMutation();
  const [range, setRange] = useState<OrderRangeValue>(ORDER_RANGE_DEFAULT_VALUE);
  const [rangeTouched, setRangeTouched] = useState(false);
  const [value, setValue] = useState<OrderSyncStartValue>(ORDER_SYNC_START_DEFAULT_VALUE);

  const adapter =
    adapters.data?.find((a) => a.adapterKey === connection.adapterKey) ??
    adapters.data?.find((a) => a.platformType === connection.platformType && a.isDefault);
  const supportedModes = adapter?.orderSyncStartModes ?? ORDER_SYNC_START_DEFAULT_MODES;
  const windowImport = adapter?.orderWindowImport ?? false;

  const activeKind = kind;
  const pending = restart.isPending || enqueue.isPending;
  const rangeProblems = validateOrderRange(range);
  const rangeValid = !rangeProblems.from && !rangeProblems.to;
  const rangeErrors = {
    from: rangeTouched && rangeProblems.from ? copyRange.errors[rangeProblems.from] : undefined,
    to: rangeProblems.to ? copyRange.errors[rangeProblems.to] : undefined,
  };

  const parsed = orderSyncStartSchema.safeParse(value);
  const dateError = parsed.success ? undefined : parsed.error.issues[0]?.message;
  // An untouched empty date reads as "pick one", not as an error shown up front.
  const showDateError = value.mode === 'from' && (value.from ?? '') !== '' ? dateError : undefined;

  function handleOpenChange(next: boolean): void {
    if (pending) return;
    if (!next) {
      setValue(ORDER_SYNC_START_DEFAULT_VALUE);
      setRange(ORDER_RANGE_DEFAULT_VALUE);
      setRangeTouched(false);
      restart.reset();
      enqueue.reset();
    }
    onOpenChange(next);
  }

  async function handleImportRange(): Promise<void> {
    setRangeTouched(true);
    if (!rangeValid) return;
    try {
      await enqueue.mutateAsync({
        connectionId: connection.id,
        request: {
          from: range.from,
          ...(range.to !== '' ? { to: range.to } : {}),
          direction: range.direction,
        },
      });
      showToast({
        tone: 'success',
        title: copy.rangeSuccessTitle,
        description: copy.rangeSuccessMessage,
      });
      handleOpenChange(false);
    } catch {
      // Shown by the alert below.
    }
  }

  async function handleConfirm(): Promise<void> {
    if (activeKind === 'range') {
      await handleImportRange();
      return;
    }
    if (!parsed.success) return;
    const start = toOrderSyncStart(value) ?? { mode: 'now' as const };
    try {
      const result = await restart.mutateAsync({ connectionId: connection.id, start });
      if (result.applied) {
        showToast({
          tone: 'success',
          title: copy.successTitle,
          description: value.mode === 'now' ? copy.successNowMessage : copy.successMessage,
        });
      } else {
        showToast({
          tone: 'info',
          title: copy.nothingToResetTitle,
          description: copy.nothingToResetMessage,
        });
      }
      handleOpenChange(false);
    } catch {
      // Shown by the alert below.
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="order-sync-restart-dialog">
        <DialogTitle>{activeKind === 'range' ? copy.rangeTitle : copy.startTitle}</DialogTitle>
        <DialogDescription>
          {activeKind === 'range' ? copy.rangeDescription : copy.startDescription}
        </DialogDescription>

        <div className="order-sync-restart-dialog__body">
          {restart.error || enqueue.error ? (
            <Alert tone="error" title={activeKind === 'range' ? copy.rangeFailedTitle : copy.failedTitle}>
              {describeApiError(
                (activeKind === 'range' ? enqueue.error : restart.error) ?? new Error(),
                'connections',
              )}
            </Alert>
          ) : null}
          {activeKind === 'range' ? (
            <OrderRangeFields
              value={range}
              onChange={setRange}
              errors={rangeErrors}
              disabled={pending}
            />
          ) : (
            <>
              <OrderSyncStartField
                value={value}
                onChange={setValue}
                supportedModes={supportedModes}
                windowImport={windowImport}
                error={showDateError}
                restart
              />
              {value.mode === 'now' ? (
                <p className="muted-text">
                  {hasFeedPosition ? copy.alreadyFollowingNote : copy.nowNote}
                </p>
              ) : null}
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            tone="secondary"
            onClick={() => handleOpenChange(false)}
            disabled={pending}
          >
            {copy.cancel}
          </Button>
          <Button
            tone="primary"
            onClick={() => void handleConfirm()}
            disabled={
              pending ||
              (activeKind === 'start' && (!parsed.success || (hasFeedPosition && value.mode === 'now')))
            }
          >
            {pending
              ? copy.confirming
              : activeKind === 'range'
                ? copy.rangeConfirm
                : copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

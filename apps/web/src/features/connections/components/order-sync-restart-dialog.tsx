/**
 * Import Older Orders Dialog
 *
 * The one place an admin reaches for orders from before the sync (#4228): read
 * a period once (a range, oldest or newest first), or move where syncing
 * starts. Reuses the create-time start choice so the two cannot describe the
 * same option differently. Orders already imported are never removed.
 *
 * @module features/connections/components
 */
import { useRef, useState, type ReactElement } from 'react';
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

type ImportKind = 'range' | 'start';

interface OrderSyncRestartDialogProps {
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
  const [kind, setKind] = useState<ImportKind>('range');
  const kindRefs = useRef<Partial<Record<ImportKind, HTMLDivElement | null>>>({});
  const [range, setRange] = useState<OrderRangeValue>(ORDER_RANGE_DEFAULT_VALUE);
  const [rangeTouched, setRangeTouched] = useState(false);
  const [value, setValue] = useState<OrderSyncStartValue>(ORDER_SYNC_START_DEFAULT_VALUE);

  const adapter =
    adapters.data?.find((a) => a.adapterKey === connection.adapterKey) ??
    adapters.data?.find((a) => a.platformType === connection.platformType && a.isDefault);
  const supportedModes = adapter?.orderSyncStartModes ?? ORDER_SYNC_START_DEFAULT_MODES;
  const windowImport = adapter?.orderWindowImport ?? false;

  // Without a window read the adapter cannot import a period, so only the start can move.
  const activeKind: ImportKind = windowImport ? kind : 'start';
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
      setKind('range');
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
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>

        <div className="order-sync-restart-dialog__body">
          {restart.error || enqueue.error ? (
            <Alert tone="error" title={activeKind === 'range' ? copy.rangeFailedTitle : copy.failedTitle}>
              {describeApiError(
                (activeKind === 'range' ? enqueue.error : restart.error) ?? new Error(),
                'connections',
              )}
            </Alert>
          ) : null}
          {windowImport ? (
            <div className="order-sync-start__order">
              <p className="order-sync-start__order-title" id="order-import-kind">
                {copy.kind.label}
              </p>
              <div
                className="order-sync-start__order-options"
                role="radiogroup"
                aria-labelledby="order-import-kind"
              >
                {(['range', 'start'] as const).map((option) => {
                  const checked = activeKind === option;
                  return (
                    <div
                      key={option}
                      ref={(node) => {
                        kindRefs.current[option] = node;
                      }}
                      role="radio"
                      aria-describedby={`order-import-kind-${option}`}
                      aria-checked={checked}
                      tabIndex={checked ? 0 : -1}
                      className={[
                        'order-sync-start__order-option',
                        checked ? 'order-sync-start__order-option--checked' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => setKind(option)}
                      onKeyDown={(event) => {
                        if (event.key === ' ' || event.key === 'Enter') {
                          event.preventDefault();
                          setKind(option);
                        } else if (
                          event.key === 'ArrowRight' ||
                          event.key === 'ArrowLeft' ||
                          event.key === 'ArrowDown' ||
                          event.key === 'ArrowUp'
                        ) {
                          event.preventDefault();
                          const next = option === 'range' ? 'start' : 'range';
                          setKind(next);
                          kindRefs.current[next]?.focus();
                        }
                      }}
                    >
                      <span className="order-sync-start__order-label">{copy.kind[option].title}</span>
                      <span className="order-sync-start__order-text" id={`order-import-kind-${option}`}>
                        {copy.kind[option].text}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          {activeKind === 'range' ? (
            <>
              <OrderRangeFields
                value={range}
                onChange={setRange}
                errors={rangeErrors}
                disabled={pending}
              />
            </>
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

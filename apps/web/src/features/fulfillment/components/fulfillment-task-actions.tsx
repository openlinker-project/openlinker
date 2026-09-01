/**
 * Fulfilment-task action controls (#2411)
 *
 * ## One control per entry of `supportedActions`, and NOTHING else decides
 *
 * DESIGN §5.2: *"the server tells the client what is legal next, which kills
 * client-side state-machine drift across heterogeneous executors."* So this
 * component maps the array and renders. It does not read `status`, it does not
 * read `requestStatus`, it does not read a counter, and it holds no legality
 * predicate of any kind. `scripts/check-no-supported-actions-mirror.mjs` catches
 * the two obvious copies and says plainly that it cannot catch an inline
 * `if (status === 'open')` — so the rule is honoured here, not merely enforced.
 *
 * An action this build has no copy for is still rendered, with a humanised form
 * of its raw name: the server said it is legal, and hiding it would silently
 * remove a capability the moment the backend grows one.
 *
 * ## `release_hold` is rendered PER HOLD
 *
 * It needs a `holdId`, and a task may carry several holds. One button offering
 * to release "the" hold would have to pick one, which is a decision this surface
 * has no basis for.
 *
 * @module apps/web/src/features/fulfillment/components
 */
import type { ReactElement } from 'react';

import { Button } from '../../../shared/ui/button';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import type { FulfillmentTask, FulfillmentTaskHold } from '../api/fulfillment.types';
import {
  fulfillmentActionHint,
  fulfillmentActionLabel,
  fulfillmentActionTone,
} from '../lib/fulfillment-task-copy';

export interface FulfillmentTaskActionsProps {
  task: FulfillmentTask;
  /** Whether write controls render at all. */
  visible: boolean;
  /** Render disabled with a read-only tooltip (public demo). */
  readOnly: boolean;
  /** An action is in flight for this task. */
  busy: boolean;
  /** A plain action with no required field. */
  onInvoke: (action: string) => void;
  /** `hold` — opens the reason form. */
  onHold: () => void;
  /** `release_hold` — opens the form for one specific hold. */
  onReleaseHold: (hold: FulfillmentTaskHold) => void;
  /** `force_cancel` — opens the confirmation. */
  onForceCancel: () => void;
}

export function FulfillmentTaskActions({
  task,
  visible,
  readOnly,
  busy,
  onInvoke,
  onHold,
  onReleaseHold,
  onForceCancel,
}: FulfillmentTaskActionsProps): ReactElement | null {
  if (!visible || task.supportedActions.length === 0) return null;

  const control = (
    key: string,
    action: string,
    label: string,
    onClick: () => void
  ): ReactElement => (
    <ReadOnlyLock key={key} active={readOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
      <Button
        tone={fulfillmentActionTone(action)}
        className="button--sm"
        disabled={readOnly || busy}
        title={fulfillmentActionHint(action) ?? undefined}
        onClick={onClick}
      >
        {label}
      </Button>
    </ReadOnlyLock>
  );

  return (
    <div className="fulfilment-task__actions">
      {task.supportedActions.flatMap((action): ReactElement[] => {
        if (action === 'release_hold') {
          // One per hold — see the docblock. A task the server says may release
          // a hold while reporting none is a state this surface cannot act on,
          // so it renders no button rather than one that cannot be completed.
          return task.activeHolds.map((hold) =>
            control(
              `${action}:${hold.id}`,
              action,
              task.activeHolds.length > 1
                ? `${fulfillmentActionLabel(action)} (${hold.reason})`
                : fulfillmentActionLabel(action),
              () => onReleaseHold(hold)
            )
          );
        }
        if (action === 'hold') {
          return [control(action, action, fulfillmentActionLabel(action), onHold)];
        }
        if (action === 'force_cancel') {
          return [control(action, action, fulfillmentActionLabel(action), onForceCancel)];
        }
        return [
          control(action, action, fulfillmentActionLabel(action), () => {
            onInvoke(action);
          }),
        ];
      })}
    </div>
  );
}

/**
 * Assign Packing Work row controls (#3340, ADR-074)
 *
 * The controls for one task on the merged fulfilment screen: a "Move to"
 * select (the whole reassignment surface — no drag-and-drop via THIS control;
 * #3426 added the additive drag shortcut elsewhere), a self-serve checkbox,
 * and the server-declared action set.
 *
 * ## It renders `FulfillmentTaskActions`, and that reverses an earlier call
 *
 * This file used to argue that a staffing surface is not an execution one and
 * should therefore render none of those controls, citing ADR-074. Two things
 * were wrong with it. ADR-074 is about the `assignedToUserId` FIELD and says
 * nothing about screen topology — the argument lived only here. And the split
 * produced a one-way gate: this screen offered Hold and had no way to take a
 * hold off, because `release_hold` existed on exactly one other surface, the
 * worklist this screen has now absorbed.
 *
 * The rule that replaces it: a screen offers the inverse of what it offers.
 * Since the worklist is gone, that means the full `supportedActions` set —
 * whatever the server says is legal on this task right now, including an
 * action this build has no copy for.
 *
 * The select fires on change — click-only means one click plus one selection,
 * never a second "confirm" step, matching the mockup's own accessibility
 * argument that the menu IS the real interaction path.
 *
 * ## The checkbox renders ONLY on an unassigned task (#3429)
 *
 * Verified against the mockup's own `makeCard(item, isUnassigned)`: every
 * static packer-lane card in the demo markup carries a "Move to…" button
 * alone, and the self-serve checkbox is emitted only when `isUnassigned` is
 * true — i.e. only for cards built from the Unassigned lane's own pool.
 * `task.assignedToUserId === null` is exactly that condition (the pinned
 * lane's own membership test, `groupTasksByPacker`'s), so no extra "which
 * lane is this" prop is threaded in — the task already carries the answer.
 * The "Move to" select is unaffected and stays on every task in every lane,
 * matching the mockup's own button on every card.
 *
 * The action set is NOT under that gate — the mockup predates this screen
 * carrying actions at all, and gating them on the lane would reinstate the
 * one-way hold in a narrower form.
 *
 * ## The action set lives behind an overflow menu, not inline
 *
 * A live board carries the full `supportedActions` set inline — up to five
 * buttons (Schedule / Put on hold / Mark in progress / Force cancel / Move
 * to the front) beside the checkbox beside the select — and only the
 * Unassigned lane's cards carry the checkbox, so a plain packer's card was
 * shorter than an unassigned one. Two different row heights on the SAME
 * component is most of what read as a board whose rows do not line up.
 *
 * The mockup's own answer is `.lane-card__menu`: a single trigger per card,
 * a popover holding the rest. This borrows that shape for the SERVER-
 * declared action set specifically — the "Move to" select and the
 * self-serve checkbox stay inline, matching the mockup's own inline
 * `__pickable`, because those two are this screen's own staffing controls
 * and not part of what `FulfillmentTaskActions` renders.
 *
 * `FulfillmentTaskActions` itself is unchanged — same server-declared list,
 * same per-hold `release_hold` fan-out, same unrecognised-action fallback —
 * it is only relocated into the popover's content, and every one of its own
 * callbacks is wrapped to close the menu first: a menu that stays open after
 * the action it held was clicked would still cover the row underneath it.
 *
 * @module apps/web/src/features/fulfillment/components
 */
import { useState, type ChangeEvent, type ReactElement } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '../../../shared/ui/popover';
import { Select } from '../../../shared/ui/select';
import type { PackerSummary } from '../../users';
import type { FulfillmentTask, FulfillmentTaskHold } from '../api/fulfillment.types';
import { ASSIGN_PACKING_WORK_COPY } from '../lib/assign-packing-work.copy';
import { FulfillmentTaskActions } from './fulfillment-task-actions';

const UNASSIGNED_OPTION_VALUE = '';

export interface AssignPackingWorkActionsProps {
  task: FulfillmentTask;
  packers: readonly PackerSummary[];
  /** Whether the staffing controls should render at all. */
  visible: boolean;
  /** Rendered but disabled — the demo-viewer state (#1615). */
  readOnly: boolean;
  busy: boolean;
  onMoveTo: (userId: string | null) => void;
  onToggleSelfServe: (selfServeEligible: boolean) => void;
  /** An action with no dialog — the server named it, we just send it. */
  onInvoke: (action: string) => void;
  onHold: () => void;
  onReleaseHold: (hold: FulfillmentTaskHold) => void;
  onForceCancel: () => void;
}

export function AssignPackingWorkActions({
  task,
  packers,
  visible,
  readOnly,
  busy,
  onMoveTo,
  onToggleSelfServe,
  onInvoke,
  onHold,
  onReleaseHold,
  onForceCancel,
}: AssignPackingWorkActionsProps): ReactElement | null {
  // Above the early return — a hook cannot be called conditionally, and
  // `visible` can flip between renders of the SAME task row.
  const [menuOpen, setMenuOpen] = useState(false);

  if (!visible) return null;

  const disabled = busy || readOnly;
  const isUnassigned = task.assignedToUserId === null;
  // Rendered but disabled — see `ReadOnlyLock` inside `FulfillmentTaskActions`
  // — never hidden. Hiding a legal action set on demoReadOnly would say
  // "nothing is legal here" when the truth is "you may not do it".
  const hasActions = task.supportedActions.length > 0;

  const handleMoveTo = (event: ChangeEvent<HTMLSelectElement>): void => {
    const value = event.target.value;
    onMoveTo(value === UNASSIGNED_OPTION_VALUE ? null : value);
  };

  return (
    <div className="assign-packing-work-actions">
      <Select
        aria-label={ASSIGN_PACKING_WORK_COPY.row.moveToLabel}
        value={task.assignedToUserId ?? UNASSIGNED_OPTION_VALUE}
        disabled={disabled}
        onChange={handleMoveTo}
      >
        <option value={UNASSIGNED_OPTION_VALUE}>
          {ASSIGN_PACKING_WORK_COPY.row.moveToUnassigned}
        </option>
        {packers.map((packer) => (
          <option key={packer.id} value={packer.id}>
            {packer.username}
          </option>
        ))}
      </Select>

      {/* Self-serve is a property of an UNASSIGNED task — "anyone may claim
          this" means nothing once somebody has it — so this gate stays. The
          action set below is deliberately NOT gated on it: what is legal is
          the server's answer, not the lane's. */}
      {isUnassigned ? (
        <label className="assign-packing-work-actions__self-serve">
          <input
            type="checkbox"
            checked={task.selfServeEligible}
            disabled={disabled}
            onChange={(event) => {
              onToggleSelfServe(event.target.checked);
            }}
          />
          {ASSIGN_PACKING_WORK_COPY.row.selfServeLabel}
        </label>
      ) : null}

      {/* One control per entry of `task.supportedActions`, and nothing else
          decides — unchanged from before this menu existed, only relocated.
          This screen used to render a single hardcoded Hold button gated on
          `isUnassigned`, which meant it could put work on hold and could
          not take it off again — `release_hold` had no path in the product
          outside the worklist this screen replaced. */}
      {hasActions ? (
        <Popover open={menuOpen} onOpenChange={setMenuOpen} dismissOnViewportChange>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="assign-packing-work-card__menu-trigger"
              aria-label={ASSIGN_PACKING_WORK_COPY.row.moreActionsLabel}
            >
              ⋮
            </button>
          </PopoverTrigger>
          <PopoverContent className="assign-packing-work-card__menu" align="end">
            <FulfillmentTaskActions
              task={task}
              visible={visible}
              readOnly={readOnly}
              busy={busy}
              onInvoke={(action) => {
                setMenuOpen(false);
                onInvoke(action);
              }}
              onHold={() => {
                setMenuOpen(false);
                onHold();
              }}
              onReleaseHold={(hold) => {
                setMenuOpen(false);
                onReleaseHold(hold);
              }}
              onForceCancel={() => {
                setMenuOpen(false);
                onForceCancel();
              }}
            />
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}

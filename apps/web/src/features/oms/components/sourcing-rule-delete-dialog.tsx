/**
 * Delete / retire a sourcing rule (#3059)
 *
 * Two different acts behind one confirmation, because an operator reaching for
 * "remove this rule" usually wants the reversible one and does not know it
 * exists.
 *
 * - **Retire** is `PATCH { effectiveTo: <now> }`. The row survives with its
 *   history, stops being evaluated, and can coexist with its replacement —
 *   which is precisely what the duplicate-detection index is PARTIAL for.
 * - **Delete** is a HARD delete, including history, and is offered in the
 *   danger tone.
 *
 * ## It is NOT a `ConfirmDialog`
 *
 * That primitive takes one confirm and one cancel. A third, differently-toned
 * action is the whole point here, and bolting it onto the shared component
 * would widen a primitive every other confirm in the app uses for one caller.
 *
 * ## Retire is HIDDEN, with a reason, when it cannot work
 *
 * An already-retired rule has nothing to retire, and a rule this build does not
 * recognise cannot be patched at all — the API refuses the PATCH, because a
 * successful edit would imply it routes. Offering a button that answers 400 is
 * worse than saying why it is absent.
 *
 * ## Deleting the rule that currently limits splitting is called out
 *
 * That is the one deletion whose consequence is invisible from the row: the
 * ruleset's ceiling moves, and orders may start splitting more than they do
 * today. The warning is derived from #3057's ceiling over the ruleset WITHOUT
 * this rule, so it states the answer rather than this rule's own value.
 *
 * @module apps/web/src/features/oms/components
 */
import { useEffect, useState, type ReactElement } from 'react';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../shared/ui/dialog';
import type { SourcingRule } from '../api/sourcing-rules.types';
import { useDeleteSourcingRuleMutation } from '../hooks/use-delete-sourcing-rule-mutation';
import { useUpdateSourcingRuleMutation } from '../hooks/use-update-sourcing-rule-mutation';
import { resolveSplitCeiling } from '../lib/sourcing-rule-ceiling';
import { describeSourcingRuleError } from '../lib/sourcing-rule-conflict';
import { resolveSourcingRuleStatus } from '../lib/sourcing-rule-status';
import { sourcingAfterActionLabel, sourcingRuleNameLabel } from '../lib/sourcing-rule.copy';
import { AFTER_ACTION_PERMISSIVENESS } from '../lib/sourcing-rule-vocabulary';

export interface SourcingRuleDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  /** The rule being removed. `undefined` renders nothing. */
  rule?: SourcingRule;
  /** Every rule on screen — for the splitting-limit warning. */
  rules: readonly SourcingRule[];
  onDone?: () => void;
  now?: Date;
}

/** Why "Retire instead" is not on offer, or `null` when it is. */
function retireUnavailableReason(rule: SourcingRule, now: Date): string | null {
  if (!rule.recognised) {
    return 'This rule cannot be retired because this version of OpenLinker no longer recognises it — it is already being ignored. Deleting is the only way to remove it.';
  }
  if (resolveSourcingRuleStatus(rule, now).status === 'retired') {
    return 'This rule is already retired, so it is not being evaluated. Deleting removes it and its history for good.';
  }
  return null;
}

export function SourcingRuleDeleteDialog({
  open,
  onOpenChange,
  connectionId,
  rule,
  rules,
  onDone,
  now = new Date(),
}: SourcingRuleDeleteDialogProps): ReactElement | null {
  const deleteMutation = useDeleteSourcingRuleMutation();
  const retireMutation = useUpdateSourcingRuleMutation();
  const [action, setAction] = useState<'delete' | 'retire' | null>(null);

  useEffect(() => {
    if (open) {
      setAction(null);
      deleteMutation.reset();
      retireMutation.reset();
    }
    // Re-seeded on open and on a change of target only; including the mutations
    // would reset their own in-flight state on every render.
  }, [open, rule?.id]);

  if (rule === undefined) return null;

  const label = sourcingRuleNameLabel(rule.name);
  const withoutRule = rules.filter((candidate) => candidate.id !== rule.id);
  const ceilingBefore = resolveSplitCeiling(rules, now).ceiling;
  const ceilingAfter = resolveSplitCeiling(withoutRule, now).ceiling;
  const removalLoosens =
    AFTER_ACTION_PERMISSIVENESS[ceilingAfter] > AFTER_ACTION_PERMISSIVENESS[ceilingBefore];

  const retireBlockedReason = retireUnavailableReason(rule, now);
  const error = deleteMutation.error ?? retireMutation.error;
  const isPending = deleteMutation.isPending || retireMutation.isPending;

  async function run(next: 'delete' | 'retire'): Promise<void> {
    if (rule === undefined) return;
    setAction(next);
    try {
      if (next === 'delete') {
        await deleteMutation.mutateAsync({ connectionId, ruleId: rule.id });
      } else {
        await retireMutation.mutateAsync({
          connectionId,
          ruleId: rule.id,
          // The instant the operator asked, not a back-dated one: a retirement
          // is a claim about when the rule stopped applying, and back-dating it
          // would assert something that did not happen. A clock running behind
          // the server's can leave the rule live for those few seconds, which
          // is the honest cost of not lying about the time.
          effectiveTo: new Date().toISOString(),
        });
      }
      onDone?.();
      onOpenChange(false);
    } catch {
      // Surfaced from the mutation error below.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="sourcing-rule-delete-description">
        <DialogTitle>Delete &ldquo;{label}&rdquo;?</DialogTitle>
        <DialogDescription id="sourcing-rule-delete-description">
          Every rule below it moves up one step.
        </DialogDescription>

        <div className="dialog__body">
          {error ? (
            <Alert tone="error">
              {describeSourcingRuleError(
                error,
                action === 'retire' ? 'The rule could not be retired.' : 'The rule could not be deleted.'
              )}
            </Alert>
          ) : null}

          {removalLoosens ? (
            <Alert tone="warning">
              Deleting this removes your only limit on splitting: orders could start splitting more
              than they do today (up to {sourcingAfterActionLabel(ceilingAfter)}). No other active
              rule currently prevents that.
            </Alert>
          ) : null}

          <p className="muted-text">
            This deletes the rule for good, including its history.
            {retireBlockedReason === null
              ? ' If you just want to stop using it, retire it instead — it stays on the list, keeps its history, and can coexist with a replacement.'
              : ''}
          </p>

          {retireBlockedReason === null ? null : (
            <p className="muted-text">{retireBlockedReason}</p>
          )}
        </div>

        <DialogFooter className="dialog__footer--split">
          {retireBlockedReason === null ? (
            <Button tone="secondary" disabled={isPending} onClick={() => void run('retire')}>
              {retireMutation.isPending ? 'Retiring…' : 'Retire instead'}
            </Button>
          ) : (
            <span />
          )}
          <span className="dialog__footer-group">
            <Button tone="secondary" disabled={isPending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button tone="danger" disabled={isPending} onClick={() => void run('delete')}>
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

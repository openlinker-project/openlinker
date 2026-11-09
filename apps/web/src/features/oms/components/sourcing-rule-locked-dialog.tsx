/**
 * "Cannot edit this rule" explanation (#3061)
 *
 * What an operator gets for clicking Edit on a rule this build cannot evaluate.
 * The API refuses the PATCH — a successful edit would imply the rule routes —
 * so the only honest outcome is an explanation plus the one remedy there is.
 *
 * ## Why this exists at all, rather than a disabled button
 *
 * A `disabled` control cannot be focused in every browser and its `title` is
 * not reliably announced, so the explanation would be unreachable for exactly
 * the operator who needs it, and the remedy would go unsaid. #3057's table
 * therefore keeps the control enabled and routes here.
 *
 * ## It states what is TRUE of the row, not a guess at why
 *
 * OpenLinker knows the rule is unevaluable — it does not know whether the name
 * was removed, renamed, or written by a newer build. Saying "it is saved and
 * being ignored" is the whole of what can be claimed.
 *
 * @module apps/web/src/features/oms/components
 */
import type { ReactElement } from 'react';

import { interpolate, useMessages } from '../../../shared/i18n';
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
import { sourcingRuleNameLabel } from '../lib/sourcing-rule-labels';

export interface SourcingRuleLockedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule?: SourcingRule;
  /** Hands the operator straight to the delete/retire confirm (#3059). */
  onDelete?: (rule: SourcingRule) => void;
}

export function SourcingRuleLockedDialog({
  open,
  onOpenChange,
  rule,
  onDelete,
}: SourcingRuleLockedDialogProps): ReactElement | null {
  const copy = useMessages('oms-core').sourcingRuleLockedDialog;
  if (rule === undefined) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="sourcing-rule-locked-description">
        <DialogTitle>
          {interpolate(copy.title, { label: sourcingRuleNameLabel(rule.name) })}
        </DialogTitle>
        <DialogDescription id="sourcing-rule-locked-description">
          {copy.description}
        </DialogDescription>

        <div className="dialog__body">
          <Alert tone="warning">{copy.notUsed}</Alert>
          <p className="muted-text">{copy.remedy}</p>
          <p className="mono-text">
            {rule.kind} · {rule.name}
          </p>
        </div>

        <DialogFooter>
          <Button tone="secondary" onClick={() => onOpenChange(false)}>
            {copy.close}
          </Button>
          {onDelete === undefined ? null : (
            <Button
              tone="danger"
              onClick={() => {
                onOpenChange(false);
                onDelete(rule);
              }}
            >
              {copy.deleteRule}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

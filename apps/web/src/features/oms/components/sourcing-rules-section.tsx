/**
 * Sourcing-rules section (#3061)
 *
 * The read's four states and the three dialogs, composed once. The page
 * (#3060) mounts this inside its own shell and owns only the page-level gates
 * — which connection this is, and whether any location exists — so that the
 * question "what does this read look like while it is loading, failing, or
 * empty" has exactly one answer.
 *
 * ## Every state is distinguished, and none of them asserts the other's fact
 *
 * Loading, a FAILED read, and a confirmed-empty ruleset are three different
 * claims. Rendering the empty state while a read is in flight or after one
 * failed would tell an operator that nothing decides where their orders ship
 * from — a statement about their configuration, made from a network problem.
 *
 * ## The reorder is optimistic in APPEARANCE only
 *
 * An arrow click sends the whole live id list and waits; nothing is reordered
 * locally first. `PUT /order` is exhaustive and can be refused (409), and a row
 * that moved in the browser and then moved back is a worse answer than a row
 * that moves once, when the server agrees. `busy` disables every control while
 * the write is in flight so a second click cannot build a list from a set the
 * server is already changing.
 *
 * ## The reorder refusal is dismissed by hand
 *
 * A 409 invalidates the list, so clearing the banner on the next settled read
 * would take the sentence away roughly as fast as the refreshed list arrives:
 * the operator sees a row snap back to where it was with no surviving
 * explanation. The banner therefore stays until it is dismissed, or until the
 * next reorder replaces it.
 *
 * ## Retry needs no in-flight guard of its own
 *
 * In TanStack Query v5 a `refetch()` of an errored query resets `status` to
 * `pending` and clears `error` for the duration, so the branch order below
 * swaps the whole error card for the loading one the moment Retry is pressed —
 * the button is gone rather than sitting inert, and the change is announced.
 * That is a property of the ORDER of these branches, not a coincidence, which
 * is why the section test pins it: read `error` first and the same click would
 * leave a dead-looking button under an unchanged card.
 *
 * @module apps/web/src/features/oms/components
 */
import { useState, type ReactElement } from 'react';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import type { SourcingRule } from '../api/sourcing-rules.types';
import { useReorderSourcingRulesMutation } from '../hooks/use-reorder-sourcing-rules-mutation';
import { useSourcingRulesQuery } from '../hooks/use-sourcing-rules-query';
import { describeSourcingRuleError, readSourcingRuleConflict } from '../lib/sourcing-rule-conflict';
import { SOURCING_RULES_STATE_COPY as COPY } from '../lib/sourcing-rule.copy';
import { SourcingRuleDeleteDialog } from './sourcing-rule-delete-dialog';
import { SourcingRuleDialog, type SourcingRuleLocationOption } from './sourcing-rule-dialog';
import { SourcingRuleLockedDialog } from './sourcing-rule-locked-dialog';
import { SourcingRulesTable } from './sourcing-rules-table';

export interface SourcingRulesSectionProps {
  connectionId: string;
  /** Locations the priority list may rank; the page reads them (#3060). */
  locations: readonly SourcingRuleLocationOption[];
  /** Include rules retired before now. Off by default, like the API. */
  includeSuperseded?: boolean;
  /** Injected so a window boundary is pinnable in a test. */
  now?: Date;
}

type OpenDialog =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'edit'; rule: SourcingRule }
  | { kind: 'locked'; rule: SourcingRule }
  | { kind: 'delete'; rule: SourcingRule };

export function SourcingRulesSection({
  connectionId,
  locations,
  includeSuperseded = false,
  now = new Date(),
}: SourcingRulesSectionProps): ReactElement {
  const rulesQuery = useSourcingRulesQuery(connectionId, { includeSuperseded });
  const reorderMutation = useReorderSourcingRulesMutation();
  const [dialog, setDialog] = useState<OpenDialog>({ kind: 'none' });

  const addButton = (
    <Button onClick={() => setDialog({ kind: 'create' })}>{COPY.addRule}</Button>
  );

  if (rulesQuery.isLoading) {
    return <LoadingState title={COPY.loadingTitle} message={COPY.loadingMessage} />;
  }

  if (rulesQuery.error) {
    return (
      <ErrorState
        title={COPY.errorTitle}
        message={COPY.errorMessage}
        action={
          <Button tone="secondary" onClick={() => void rulesQuery.refetch()}>
            {COPY.errorRetry}
          </Button>
        }
      />
    );
  }

  const rules = rulesQuery.data ?? [];

  // The reorder's own refusal, separate from the read's. A 409 here means the
  // server's live set is not the one this surface rendered; the mutation has
  // already invalidated, so the list refreshes itself and the operator is told
  // rather than left wondering why a row snapped back.
  const reorderConflict =
    reorderMutation.error === null ? null : readSourcingRuleConflict(reorderMutation.error);

  return (
    <>
      {reorderMutation.error ? (
        <Alert
          tone="error"
          action={
            <Button tone="secondary" onClick={() => reorderMutation.reset()}>
              {COPY.dismissReorderError}
            </Button>
          }
        >
          {reorderConflict === null
            ? describeSourcingRuleError(reorderMutation.error, 'The new order could not be saved.')
            : `Could not save the new order. ${reorderConflict.message} The list has been refreshed.`}
        </Alert>
      ) : null}

      {rules.length === 0 ? (
        <EmptyState
          eyebrow={COPY.emptyEyebrow}
          title={COPY.emptyTitle}
          message={COPY.emptyMessage}
          action={addButton}
        />
      ) : (
        <>
          <div className="toolbar__group">{addButton}</div>
          <SourcingRulesTable
            rules={rules}
            now={now}
            busy={reorderMutation.isPending}
            onReorder={(ruleIds) => reorderMutation.mutate({ connectionId, ruleIds })}
            onEdit={(rule) => setDialog({ kind: 'edit', rule })}
            onEditRefused={(rule) => setDialog({ kind: 'locked', rule })}
            onDelete={(rule) => setDialog({ kind: 'delete', rule })}
          />
        </>
      )}

      <SourcingRuleDialog
        open={dialog.kind === 'create' || dialog.kind === 'edit'}
        onOpenChange={(open) => {
          if (!open) setDialog({ kind: 'none' });
        }}
        connectionId={connectionId}
        rules={rules}
        rule={dialog.kind === 'edit' ? dialog.rule : undefined}
        locations={locations}
        now={now}
      />

      <SourcingRuleLockedDialog
        open={dialog.kind === 'locked'}
        onOpenChange={(open) => {
          if (!open) setDialog({ kind: 'none' });
        }}
        rule={dialog.kind === 'locked' ? dialog.rule : undefined}
        onDelete={(rule) => setDialog({ kind: 'delete', rule })}
      />

      <SourcingRuleDeleteDialog
        open={dialog.kind === 'delete'}
        onOpenChange={(open) => {
          if (!open) setDialog({ kind: 'none' });
        }}
        connectionId={connectionId}
        rule={dialog.kind === 'delete' ? dialog.rule : undefined}
        rules={rules}
        now={now}
      />
    </>
  );
}

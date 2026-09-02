/**
 * Return Decline Action
 *
 * The one write OpenLinker performs against a return: ask the source to decline
 * the refund.
 *
 * Five rules shape it, and each exists because its opposite tells the operator
 * something false.
 *
 * **The button is always visible.** When it cannot be used it is disabled and
 * carries the reason (returns spec §5.5) — a missing button is indistinguishable
 * from a bug, and an operator who cannot see the action assumes the feature is
 * broken rather than that this return is not eligible. The one case where it is
 * genuinely hidden is a session without write access, which is the house
 * `useWriteAccess` policy (hidden for a plain unauthorized session, disabled
 * with a lock for a demo viewer) — a different axis from the record's own state,
 * and not this component's to reinvent.
 *
 * **Availability is CONSUMED, never re-derived.** `declineAvailability` is
 * resolved server-side from adapter metadata; deriving it here would fail in the
 * wrong direction, offering an action the source cannot perform. The orphan case
 * is deliberately absent from `reason` (it is `bucket`, and a second spelling
 * would be a second definition of orphan), so this component composes the two.
 *
 * **`supported: true` is a declaration, not a promise.** The connection can
 * still fail to resolve at call time, so the 400 error path is live even when
 * the button is enabled.
 *
 * **A 2xx alone never displays as declined.** The outcome panel distinguishes
 * `declined` from `decline-sent`, which is the whole point of the write's
 * result shape (returns spec §5.6 / US-3).
 *
 * **The request cannot be sent twice by accident.** The submit is guarded by
 * `isPending` and the dialog's own disabled confirm. The real guarantee is the
 * backend's ADR-044 proposal row — a second call resolves `in-flight` — but an
 * operator must not be left wondering whether they sent two.
 *
 * @module apps/web/src/features/returns/components
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../shared/ui/dialog';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Textarea } from '../../../shared/ui/textarea';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useDeclineReturnMutation } from '../hooks/use-decline-return-mutation';
import { describeDeclineError } from '../lib/decline-error';
import {
  RETURN_DECLINE_COPY,
  RETURN_DECLINE_OUTCOME_COPY,
} from '../lib/return-detail.copy';
import type { DeclineReturnResult, ReturnDetail } from '../api/returns.types';

/** Mirrors the request DTO's `@MaxLength(500)` so a long comment is caught here. */
const COMMENT_MAX_LENGTH = 500;

interface ReturnDeclineActionProps {
  detail: ReturnDetail;
  /**
   * The session's write posture for this action, resolved by the page via
   * `useWriteAccess('orders:write', demoMode)` — the permission `admin` and
   * `operator` hold, matching the endpoint's own `@Roles('admin', 'operator')`.
   * No `returns:*` permission is introduced (returns spec §9).
   */
  writeAccess: { canWrite: boolean; demoReadOnly: boolean; visible: boolean };
}

/**
 * Why the action cannot be taken, in the order the operator would ask.
 *
 * Returns `null` when it can. Ordering matters: an orphan is blocked whatever
 * the source supports, and an already-declined return has nothing left to ask,
 * so naming the source's capability first would answer a question the operator
 * did not have.
 */
function resolveBlockedReason(detail: ReturnDetail): string | null {
  if (detail.bucket === 'orphan') {
    return RETURN_DECLINE_COPY.blockedOrphan;
  }
  if (detail.declinedAt !== null) {
    return RETURN_DECLINE_COPY.blockedAlreadyDeclined;
  }
  if (detail.declineAvailability.supported) {
    return null;
  }
  if (detail.declineAvailability.reason === 'no-source-return-id') {
    return RETURN_DECLINE_COPY.blockedNoSourceReturnId;
  }
  if (detail.declineAvailability.reason === 'source-declares-no-decline') {
    return RETURN_DECLINE_COPY.blockedSourceDeclaresNoDecline;
  }
  // A reason this build does not recognise, or none reported at all. It must not
  // read as "this channel has no decline" — that is a claim about the channel
  // that OpenLinker cannot make from a value it could not interpret.
  return RETURN_DECLINE_COPY.blockedUnknownReason;
}

/** The outcome copy for a result, falling back for a value this build predates. */
function resolveOutcomeCopy(
  result: DeclineReturnResult,
): { title: string; body: string } {
  const known = (
    RETURN_DECLINE_OUTCOME_COPY as Record<string, { title: string; body: string } | undefined>
  )[result.outcome];
  return known ?? RETURN_DECLINE_OUTCOME_COPY.unknown;
}

export function ReturnDeclineAction({
  detail,
  writeAccess,
}: ReturnDeclineActionProps): ReactElement | null {
  const [isOpen, setIsOpen] = useState(false);
  const [reasonCode, setReasonCode] = useState('');
  const [comment, setComment] = useState('');
  const [reasonCodeError, setReasonCodeError] = useState<string | undefined>(undefined);
  const [commentError, setCommentError] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<DeclineReturnResult | null>(null);

  const mutation = useDeclineReturnMutation(detail.id);

  if (!writeAccess.visible) {
    return null;
  }

  const blockedReason = resolveBlockedReason(detail);
  const isBlocked = blockedReason !== null;
  const isDisabled = isBlocked || writeAccess.demoReadOnly || mutation.isPending;

  function openDialog(): void {
    setResult(null);
    setReasonCodeError(undefined);
    setCommentError(undefined);
    setIsOpen(true);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    // Belt to the disabled confirm button's braces: a form can also be submitted
    // with Enter, and the in-flight request must not be duplicated from there.
    if (mutation.isPending) return;

    const trimmedCode = reasonCode.trim();
    const nextReasonCodeError =
      trimmedCode === '' ? RETURN_DECLINE_COPY.reasonCodeRequired : undefined;
    const nextCommentError =
      comment.length > COMMENT_MAX_LENGTH ? RETURN_DECLINE_COPY.commentTooLong : undefined;

    setReasonCodeError(nextReasonCodeError);
    setCommentError(nextCommentError);
    if (nextReasonCodeError !== undefined || nextCommentError !== undefined) return;

    mutation.mutate(
      { reasonCode: trimmedCode, comment: comment.trim() },
      {
        onSuccess: (declineResult) => {
          setResult(declineResult);
          setIsOpen(false);
        },
        // The dialog deliberately STAYS OPEN on failure: the reason code the
        // operator typed is the thing the channel most often rejects, and its
        // refusal names the codes it accepts — closing would discard both.
      },
    );
  }

  const outcomeCopy = result === null ? null : resolveOutcomeCopy(result);

  return (
    <section className="returns-decline">
      <h2 className="section-title">{RETURN_DECLINE_COPY.sectionTitle}</h2>

      {/* Independent parts, never one ternary (#2100): the reason renders
          beside the button rather than replacing it, so a disabled action
          always carries its explanation. */}
      {blockedReason !== null ? <p className="text-muted">{blockedReason}</p> : null}

      <ReadOnlyLock active={writeAccess.demoReadOnly} message={RETURN_DECLINE_COPY.readOnly}>
        <Button tone="danger" disabled={isDisabled} onClick={openDialog}>
          {RETURN_DECLINE_COPY.action}
        </Button>
      </ReadOnlyLock>

      {outcomeCopy !== null && result !== null ? (
        <Alert
          tone={result.outcome === 'refused' ? 'warning' : 'info'}
          title={outcomeCopy.title}
        >
          <p>{outcomeCopy.body}</p>
          {result.refusalReason !== null ? (
            // The channel's own words, verbatim — OpenLinker adds nothing.
            <p className="mono-text">{result.refusalReason}</p>
          ) : null}
        </Alert>
      ) : null}

      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          // A close request while the request is in flight is ignored rather
          // than obeyed: the dialog is where the outcome will be explained.
          if (!mutation.isPending) setIsOpen(open);
        }}
      >
        <DialogContent>
          <DialogTitle>{RETURN_DECLINE_COPY.confirmTitle}</DialogTitle>
          <DialogDescription>{RETURN_DECLINE_COPY.confirmBody}</DialogDescription>

          <form onSubmit={handleSubmit}>
            <FormField
              name="reasonCode"
              label={RETURN_DECLINE_COPY.reasonCodeLabel}
              description={RETURN_DECLINE_COPY.reasonCodeDescription}
              error={reasonCodeError}
            >
              <Input
                value={reasonCode}
                onChange={(event) => {
                  setReasonCode(event.target.value);
                }}
              />
            </FormField>

            <FormField
              name="comment"
              label={RETURN_DECLINE_COPY.commentLabel}
              description={RETURN_DECLINE_COPY.commentDescription}
              error={commentError}
            >
              <Textarea
                value={comment}
                rows={3}
                onChange={(event) => {
                  setComment(event.target.value);
                }}
              />
            </FormField>

            {mutation.isError ? (
              <Alert tone="error">{describeDeclineError(mutation.error)}</Alert>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                tone="secondary"
                disabled={mutation.isPending}
                onClick={() => {
                  setIsOpen(false);
                }}
              >
                {RETURN_DECLINE_COPY.cancel}
              </Button>
              <Button type="submit" tone="danger" disabled={mutation.isPending}>
                {mutation.isPending
                  ? RETURN_DECLINE_COPY.submitting
                  : RETURN_DECLINE_COPY.confirmAction}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

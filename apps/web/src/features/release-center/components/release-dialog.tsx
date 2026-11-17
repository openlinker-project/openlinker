/**
 * Release dialog (#4147, ADR-085)
 *
 * Two steps on the Radix `Dialog` (focus trap, focus restore and Esc come from
 * it): the highlighted changelog entries, then the setup steps of this update.
 * Presentational: the host decides when it opens and what closing writes.
 * "Don't show again" exists only on the changelog step, and an operator or
 * viewer sees "Needs an administrator" with no write control.
 *
 * @module features/release-center/components
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { ChangelogEntry } from '../../../build-time/changelog-parser';
import { useMessages, usePlural, interpolate } from '../../../shared/i18n';
import { useFormat } from '../../../shared/i18n/use-format';
import { Button } from '../../../shared/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../shared/ui/dialog';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type { ReleaseStepRow } from '../lib/release-dialog-content';
import { useStepCopy } from './release-step-copy';

export interface ReleaseDialogProps {
  open: boolean;
  version: string;
  /** ISO date of the release, when the changelog carries one. */
  date: string | null;
  highlights: readonly ChangelogEntry[];
  overflow: number;
  rows: readonly ReleaseStepRow[];
  /** Admin: may complete installation steps. Everyone else is only shown where. */
  canWriteSteps: boolean;
  /** Closing without leaving: writes the cursor (and `skipDialog` when ticked). */
  onClose: (skipDialog: boolean) => void;
  onFullChangelog: (skipDialog: boolean) => void;
  onStartGuide: (rows: readonly ReleaseStepRow[], skipDialog: boolean) => void;
}

export function ReleaseDialog({
  open,
  version,
  date,
  highlights,
  overflow,
  rows,
  canWriteSteps,
  onClose,
  onFullChangelog,
  onStartGuide,
}: ReleaseDialogProps): ReactElement {
  const copy = useMessages('release-center').dialog;
  const stepCopy = useStepCopy();
  const plural = usePlural();
  const format = useFormat();
  const [step, setStep] = useState<0 | 1>(0);
  const [skip, setSkip] = useState(false);
  // The Radix Dialog restores focus to its Trigger only; this dialog has none
  // (the host opens it), so the element focused before it opened is kept here.
  const returnFocusTo = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open && document.activeElement instanceof HTMLElement) {
      returnFocusTo.current = document.activeElement;
    }
  }, [open]);
  const openRows = rows.filter((row) => !row.done);
  const hasGuide = openRows.length > 0;
  const total = hasGuide ? 2 : 1;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose(skip)}>
      <DialogContent
        className="release-dialog"
        aria-describedby="release-dialog-desc"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusTo.current?.focus();
        }}
      >
        <div className="release-dialog__head">
          <div className="release-dialog__steps">
            {hasGuide ? (
              <>
                <span>{interpolate(copy.stepIndicator, { current: step + 1, total })}</span>
                <span className="release-dialog__dots" aria-hidden="true">
                  <i data-on={step === 0} />
                  <i data-on={step === 1} />
                </span>
              </>
            ) : null}
          </div>
          <DialogClose asChild>
            <Button tone="ghost" aria-label={copy.closeIcon}>
              <span aria-hidden="true">×</span>
            </Button>
          </DialogClose>
        </div>

        <div className="release-dialog__body">
          {step === 0 ? (
            <div className="release-dialog__pane" key="changelog">
              <div className="release-dialog__hero">
                <StatusBadge tone="success">{copy.newVersion}</StatusBadge>
                <span className="release-dialog__version mono-text">{`v${version}`}</span>
                {date ? <span className="release-dialog__date">{format.date(date)}</span> : null}
              </div>
              <DialogTitle className="release-dialog__title">
                {interpolate(copy.title, { version })}
              </DialogTitle>
              <DialogDescription id="release-dialog-desc" className="release-dialog__sr">
                {copy.highlightsLabel}
              </DialogDescription>
              <ul className="release-dialog__changes" lang="en">
                {highlights.map((entry) => (
                  <li key={`${entry.scope ?? ''}:${entry.text}`}>
                    {entry.scope ? <b className="mono-text">{entry.scope}: </b> : null}
                    {entry.text}
                  </li>
                ))}
              </ul>
              {overflow > 0 ? (
                <p className="release-dialog__more">
                  {plural(overflow, copy.moreChanges, { n: overflow })}
                </p>
              ) : null}
              <label className="release-dialog__skip">
                <input
                  type="checkbox"
                  checked={skip}
                  onChange={(event) => setSkip(event.target.checked)}
                />
                <span>{copy.skipDialog}</span>
              </label>
            </div>
          ) : (
            <div className="release-dialog__pane" key="guide">
              <DialogTitle className="release-dialog__title">{copy.guideTitle}</DialogTitle>
              <DialogDescription id="release-dialog-desc" className="release-dialog__lead">
                {canWriteSteps ? copy.guideLeadAdmin : copy.guideLeadReadOnly}
              </DialogDescription>
              <ul className="release-dialog__steplist">
                {openRows.map((row) => {
                  const text = stepCopy(row.step.id);
                  const required = row.importance === 'required';
                  return (
                    <li
                      key={row.key}
                      className={`release-dialog__step release-dialog__step--${row.importance}`}
                    >
                      <span className="release-dialog__step-title">
                        {text.title}
                        {row.connection ? (
                          <span className="release-dialog__step-conn"> · {row.connection.name}</span>
                        ) : null}
                      </span>
                      {canWriteSteps ? (
                        <span className="release-dialog__chip">
                          {required ? copy.required : copy.optional}
                        </span>
                      ) : (
                        <span className="release-dialog__chip">{copy.needsAdmin}</span>
                      )}
                      <span className="release-dialog__step-why">{text.why}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter className="release-dialog__foot">
          {step === 0 ? (
            <>
              <Button tone="ghost" onClick={() => onFullChangelog(skip)}>
                {copy.fullChangelog}
              </Button>
              <div className="release-dialog__foot-right">
                <Button tone="secondary" onClick={() => onClose(skip)}>
                  {copy.close}
                </Button>
                {hasGuide ? (
                  <Button onClick={() => setStep(1)}>{copy.toGuide}</Button>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <Button tone="ghost" aria-label={copy.back} onClick={() => setStep(0)}>
                <span aria-hidden="true">←</span>
              </Button>
              <div className="release-dialog__foot-right">
                <Button tone="secondary" onClick={() => onClose(false)}>
                  {copy.later}
                </Button>
                <Button onClick={() => onStartGuide(openRows, false)}>
                  {canWriteSteps ? copy.startGuide : copy.showWhere}
                </Button>
              </div>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import type { ChangelogEntry } from '../../../build-time/changelog-parser';
import { useMessages, usePlural, interpolate } from '../../../shared/i18n';
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
import { ReleaseIcon } from './release-icon';
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
  const [step, setStep] = useState<0 | 1>(0);
  const [direction, setDirection] = useState<'fwd' | 'back'>('fwd');
  const reduceMotion = useReducedMotion();
  // The card follows the visible pane's height the way the sign-in card follows
  // its active view (auth-card.tsx): the same measured height and the same
  // spring, so moving between the steps resizes the dialog instead of snapping.
  // A state, not a ref object: the pane only mounts once the Radix portal has,
  // and the effect has to run again when it does and on every step change.
  const [pane, setPane] = useState<HTMLDivElement | null>(null);
  const [paneHeight, setPaneHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!pane) return undefined;
    setPaneHeight(pane.offsetHeight);
    if (typeof ResizeObserver === 'undefined') return undefined;
    // The observer reports the layout height with its fraction (offsetHeight
    // rounds), and unlike getBoundingClientRect it ignores the entrance scale.
    const observer = new ResizeObserver((entries) => {
      const size = entries[0]?.borderBoxSize?.[0]?.blockSize;
      setPaneHeight(size ?? pane.offsetHeight);
    });
    observer.observe(pane);
    return () => observer.disconnect();
  }, [pane]);
  const goTo = (next: 0 | 1): void => {
    setDirection(next > step ? 'fwd' : 'back');
    setStep(next);
  };
  const [skip, setSkip] = useState(false);
  // The Radix Dialog restores focus to its Trigger only; this dialog has none
  // (the host opens it), so the element focused before it opened is kept here.
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
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
        overlayClassName="release-dialog__overlay"
        aria-describedby="release-dialog-desc"
        onOpenAutoFocus={(event) => {
          // The primary action, not the close icon, is where a keyboard user starts.
          if (primaryRef.current) {
            event.preventDefault();
            primaryRef.current.focus();
          }
        }}
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
            <Button
              tone="ghost"
              className="button--icon button--sm"
              aria-label={copy.closeIcon}
            >
              <ReleaseIcon name="close" />
            </Button>
          </DialogClose>
        </div>

        <motion.div
          className="release-dialog__body"
          initial={false}
          animate={{ height: paneHeight ?? 'auto' }}
          transition={
            reduceMotion ? { duration: 0 } : { type: 'spring', bounce: 0, visualDuration: 0.4 }
          }
        >
          {step === 0 ? (
            <div className="release-dialog__pane" key="changelog" data-dir={direction} ref={setPane}>
              <div className="release-dialog__hero">
                <StatusBadge tone="success" compact withDot>
                  {copy.newVersion}
                </StatusBadge>
                <span className="release-dialog__version">{`v${version}`}</span>
                {date ? <span className="release-dialog__date">{date}</span> : null}
              </div>
              <DialogTitle className="release-dialog__title">
                {interpolate(copy.title, { version })}
              </DialogTitle>
              <DialogDescription id="release-dialog-desc" className="release-dialog__sr">
                {copy.highlightsLabel}
              </DialogDescription>
              <div className="release-dialog__group">
                <h4>{copy.highlightsLabel}</h4>
                <ul className="release-dialog__changes" lang="en">
                  {highlights.map((entry) => (
                    <li key={`${entry.scope ?? ''}:${entry.text}`} className="release-dialog__change">
                      <span>
                        {entry.scope ? <b>{entry.scope}: </b> : null}
                        {entry.text}
                      </span>
                      {entry.commits[0] ? (
                        <span className="release-dialog__hash">{entry.commits[0].slice(0, 7)}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {overflow > 0 ? (
                  <p className="release-dialog__more">
                    {plural(overflow, copy.moreChanges, { n: overflow })}
                  </p>
                ) : null}
              </div>
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
            <div className="release-dialog__pane" key="guide" data-dir={direction} ref={setPane}>
              <DialogTitle className="release-dialog__title">{copy.guideTitle}</DialogTitle>
              <DialogDescription id="release-dialog-desc" className="release-dialog__lead">
                {canWriteSteps ? copy.guideLeadAdmin : copy.guideLeadReadOnly}
              </DialogDescription>
              <ul className="release-dialog__steplist">
                {openRows.map((row, index) => {
                  const text = stepCopy(row.step.id);
                  const required = row.importance === 'required';
                  return (
                    <li
                      key={row.key}
                      className={`release-dialog__step release-dialog__step--${row.importance}`}
                      style={{ animationDelay: `${index * 70}ms` }}
                    >
                      <span className="release-dialog__mark" aria-hidden="true" />
                      <span className="release-dialog__step-title">
                        {text.title}
                        {row.connection ? (
                          <span className="release-dialog__step-conn"> · {row.connection.name}</span>
                        ) : null}
                      </span>
                      {canWriteSteps ? (
                        <span
                          className={`release-chip${required ? ' release-chip--accent' : ''}`}
                        >
                          {required ? copy.required : copy.optional}
                        </span>
                      ) : (
                        <span className="release-chip">{copy.needsAdmin}</span>
                      )}
                      <span className="release-dialog__step-why">{text.why}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </motion.div>

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
                  <Button ref={primaryRef} onClick={() => goTo(1)}>
                    {copy.toGuide} <ReleaseIcon name="arrow-right" size={14} />
                  </Button>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <Button
                tone="ghost"
                className="button--icon"
                aria-label={copy.back}
                onClick={() => goTo(0)}
              >
                <ReleaseIcon name="arrow-left" />
              </Button>
              <div className="release-dialog__foot-right">
                <Button tone="secondary" onClick={() => onClose(false)}>
                  {copy.later}
                </Button>
                <Button ref={primaryRef} onClick={() => onStartGuide(openRows, false)}>
                  {canWriteSteps ? copy.startGuide : copy.showWhere}{' '}
                  <ReleaseIcon name="arrow-right" size={14} />
                </Button>
              </div>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

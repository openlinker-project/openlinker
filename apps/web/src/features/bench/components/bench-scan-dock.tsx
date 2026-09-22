/**
 * The phone and tablet scan dock (mobile-first rebuild, epic #3401)
 *
 * Two storeys of sticky furniture at the bottom of a compact bench, plus the
 * camera sheet that takes over the reading area above them.
 *
 * ## Why the bottom, and why it never scrolls
 *
 * A packer on a phone holds a box in one hand. Everything they touch is in
 * the bottom third, so there is no state in which the scan control has to be
 * found — which is the failure the desktop bench had for a different reason
 * (no visible field at all) and which a narrowed desktop layout would have
 * reproduced by putting the hero above a long scrolling list.
 *
 * ## Storey 1 is the item switcher, and it is an ACCORDION rather than a page
 *
 * Jumping to another item must not take the packer off the box: a route, a
 * dialog or a replaced view all lose the scan field, and getting back to it
 * is the cost they pay for looking. Expanding pushes the reading area up and
 * leaves the dock exactly where their thumb left it.
 *
 * ## Storey 2's camera is a MODE, not a screen
 *
 * `BenchCameraSheet` replaces the reading area and nothing else. The dock
 * strip stays visible underneath, so the packer can always see which item the
 * camera is counting into — a full-screen viewfinder makes that ambiguous the
 * moment two items in a box look alike.
 *
 * ## Every path here is the SAME path the desktop bench uses
 *
 * `onScanValue` is the parcel view's own matcher, `onConfirm` its own
 * `submit`, `onUndo` its own undo. The camera, the typed field and the
 * hardware scanner all arrive through `onScanValue`, so nothing recorded from
 * a phone is distinguishable afterwards from anything recorded at a bench —
 * D20 by construction, one device further out.
 *
 * @module apps/web/src/features/bench/components
 */
import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import type { BenchParcelLine } from '../api/bench-parcel.types';
import { useBarcodeCamera } from '../hooks/use-barcode-camera';
import { benchLineState } from '../lib/bench-parcel-presentation';
import { benchParcelCopy } from '../lib/bench-parcel.copy';

export interface BenchScanDockProps {
  /** Every line of the box, in the server's order — the accordion's content. */
  readonly lines: readonly BenchParcelLine[];
  /** The line the dock is counting into. */
  readonly activeLine: BenchParcelLine | undefined;
  /** Whether the box may still take units. A closed box offers no scanning. */
  readonly open: boolean;
  /** H1 — a bench that cannot reach OpenLinker must not look as if it can. */
  readonly unreachable: boolean;
  /** Gestures out and unanswered for the active line (#2421, story H2). */
  readonly pendingCount: number;
  readonly onSelectLine: (line: BenchParcelLine) => void;
  readonly onScanValue: (value: string) => void;
  readonly onConfirm: (line: BenchParcelLine) => void;
  readonly onUndo?: () => void;
  readonly undoing?: boolean;
  /** Opens the work list. On a compact bench the rail is a sheet, not a pane. */
  readonly onSwitchParcel?: () => void;
  /** `tablet` lays the dock out sideways; `phone` stacks it. */
  readonly layout: 'phone' | 'tablet';
}

function cameraProblem(
  support: ReturnType<typeof useBarcodeCamera>['support'],
  error: ReturnType<typeof useBarcodeCamera>['error']
): string | null {
  if (error === 'permission-denied') return benchParcelCopy.mobile.cameraDenied;
  if (error === 'no-device') return benchParcelCopy.mobile.cameraNoDevice;
  if (error === 'failed') return benchParcelCopy.mobile.cameraFailed;
  if (support === 'no-detector') return benchParcelCopy.mobile.cameraUnsupported;
  if (support === 'no-camera') return benchParcelCopy.mobile.cameraNoDevice;
  return null;
}

export function BenchScanDock({
  lines,
  activeLine,
  open,
  unreachable,
  pendingCount,
  onSelectLine,
  onScanValue,
  onConfirm,
  onUndo,
  undoing = false,
  onSwitchParcel,
  layout,
}: BenchScanDockProps): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [typed, setTyped] = useState('');
  const field = useRef<HTMLInputElement | null>(null);

  const camera = useBarcodeCamera({ onRead: onScanValue });

  // A closed or refused box takes no units, so a camera left running on one
  // is a light pointed at nothing and a battery spent for no reason.
  useEffect(() => {
    if (!open && camera.active) camera.stop();
  }, [open, camera]);

  const problem = cameraProblem(camera.support, camera.error);
  const activeIndex = activeLine === undefined ? -1 : lines.indexOf(activeLine);
  const remaining =
    activeLine === undefined
      ? 0
      : Math.max(0, activeLine.requiredQuantity - activeLine.verifiedQuantity);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const value = typed.trim();
    if (value.length === 0) return;
    setTyped('');
    onScanValue(value);
  };

  return (
    <>
      {camera.active ? (
        <div className="bench-camera" data-testid="bench-camera">
          <div className="bench-camera__bar">
            <button
              type="button"
              className="bench-camera__round"
              aria-label={benchParcelCopy.mobile.scanClose}
              onClick={camera.stop}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            {camera.torchAvailable ? (
              <button
                type="button"
                className={`bench-camera__round${camera.torchOn ? ' bench-camera__round--on' : ''}`}
                aria-label={benchParcelCopy.mobile.torch}
                aria-pressed={camera.torchOn}
                onClick={camera.toggleTorch}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 2L5 14h6l-1 8 8-12h-6z" /></svg>
              </button>
            ) : null}
          </div>

          <div className="bench-camera__frame">
            {/* Muted and inline-playable, or iOS refuses to start the stream. */}
            <video ref={camera.videoRef} className="bench-camera__video" muted playsInline />
            <span className="bench-camera__reticle" aria-hidden="true" />
          </div>

          <p className="bench-camera__aim">{benchParcelCopy.mobile.aim}</p>
          {camera.lastValue === null ? null : (
            <p className="bench-camera__read" data-testid="bench-camera-read">
              {benchParcelCopy.mobile.lastRead} <code>{camera.lastValue}</code>
            </p>
          )}
          <p className="bench-camera__note">{benchParcelCopy.mobile.keepScanning}</p>
        </div>
      ) : null}

      <div className={`bench-dock bench-dock--${layout}`} data-testid="bench-dock">
        {/* ── Storey 1: the item switcher ─────────────────────────────── */}
        <button
          type="button"
          className="bench-dock__handle"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded((current) => !current);
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={expanded ? 'M6 9l6 6 6-6' : 'M6 15l6-6 6 6'} />
          </svg>
          <span className="bench-dock__handle-title">
            {activeIndex >= 0
              ? benchParcelCopy.mobile.itemOf(activeIndex + 1, lines.length)
              : benchParcelCopy.mobile.itemsHeading}
          </span>
          <span className="bench-dock__handle-name">
            {activeLine?.name ?? benchParcelCopy.lines.unnamed}
          </span>
          <span className="bench-dock__handle-left">
            {remaining === 0
              ? benchParcelCopy.lines.allIn
              : benchParcelCopy.mobile.stillToScanShort(remaining)}
          </span>
        </button>

        {expanded ? (
          <div className="bench-dock__items" data-testid="bench-dock-items">
            <ul className="bench-dock__item-list">
              {lines.map((line) => {
                const state = benchLineState(line);
                const isActive = line.workLineId === activeLine?.workLineId;
                return (
                  <li key={line.workLineId}>
                    <button
                      type="button"
                      className={`bench-dock__item${isActive ? ' bench-dock__item--active' : ''}`}
                      aria-current={isActive}
                      onClick={() => {
                        onSelectLine(line);
                        setExpanded(false);
                      }}
                    >
                      <span className="bench-dock__item-mark" aria-hidden="true">
                        {state === 'verified' ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 6" /></svg>
                        ) : (
                          <span className="bench-dock__item-dot" />
                        )}
                      </span>
                      <span className="bench-dock__item-body">
                        <span className="bench-dock__item-name">
                          {line.name ?? benchParcelCopy.lines.unnamed}
                        </span>
                        <span className="bench-dock__item-codes">
                          {benchParcelCopy.lines.codes({ ean: line.ean, sku: line.sku })}
                          {line.binCode === null
                            ? null
                            : ` · ${benchParcelCopy.lines.binCodeLabel(line.binCode)}`}
                        </span>
                      </span>
                      <span className="bench-dock__item-count">
                        {benchParcelCopy.lines.count(line.verifiedQuantity, line.requiredQuantity)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {onSwitchParcel === undefined ? null : (
              <button
                type="button"
                className="bench-dock__switch"
                onClick={() => {
                  setExpanded(false);
                  onSwitchParcel();
                }}
              >
                {benchParcelCopy.mobile.switchParcel}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
              </button>
            )}
          </div>
        ) : null}

        {/* ── Storey 2: the scan dock ─────────────────────────────────── */}
        <div className="bench-dock__scan">
          <div className="bench-dock__item-strip">
            {activeLine?.imageUrl === undefined || activeLine.imageUrl === null ? (
              <span className="bench-dock__thumb" aria-hidden="true" />
            ) : (
              <img className="bench-dock__thumb" src={activeLine.imageUrl} alt="" />
            )}
            <span className="bench-dock__strip-body">
              <span className="bench-dock__strip-name">
                {activeLine?.name ?? benchParcelCopy.lines.unnamed}
              </span>
              <span className="bench-dock__strip-codes">
                {activeLine === undefined
                  ? benchParcelCopy.mobile.allItemsDone
                  : benchParcelCopy.lines.codes({ ean: activeLine.ean, sku: activeLine.sku })}
              </span>
              {pendingCount > 0 ? (
                <span className="bench-dock__strip-pending">{benchParcelCopy.inFlight.sent}</span>
              ) : null}
            </span>
            {activeLine === undefined ? null : (
              <span className="bench-dock__count">
                <span className="bench-dock__count-value">{activeLine.verifiedQuantity}</span>
                <span className="bench-dock__count-of">
                  {' '}
                  {benchParcelCopy.hero.countOf(activeLine.requiredQuantity)}
                </span>
              </span>
            )}
          </div>

          {open && activeLine !== undefined ? (
            <div className="bench-dock__controls">
              {/* The camera and the undo share one column on a tablet, so the
                  column collapses cleanly when the browser has no decoder and
                  the camera button is not offered at all. */}
              <div className="bench-dock__primary">
              {camera.support === 'ready' && !camera.active ? (
                <button
                  type="button"
                  className="bench-dock__camera"
                  disabled={unreachable}
                  onClick={camera.start}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7h3l2-2h8l2 2h3v12H3z" /><circle cx="12" cy="13" r="3.5" /></svg>
                  {benchParcelCopy.mobile.scanAction}
                </button>
              ) : null}

              {onUndo === undefined ? null : (
                <Button
                  tone="ghost"
                  disabled={undoing || unreachable}
                  onClick={() => {
                    onUndo();
                  }}
                >
                  {benchParcelCopy.undo.action}
                </Button>
              )}
              </div>

              <form className="bench-dock__type" onSubmit={handleSubmit}>
                <label htmlFor="bench-dock-scan" className="sr-only">
                  {benchParcelCopy.hero.scanLabel}
                </label>
                <input
                  id="bench-dock-scan"
                  ref={field}
                  type="text"
                  className="mono"
                  autoComplete="off"
                  placeholder={benchParcelCopy.hero.scanPlaceholder}
                  value={typed}
                  disabled={unreachable}
                  onChange={(event) => {
                    setTyped(event.target.value);
                  }}
                />
                <Button
                  tone="secondary"
                  disabled={unreachable}
                  onClick={() => {
                    onConfirm(activeLine);
                  }}
                >
                  {benchParcelCopy.hero.confirmAction}
                </Button>
              </form>

              {/* Shown-and-explained rather than hidden: a camera button that
                  is simply absent reads as a missing feature, and the packer's
                  next move is to hunt for it. */}
              {problem === null ? null : (
                <p className="bench-dock__problem" data-testid="bench-dock-camera-problem">
                  {problem}
                </p>
              )}
            </div>
          ) : null}

          {open || activeLine === undefined ? null : (
            <Alert tone="info">{benchParcelCopy.closed.next}</Alert>
          )}
        </div>
      </div>
    </>
  );
}

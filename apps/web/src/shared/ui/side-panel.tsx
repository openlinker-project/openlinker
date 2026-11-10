/**
 * SidePanel
 *
 * Desktop: a drawer docked to the right edge. Phone (<= 640px): a bottom
 * sheet in the vaul style - grab handle, drag the handle or header down to
 * dismiss (past 30% of its height, or a quick flick), a rubber band when
 * pulled up, the scrim fading with the drag, and the page behind scaled back.
 *
 * Built on the same Radix Dialog as `Dialog` and `FilterSheet` (focus trap,
 * Esc, scroll lock, `aria-modal`). `forceMount` + `AnimatePresence` let it
 * animate OUT as well as in. The drag runs on motion values, so no React
 * state changes per frame.
 *
 * Contract for consumers:
 * - The panel stays mounted while `open` is true; changing `children` or
 *   `title` never remounts it. Key an inner element yourself to animate a
 *   content swap (e.g. walking orders with j/k in a peek panel).
 * - `footer` is pinned outside the scroll area and clears the phone's home
 *   indicator (safe-area-inset-bottom).
 * - Dragging starts from the handle or anywhere in the header; buttons,
 *   links and form controls inside the header never start a drag.
 * - Esc and an outside click close only the TOPMOST panel: Radix keeps one
 *   dismissable-layer stack across portals, so an `elevated` guide over a
 *   detail panel closes alone.
 * - Styles live in index.css beside the Dialog rules (`.side-panel*`).
 * - On a phone the app root scales back (`body.side-panel-sheet-open`). A
 *   transformed ancestor becomes the containing block for `position: fixed`
 *   children, so anything fixed INSIDE the app root (toasts, sticky bars)
 *   shifts while a sheet is open. The panel itself portals out, which is why
 *   it is unaffected; other fixed UI should portal to `document.body` too.
 *
 * @module shared/ui
 */
import * as RadixDialog from '@radix-ui/react-dialog';
import {
  AnimatePresence,
  motion,
  useDragControls,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type PanInfo,
} from 'motion/react';
import { useEffect, useRef, useState, type PointerEvent, type ReactElement, type ReactNode, type Ref } from 'react';
import { useMessages } from '../i18n/use-messages';

export interface SidePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** Small line above the title (what the panel is about). */
  kicker?: ReactNode;
  /** Line under the title (badges, a help link). */
  meta?: ReactNode;
  /** Right-aligned header slot beside the title (a total, a status badge). */
  headerAside?: ReactNode;
  /**
   * Desktop only: inset 8px from the edges with rounded corners over a
   * blurred scrim (default), or flush with the right edge.
   */
  floating?: boolean;
  /** Screen-reader description of the panel. */
  description: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  /** Stack above another open SidePanel. */
  elevated?: boolean;
  closeLabel?: string;
  /**
   * Show the close control as a ✕ icon (its label becomes the accessible
   * name) instead of the text label.
   */
  closeIcon?: boolean;
  /** Extra class on the panel, merged with the primitive's own. */
  className?: string;
  /**
   * The scroll container. `scrollIntoView` on any child already works because
   * the body is the only element that scrolls; the ref is for explicit
   * `scrollTo` / restoring a position.
   */
  bodyRef?: Ref<HTMLDivElement>;
}

const PHONE_QUERY = '(max-width: 640px)';
/**
 * From full HD a panel pinned to the right edge sits far from where the eye
 * is, so it opens as a centred modal instead. Deliberately earlier than the
 * floating layout (`--layout-max-width`, 2560px): the modal helps on any wide
 * screen, the floating sidebar only once there is room to spare.
 */
const WIDE_QUERY = '(min-width: 1920px)';
const SIDE_SPRING = { type: 'tween', duration: 0.36, ease: [0.32, 0.72, 0, 1] } as const;
/** vaul's curve: fast out, long settle. */
/**
 * Phone sheet motion: shorter than vaul's 480 ms and still decelerating, so
 * the sheet arrives without a long slide across the whole screen.
 */
const SHEET_TWEEN = { type: 'tween', duration: 0.34, ease: [0.22, 1, 0.36, 1] } as const;
/** How dark the phone scrim gets at rest; it fades further as the sheet is dragged. */
/** No overshoot: an operator tool, not a toy (the motion guide's rule). */
const MODAL_SPRING = { type: 'spring', visualDuration: 0.34, bounce: 0 } as const;
const MODAL_EXIT = { type: 'tween', duration: 0.16, ease: [0.4, 0, 1, 1] } as const;
const SHEET_SCRIM_MAX = 0.55;
const DISMISS_FRACTION = 0.3;
const DISMISS_VELOCITY = 450;

function useMediaMatch(media: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia?.(media).matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.(media);
    if (!query) return undefined;
    const onChange = (): void => setMatches(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [media]);
  return matches;
}

export function SidePanel({
  open,
  onOpenChange,
  title,
  kicker,
  meta,
  headerAside,
  floating = true,
  description,
  children,
  footer,
  width = 480,
  elevated = false,
  closeLabel,
  closeIcon = false,
  className = '',
  bodyRef,
}: SidePanelProps): ReactElement {
  const copy = useMessages('ui').sidePanel;
  const close = closeLabel ?? copy.close;
  const reduce = useReducedMotion();
  const phone = useMediaMatch(PHONE_QUERY);
  const modal = useMediaMatch(WIDE_QUERY) && !phone;
  const controls = useDragControls();
  const panelRef = useRef<HTMLElement>(null);
  const y = useMotionValue(0);
  const scrimOpacity = useTransform(y, (value) => {
    const height = panelRef.current?.offsetHeight ?? 600;
    return SHEET_SCRIM_MAX * (1 - Math.min(1, Math.max(0, value) / height));
  });

  // The page behind recedes while a sheet is open (phone only, top layer only).
  useEffect(() => {
    if (!open || !phone || elevated) return undefined;
    document.body.classList.add('side-panel-sheet-open');
    return () => document.body.classList.remove('side-panel-sheet-open');
  }, [open, phone, elevated]);

  const startDrag = (event: PointerEvent<HTMLElement>): void => {
    if (!phone) return;
    if ((event.target as HTMLElement).closest('button, a, input, select, label, textarea')) return;
    controls.start(event);
  };

  const endDrag = (_: unknown, info: PanInfo): void => {
    const height = panelRef.current?.offsetHeight ?? 600;
    if (info.offset.y > height * DISMISS_FRACTION || info.velocity.y > DISMISS_VELOCITY) onOpenChange(false);
  };

  const closeButton = (
    <RadixDialog.Close asChild>
      {closeIcon ? (
        <button type="button" className="side-panel__close side-panel__close--icon" aria-label={close}>
          <span aria-hidden="true">✕</span>
        </button>
      ) : (
        <button type="button" className="button button--ghost side-panel__close">
          {close}
        </button>
      )}
    </RadixDialog.Close>
  );

  const enter = reduce
    ? { opacity: 0 }
    : phone
      ? { y: '100%' }
      : modal
        ? { opacity: 0, scale: 0.96, y: 16 }
        : { x: 'calc(100% + 16px)' };
  const rest = reduce ? { opacity: 1 } : phone ? { y: 0 } : modal ? { opacity: 1, scale: 1, y: 0 } : { x: 0 };
  const exit = modal && !reduce ? { opacity: 0, scale: 0.98, y: 8, transition: MODAL_EXIT } : enter;

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <RadixDialog.Portal forceMount>
            <RadixDialog.Overlay asChild forceMount>
              <motion.div
                className={[
                  'side-panel__overlay',
                  elevated ? 'side-panel__overlay--elevated' : '',
                  modal ? 'side-panel__overlay--modal' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22 }}
              >
                <motion.div className="side-panel__overlay-fill" style={phone ? { opacity: scrimOpacity } : undefined} />
              </motion.div>
            </RadixDialog.Overlay>
            <RadixDialog.Content asChild forceMount>
              <motion.aside
                ref={panelRef}
                className={[
                  'side-panel',
                  phone ? 'side-panel--sheet' : modal ? 'side-panel--modal' : floating ? 'side-panel--floating' : '',
                  elevated ? 'side-panel--elevated' : '',
                  className,
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{ ['--side-panel-width' as string]: `${width}px`, ...(phone ? { y } : {}) }}
                initial={enter}
                animate={rest}
                exit={exit}
                transition={phone ? SHEET_TWEEN : modal ? MODAL_SPRING : SIDE_SPRING}
                drag={phone && !reduce ? 'y' : false}
                dragControls={controls}
                dragListener={false}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0.06, bottom: 1 }}
                dragMomentum={false}
                onDragEnd={endDrag}
              >
                {phone ? (
                  <div className="side-panel__handle" onPointerDown={startDrag} aria-hidden="true">
                    <span />
                  </div>
                ) : null}
                <header className="side-panel__head" onPointerDown={startDrag}>
                  {kicker ? (
                    <div className="side-panel__top">
                      <span className="side-panel__kicker">{kicker}</span>
                      {closeButton}
                    </div>
                  ) : null}
                  <div
                    className={[
                      'side-panel__title-row',
                      kicker ? '' : 'side-panel__title-row--with-close',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <div className="side-panel__title-main">
                      <RadixDialog.Title className="side-panel__title">{title}</RadixDialog.Title>
                      {meta ? <div className="side-panel__meta">{meta}</div> : null}
                    </div>
                    {headerAside ? <div className="side-panel__aside">{headerAside}</div> : null}
                    {kicker ? null : closeButton}
                  </div>
                  <RadixDialog.Description className="sr-only">{description}</RadixDialog.Description>
                </header>
                <div className="side-panel__body" ref={bodyRef}>
                  {children}
                </div>
                {footer ? <footer className="side-panel__foot">{footer}</footer> : null}
              </motion.aside>
            </RadixDialog.Content>
          </RadixDialog.Portal>
        ) : null}
      </AnimatePresence>
    </RadixDialog.Root>
  );
}

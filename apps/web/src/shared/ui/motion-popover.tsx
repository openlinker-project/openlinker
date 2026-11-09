/**
 * MotionPopover
 *
 * A small floating panel centred on its trigger, with the switch family's
 * entrance: it scales up from 92%, drops a few pixels from the trigger and
 * sharpens out of a blur (#4029). It renders in a portal, so a parent's
 * `overflow: hidden` cannot clip it, and inside a modal `<dialog>` (the mobile
 * drawer) it renders into that dialog, which sits in the browser's top layer
 * above anything in `<body>`.
 *
 * `useAnchoredPopover` owns the behaviour around it: open state, the position
 * (centred on the trigger, moved inwards only as far as the viewport needs),
 * closing on an outside press, following resize and scroll, and handing focus
 * back to the trigger on close. Content (a list, a switch) brings its own
 * keyboard handling and focuses itself when it mounts.
 *
 * Kept on this small hand-rolled base rather than the Radix popover: its
 * wrapper cannot target a `<dialog>` as the portal container.
 *
 * @module shared/ui
 */
import { AnimatePresence, motion } from 'motion/react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { SNAPPY_SPRING } from './motion-presets';

const GAP = 8;

export type PopoverPlacement = 'up' | 'down';

/** Centred on the trigger, moved inwards only as far as needed to stay on screen. */
export function anchoredPosition(
  trigger: DOMRect,
  width: number,
  placement: PopoverPlacement
): CSSProperties {
  const half = width / 2;
  const centre = trigger.left + trigger.width / 2;
  const left = Math.min(Math.max(centre, GAP + half), window.innerWidth - GAP - half);
  return placement === 'down'
    ? { left, top: trigger.bottom + GAP }
    : { left, bottom: window.innerHeight - trigger.top + GAP };
}

export interface UseAnchoredPopoverOptions {
  width: number;
  placement: PopoverPlacement;
}

export interface AnchoredPopover<T extends HTMLElement> {
  open: boolean;
  /** Opens or closes; opening measures the trigger and picks the portal host. */
  toggle: () => void;
  /** Closes and puts focus back on the trigger. */
  close: () => void;
  anchorRef: RefObject<T | null>;
  popoverRef: RefObject<HTMLDivElement | null>;
  position: CSSProperties;
  host: Element | null;
}

export function useAnchoredPopover<T extends HTMLElement = HTMLButtonElement>({
  width,
  placement,
}: UseAnchoredPopoverOptions): AnchoredPopover<T> {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const [host, setHost] = useState<Element | null>(null);
  const anchorRef = useRef<T>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      // The panel lives in a portal, outside the trigger's tree, so check both.
      if (anchorRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const place = (): void => {
      if (anchorRef.current) {
        setPosition(anchoredPosition(anchorRef.current.getBoundingClientRect(), width, placement));
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, width, placement]);

  const toggle = useCallback((): void => {
    if (!open && anchorRef.current) {
      setHost(anchorRef.current.closest('dialog'));
      setPosition(anchoredPosition(anchorRef.current.getBoundingClientRect(), width, placement));
    }
    setOpen(!open);
  }, [open, width, placement]);

  const close = useCallback((): void => {
    setOpen(false);
    anchorRef.current?.focus();
  }, []);

  return { open, toggle, close, anchorRef, popoverRef, position, host };
}

export interface MotionPopoverProps {
  open: boolean;
  position: CSSProperties;
  /** Portal container; `null` means `<body>`. */
  host: Element | null;
  placement: PopoverPlacement;
  width: number;
  /** Small muted heading above the content. */
  title?: ReactNode;
  titleId?: string;
  className?: string;
  children: ReactNode;
}

export const MotionPopover = forwardRef<HTMLDivElement, MotionPopoverProps>(function MotionPopover(
  { open, position, host, placement, width, title, titleId, className, children },
  ref
) {
  const down = placement === 'down';
  const classes = ['motion-popover', down ? 'motion-popover--down' : '', className]
    .filter(Boolean)
    .join(' ');
  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          ref={ref}
          style={{ ...position, width }}
          className={classes}
          // `x: '-50%'` centres the panel on the trigger; Motion owns
          // `transform`, so the CSS cannot do it with its own translate.
          initial={{ opacity: 0, scale: 0.92, x: '-50%', y: down ? -6 : 6, filter: 'blur(4px)' }}
          animate={{ opacity: 1, scale: 1, x: '-50%', y: 0, filter: 'blur(0px)' }}
          exit={{
            opacity: 0,
            scale: 0.96,
            x: '-50%',
            y: down ? -4 : 4,
            filter: 'blur(2px)',
            transition: { duration: 0.12 },
          }}
          transition={SNAPPY_SPRING}
        >
          {title ? (
            <div className="motion-popover__head" id={titleId}>
              {title}
            </div>
          ) : null}
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>,
    host ?? document.body
  );
});

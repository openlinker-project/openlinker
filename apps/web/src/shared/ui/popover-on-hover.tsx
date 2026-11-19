/**
 * PopoverOnHover
 *
 * The base of the "small explanation behind a mark" family: a floating panel
 * that opens when the pointer rests on its trigger, when the trigger takes
 * keyboard focus, or when it is tapped, and closes on leave, blur, Escape or a
 * press outside. It is built on the same `useAnchoredPopover` + `MotionPopover`
 * pair as the language and theme switches, so it enters the same way (scale,
 * drop and un-blur) and renders in a portal that no `overflow: hidden`
 * ancestor can clip.
 *
 * The trigger is a render prop: the caller owns the element (an icon, a badge,
 * a link) and spreads `triggerProps` onto ONE focusable element. That keeps this
 * file free of any look, and lets `IconWithOnHoverPopoverTooltip` and its
 * Warning variant sit on top of it without a second implementation of the
 * hover rules.
 *
 * **Hover is never the only way in.** A touch screen has no hover and a
 * keyboard user never makes one, so focus and a tap open it too. A mouse click
 * on an already hover-opened panel leaves it open (it would feel like the panel
 * flickered shut under the cursor); a tap or Enter on an open panel closes it.
 *
 * @module shared/ui
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import {
  MotionPopover,
  useAnchoredPopover,
  type PopoverAlign,
  type PopoverPlacement,
} from './motion-popover';

/** What the trigger element must receive, spread as-is. */
export interface PopoverOnHoverTriggerProps
  extends Pick<
    HTMLAttributes<HTMLElement>,
    | 'onPointerDown'
    | 'onPointerEnter'
    | 'onPointerLeave'
    | 'onFocus'
    | 'onBlur'
    | 'onClick'
    | 'onKeyDown'
    | 'aria-describedby'
    | 'aria-expanded'
  > {
  ref: Ref<never>;
}

export interface PopoverOnHoverProps {
  trigger: (props: PopoverOnHoverTriggerProps) => ReactElement;
  children: ReactNode;
  /** Small muted heading above the content. */
  title?: ReactNode;
  /** Names the panel for assistive technology; the panel holds structured text, not a tooltip. */
  ariaLabel?: string;
  width?: number;
  placement?: PopoverPlacement;
  align?: PopoverAlign;
  className?: string;
  /** Rest time on the trigger before the panel opens. */
  openDelayMs?: number;
  /** Grace time to cross the gap between trigger and panel before it closes. */
  closeDelayMs?: number;
}

const DEFAULT_WIDTH = 320;

export function PopoverOnHover({
  trigger,
  children,
  title,
  ariaLabel,
  width = DEFAULT_WIDTH,
  placement = 'down',
  align = 'center',
  className,
  openDelayMs = 120,
  closeDelayMs = 180,
}: PopoverOnHoverProps): ReactElement {
  const popover = useAnchoredPopover<HTMLElement>({ width, placement, align });
  const bodyId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openRef = useRef(false);
  const pointerType = useRef<string>('mouse');
  openRef.current = popover.open;
  const { toggle } = popover;

  const clearTimer = useCallback((): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const show = useCallback((): void => {
    clearTimer();
    if (!openRef.current) toggle();
  }, [clearTimer, toggle]);

  // `close` from the hook hands focus back to the trigger, which is right for an
  // Escape but wrong for a pointer that merely moved away.
  const hide = useCallback((): void => {
    clearTimer();
    if (openRef.current) toggle();
  }, [clearTimer, toggle]);

  const later = useCallback(
    (action: () => void, delay: number): void => {
      clearTimer();
      timer.current = setTimeout(action, delay);
    },
    [clearTimer]
  );

  useEffect(() => clearTimer, [clearTimer]);

  useEffect(() => {
    if (!popover.open) return undefined;
    // Registered on `window` in the CAPTURE phase so it runs before a dialog's own
    // Escape handler (Radix listens on `document`): inside a dialog, Escape must
    // close this panel first, and the dialog on the press after.
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      popover.close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [popover]);

  const triggerProps: PopoverOnHoverTriggerProps = {
    ref: popover.anchorRef as Ref<never>,
    'aria-expanded': popover.open,
    'aria-describedby': popover.open ? bodyId : undefined,
    onPointerDown: (event) => {
      pointerType.current = event.pointerType || 'mouse';
    },
    onPointerEnter: (event) => {
      // A touch has no hover; the tap that follows is handled by `onClick`.
      if (event.pointerType === 'touch') return;
      later(show, openDelayMs);
    },
    onPointerLeave: (event) => {
      if (event.pointerType === 'touch') return;
      later(hide, closeDelayMs);
    },
    onFocus: show,
    onBlur: () => later(hide, closeDelayMs),
    onClick: () => {
      if (openRef.current && pointerType.current === 'mouse') return;
      if (openRef.current) hide();
      else show();
    },
  };

  const classes = ['popover-on-hover', className].filter(Boolean).join(' ');

  return (
    <>
      {trigger(triggerProps)}
      <MotionPopover
        ref={popover.popoverRef}
        open={popover.open}
        position={popover.position}
        host={popover.host}
        placement={placement}
        width={width}
        title={title}
        className={classes}
      >
        <div
          id={bodyId}
          role="region"
          aria-label={ariaLabel}
          className="popover-on-hover__body"
          onPointerEnter={clearTimer}
          onPointerLeave={() => later(hide, closeDelayMs)}
        >
          {children}
        </div>
      </MotionPopover>
    </>
  );
}

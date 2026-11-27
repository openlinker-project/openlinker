/**
 * PeekButton
 *
 * A pill trigger that shows only an icon and a chevron, and on hover or
 * keyboard focus slides out the name of what it holds (#4029): a wider copy of
 * the pill fades in over it and the name unrolls beside the icon. The copy is
 * absolutely positioned, so nothing around the button reflows; `reveal` picks
 * the side it grows towards (`start`: leftwards, for a right-hand edge; `end`:
 * rightwards, for a button with a neighbour on its left).
 *
 * A change of `iconKey` animates the icon swap (`flip` turns it over like a
 * card, `spin` rotates and scales it). The chevron turns to point where the
 * panel opens (`placement`) while `open`. The peek is decorative: the button's
 * accessible name has to say the same, and it never shows on a touch screen
 * or while open. `touchSize` gives touch screens a 40px capsule with larger
 * icons and a 44px tap target.
 *
 * @module shared/ui
 */
import { AnimatePresence, motion } from 'motion/react';
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import { SNAPPY_SPRING } from './motion-presets';

const SWAPS = {
  flip: {
    initial: { rotateY: -90, opacity: 0 },
    animate: { rotateY: 0, opacity: 1 },
    exit: { rotateY: 90, opacity: 0 },
    transition: { duration: 0.18, ease: [0.16, 1, 0.3, 1] },
  },
  spin: {
    initial: { rotate: -90, scale: 0.6, opacity: 0 },
    animate: { rotate: 0, scale: 1, opacity: 1 },
    exit: { rotate: 90, scale: 0.6, opacity: 0 },
    transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
  },
} as const;

function Chevron({ className }: { className: string }): ReactElement {
  return (
    <svg className={className} viewBox="0 0 10 10" aria-hidden="true">
      <path
        d="M2 6.5L5 3.5L8 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface PeekButtonProps extends Omit<ComponentPropsWithoutRef<'button'>, 'children'> {
  /** What the button holds: a flag, a theme icon. */
  icon: ReactNode;
  /** Changing it animates the icon swap. */
  iconKey: string;
  iconSwap?: 'flip' | 'spin';
  /** The name that slides out on hover or focus. */
  label: ReactNode;
  /** `lang` of the label, when it is in a language of its own (a native name). */
  labelLang?: string;
  reveal?: 'start' | 'end';
  /** The panel it controls is open: the peek stays hidden and the chevron turns. */
  open?: boolean;
  /** Where the panel opens. */
  placement?: 'up' | 'down';
  /** A 40px capsule with larger icons on touch screens. */
  touchSize?: boolean;
  /** Classes for the wrapper (the button itself is `.peek-button__trigger`). */
  className?: string;
}

export const PeekButton = forwardRef<HTMLButtonElement, PeekButtonProps>(function PeekButton(
  {
    icon,
    iconKey,
    iconSwap = 'flip',
    label,
    labelLang,
    reveal = 'start',
    open = false,
    placement = 'down',
    touchSize = false,
    className,
    type = 'button',
    ...buttonProps
  },
  ref
) {
  const down = placement === 'down';
  const swap = SWAPS[iconSwap];
  const classes = [
    'peek-button',
    reveal === 'end' ? 'peek-button--reveal-end' : '',
    touchSize ? 'peek-button--touch' : '',
    open ? 'is-open' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      <button ref={ref} type={type} className="peek-button__trigger" {...buttonProps}>
        <span className="peek-button__icon">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={iconKey}
              className="peek-button__icon-face"
              initial={swap.initial}
              animate={swap.animate}
              exit={swap.exit}
              transition={swap.transition}
            >
              {icon}
            </motion.span>
          </AnimatePresence>
        </span>
        <motion.svg
          className="peek-button__chevron"
          viewBox="0 0 10 10"
          aria-hidden="true"
          animate={{ rotate: open !== down ? 180 : 0 }}
          transition={SNAPPY_SPRING}
        >
          <path
            d="M2 6.5L5 3.5L8 6.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </motion.svg>
      </button>
      {/* Pointer events pass through to the button; the chevron matches the
          closed button's (pointing away from where the panel opens). */}
      <span
        className="peek-button__peek"
        aria-hidden="true"
        style={{ '--peek-chevron': down ? '180deg' : '0deg' } as CSSProperties}
      >
        <span className="peek-button__icon">{icon}</span>
        <span className="peek-button__reveal">
          <span className="peek-button__reveal-clip">
            <span className="peek-button__reveal-name" lang={labelLang}>
              {label}
            </span>
          </span>
        </span>
        <Chevron className="peek-button__chevron" />
      </span>
    </div>
  );
});

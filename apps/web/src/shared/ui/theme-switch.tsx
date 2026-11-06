/**
 * ThemeSwitch
 *
 * Picks the colour theme (light, dark, system) and sits next to the
 * `LanguageSwitch` as its pair (#4029): the same pill with the active mode's
 * icon, the same name sliding out on hover or keyboard focus, the same
 * popover. Inside the popover the three modes are one horizontal icon switch
 * whose thumb springs to the chosen mode, so the choice is seen happening.
 * The names stay hidden until the switch is pointed at or keyboard-focused;
 * then a row opens under it with all three, one under each icon. It stays
 * open after a choice (the theme changes behind it); outside click or Escape
 * closes it.
 *
 * Reads the theme context optionally: outside `ThemeProvider` (a bare test
 * render) it renders nothing rather than throwing.
 *
 * @module shared/ui
 */
import { AnimatePresence, motion } from 'motion/react';
import {
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import { interpolate } from '../i18n/interpolate';
import { useMessages } from '../i18n/use-messages';
import { ThemeContext } from '../theme/theme-provider';
import type { Theme } from '../theme/theme.types';

const OPTIONS: readonly Theme[] = ['light', 'dark', 'system'];

const SPRING = { type: 'spring', stiffness: 520, damping: 34, mass: 0.7 } as const;
const THUMB_SPRING = { type: 'spring', bounce: 0.18, visualDuration: 0.32 } as const;
const CAPTION_VARIANTS = {
  hidden: { opacity: 0, y: 3, filter: 'blur(3px)' },
  shown: { opacity: 1, y: 0, filter: 'blur(0px)' },
} as const;
// Caption row (22px) plus the gap above it; it opens only while names are shown.
const CAPTION_HEIGHT = 26;
const POPOVER_WIDTH = 216;
const GAP = 8;

function popoverPosition(trigger: DOMRect, down: boolean): CSSProperties {
  const half = POPOVER_WIDTH / 2;
  const centre = trigger.left + trigger.width / 2;
  const left = Math.min(Math.max(centre, GAP + half), window.innerWidth - GAP - half);
  return down
    ? { left, top: trigger.bottom + GAP }
    : { left, bottom: window.innerHeight - trigger.top + GAP };
}

export function ThemeIcon({ theme }: { theme: Theme }): ReactElement {
  return (
    <svg className="theme-switch__icon" viewBox="0 0 16 16" aria-hidden="true">
      {theme === 'light' ? (
        <>
          <circle cx="8" cy="8" r="3" fill="currentColor" />
          <path
            d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </>
      ) : theme === 'dark' ? (
        <path d="M13.5 9.6A5.6 5.6 0 0 1 6.4 2.5a5.6 5.6 0 1 0 7.1 7.1Z" fill="currentColor" />
      ) : (
        <>
          <rect
            x="1.75"
            y="2.75"
            width="12.5"
            height="8.5"
            rx="1.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <path d="M5.5 13.75h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

const CHEVRON = (
  <path
    d="M2 6.5L5 3.5L8 6.5"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  />
);

export interface ThemeSwitchProps {
  placement?: 'up' | 'down';
  className?: string;
}

export function ThemeSwitch({
  placement = 'down',
  className,
}: ThemeSwitchProps): ReactElement | null {
  const context = useContext(ThemeContext);
  const copy = useMessages('ui').theme;
  const [open, setOpen] = useState(false);
  const down = placement === 'down';
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const segmentRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [position, setPosition] = useState<CSSProperties>({});
  // Names show for all three modes at once while the switch is pointed at or
  // keyboard-focused; at rest the caption states the current mode instead.
  const [pointing, setPointing] = useState<number | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  const [touch] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(hover: none)').matches
  );
  const groupId = useId();
  const headId = useId();
  const activeIndex = Math.max(0, OPTIONS.indexOf(context?.theme ?? 'system'));
  // Read once when the popover opens, to put focus on the active mode.
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  useEffect(() => {
    if (!open) {
      setPointing(null);
      setKeyboard(false);
      return undefined;
    }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const place = (): void => {
      if (triggerRef.current) {
        setPosition(popoverPosition(triggerRef.current.getBoundingClientRect(), down));
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const frame = requestAnimationFrame(() => segmentRefs.current[activeIndexRef.current]?.focus());
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      cancelAnimationFrame(frame);
    };
  }, [open, down]);

  if (context === null) return null;
  const { theme, setTheme } = context;
  const nameOf = (value: Theme): string => copy[value];
  // A touch screen has no hover to reveal the names with, so they stay shown.
  const revealed = touch || pointing !== null || keyboard;

  function close(): void {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function toggle(): void {
    if (!open && triggerRef.current) {
      setPosition(popoverPosition(triggerRef.current.getBoundingClientRect(), down));
    }
    setOpen((value) => !value);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const count = OPTIONS.length;
    const move = (to: number): void => {
      const next = OPTIONS[(to + count) % count] ?? theme;
      setTheme(next);
      segmentRefs.current[OPTIONS.indexOf(next)]?.focus();
    };
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      move(activeIndex + 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(activeIndex - 1);
    }
  }

  const classes = ['language-switch', 'theme-switch', open ? 'is-open' : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="language-switch__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? groupId : undefined}
        aria-label={interpolate(copy.current, { name: nameOf(theme) })}
        onClick={toggle}
      >
        <span className="language-switch__flag-wrap theme-switch__icon-wrap">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={theme}
              className="language-switch__flag-face"
              initial={{ rotate: -90, scale: 0.6, opacity: 0 }}
              animate={{ rotate: 0, scale: 1, opacity: 1 }}
              exit={{ rotate: 90, scale: 0.6, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              <ThemeIcon theme={theme} />
            </motion.span>
          </AnimatePresence>
        </span>
        <motion.svg
          className="language-switch__chevron"
          viewBox="0 0 10 10"
          aria-hidden="true"
          animate={{ rotate: open !== down ? 180 : 0 }}
          transition={SPRING}
        >
          {CHEVRON}
        </motion.svg>
      </button>
      <span
        className="language-switch__peek"
        aria-hidden="true"
        style={{ '--peek-chevron': down ? '180deg' : '0deg' } as CSSProperties}
      >
        <span className="theme-switch__icon-wrap">
          <ThemeIcon theme={theme} />
        </span>
        <span className="language-switch__reveal">
          <span className="language-switch__reveal-clip">
            <span className="language-switch__reveal-name">{nameOf(theme)}</span>
          </span>
        </span>
        <svg className="language-switch__chevron" viewBox="0 0 10 10">
          {CHEVRON}
        </svg>
      </span>
      {createPortal(
        <AnimatePresence>
          {open ? (
            <motion.div
              ref={popoverRef}
              style={position}
              className={[
                'language-switch__popover',
                'theme-switch__popover',
                down ? 'language-switch__popover--down' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              initial={{
                opacity: 0,
                scale: 0.92,
                x: '-50%',
                y: down ? -6 : 6,
                filter: 'blur(4px)',
              }}
              animate={{ opacity: 1, scale: 1, x: '-50%', y: 0, filter: 'blur(0px)' }}
              exit={{
                opacity: 0,
                scale: 0.96,
                x: '-50%',
                y: down ? -4 : 4,
                filter: 'blur(2px)',
                transition: { duration: 0.12 },
              }}
              transition={SPRING}
            >
              <div className="language-switch__head" id={headId}>
                {copy.label}
              </div>
              <div
                className="theme-switch__control"
                onPointerLeave={() => setPointing(null)}
                onFocus={(event) => setKeyboard(event.target.matches(':focus-visible'))}
                onBlur={() => setKeyboard(false)}
              >
                <div
                  id={groupId}
                  className="theme-switch__segments"
                  role="radiogroup"
                  aria-labelledby={headId}
                  onKeyDown={onKeyDown}
                >
                  {OPTIONS.map((value, index) => {
                    const selected = value === theme;
                    return (
                      <button
                        key={value}
                        ref={(el) => {
                          segmentRefs.current[index] = el;
                        }}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        tabIndex={selected ? 0 : -1}
                        aria-label={nameOf(value)}
                        className="theme-switch__segment"
                        onPointerEnter={() => setPointing(index)}
                        onClick={() => setTheme(value)}
                      >
                        {selected ? (
                          <motion.span
                            className="theme-switch__thumb"
                            layoutId={`${groupId}-thumb`}
                            transition={THUMB_SPRING}
                          />
                        ) : null}
                        <motion.span
                          className="theme-switch__segment-icon"
                          animate={selected ? { scale: 1, rotate: 0 } : { scale: 0.86, rotate: 0 }}
                          whileTap={{ scale: 0.8, rotate: value === 'light' ? 45 : -20 }}
                          transition={SPRING}
                        >
                          <ThemeIcon theme={value} />
                        </motion.span>
                      </button>
                    );
                  })}
                </div>
                <AnimatePresence initial={false}>
                  {revealed ? (
                    <motion.div
                      key="caption"
                      className="theme-switch__caption"
                      aria-hidden="true"
                      initial={{ height: 0 }}
                      animate={{ height: CAPTION_HEIGHT }}
                      exit={{ height: 0 }}
                      transition={SPRING}
                    >
                      <motion.div
                        className="theme-switch__names"
                        initial="hidden"
                        animate="shown"
                        exit="hidden"
                        variants={{
                          shown: { transition: { staggerChildren: 0.035 } },
                          hidden: { transition: { staggerChildren: 0.02, staggerDirection: -1 } },
                        }}
                      >
                        {OPTIONS.map((value, index) => (
                          <motion.span
                            key={value}
                            className="theme-switch__name"
                            data-state={
                              index === pointing
                                ? 'pointed'
                                : value === theme
                                  ? 'active'
                                  : undefined
                            }
                            variants={CAPTION_VARIANTS}
                            transition={SPRING}
                          >
                            {nameOf(value)}
                          </motion.span>
                        ))}
                      </motion.div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}

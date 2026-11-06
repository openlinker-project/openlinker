/**
 * LanguageSwitch
 *
 * The operator's language picker (ADR-081): a pill showing the current flag
 * that opens a list of every language with its flag, code and native name.
 * The trigger is flag-only by design; on hover or focus the language's native
 * name slides out beside the flag (and the trigger's accessible name always
 * carries it). Inside a menu - the account menu in the top bar (#4021) - the
 * same list renders inline as `LanguageToggle`, a radio group: a popover
 * opened from inside a Radix menu would close the menu on its first click. Native names, not translated ones, so someone who cannot read the
 * current language still finds theirs. Only languages the app ships are
 * listed. The list is centred on the trigger, rendered in a portal so a
 * clipping parent cannot cut it, and opens downward on the login card or
 * upward when placed low on a screen (`placement`). Motion animates the
 * popover, the sliding selection border and the flag flip; every animation
 * is skipped under `prefers-reduced-motion` through the app's `MotionConfig`.
 *
 * @module shared/ui
 */
import { AnimatePresence, motion } from 'motion/react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import { useMessages } from '../i18n/use-messages';
import { interpolate } from '../i18n/interpolate';
import { LocaleCodeValues, type SupportedLocale } from '../i18n/i18n.types';
import { useOptionalLocale } from '../i18n/use-locale';
import { LanguageFlag, type LanguageFlagCode } from './language-flag';

interface LanguageOption {
  code: LanguageFlagCode;
  /** The language's name in that language. */
  name: string;
  /**
   * The translation is not complete: some screens still fall back to English.
   * Polish carries it until the lock-in step (#3891) makes it complete.
   */
  beta?: boolean;
}

// A Record keyed by `SupportedLocale`: a language added to `LocaleCodeValues`
// without a name here is a compile error instead of a missing list entry.
const LANGUAGE_DETAILS: Record<SupportedLocale, { name: string; beta?: boolean }> = {
  pl: { name: 'Polski', beta: true },
  en: { name: 'English' },
};

const LANGUAGE_OPTIONS: readonly LanguageOption[] = LocaleCodeValues.map((code) => ({
  code,
  ...LANGUAGE_DETAILS[code],
}));

/**
 * A language change remounts the routed tree (`LocaleKeyed`), and the switch
 * is part of that tree, so the focused trigger disappears. The choice leaves a
 * short-lived note; the switch that mounts next takes focus back, so a
 * keyboard user is not dropped on <body>.
 */
const REFOCUS_WINDOW_MS = 1500;
let refocusRequestedAt: number | null = null;

function requestRefocus(): void {
  refocusRequestedAt = Date.now();
}

/**
 * Focuses `element` when a language change was just made, and clears the note
 * once something took focus. A hidden element cannot take focus and leaves
 * the note for one that can. Call from a mount effect.
 */
export function restoreFocusAfterLanguageChange(element: HTMLElement | null): void {
  if (refocusRequestedAt === null) return;
  if (Date.now() - refocusRequestedAt >= REFOCUS_WINDOW_MS) {
    refocusRequestedAt = null;
    return;
  }
  element?.focus();
  if (element !== null && document.activeElement === element) refocusRequestedAt = null;
}

const SPRING = { type: 'spring', stiffness: 520, damping: 34, mass: 0.7 } as const;

/** Matches `.language-switch__popover` width; used to keep it on screen. */
const POPOVER_WIDTH = 200;
const GAP = 8;

/**
 * Fixed position of the list: centred on the trigger, moved inwards only as
 * far as needed to stay inside the viewport.
 */
function popoverPosition(trigger: DOMRect, down: boolean): CSSProperties {
  const half = POPOVER_WIDTH / 2;
  const centre = trigger.left + trigger.width / 2;
  const left = Math.min(Math.max(centre, GAP + half), window.innerWidth - GAP - half);
  return down
    ? { left, top: trigger.bottom + GAP }
    : { left, bottom: window.innerHeight - trigger.top + GAP };
}

const indexOf = (code: string): number =>
  Math.max(
    0,
    LANGUAGE_OPTIONS.findIndex((option) => option.code === code)
  );

/**
 * Narrows a wrapped text box to its widest line. CSS cannot: once text wraps,
 * the box keeps its full max width and leaves empty space beside a centred
 * line. Measured in the box's own (unscaled) pixels, since Motion may be
 * mid-scale when this runs.
 */
function shrinkToText(el: HTMLElement | null): void {
  if (!el) return;
  el.style.width = '';
  const range = document.createRange();
  range.selectNodeContents(el);
  const widest = Math.max(0, ...Array.from(range.getClientRects(), (rect) => rect.width));
  const scale = el.getBoundingClientRect().width / el.offsetWidth || 1;
  const style = getComputedStyle(el);
  const chrome =
    parseFloat(style.paddingLeft) +
    parseFloat(style.paddingRight) +
    parseFloat(style.borderLeftWidth) +
    parseFloat(style.borderRightWidth);
  if (widest > 0) el.style.width = `${Math.ceil(widest / scale + chrome) + 1}px`;
}

/** The next option in `direction`, wrapping at either end. */
function step(from: number, direction: 1 | -1): number {
  const count = LANGUAGE_OPTIONS.length;
  return (from + direction + count) % count;
}

export interface LanguageSwitchProps {
  /** `down` below the trigger (the login card), `up` above it. */
  placement?: 'up' | 'down';
  className?: string;
}

export function LanguageSwitch({
  placement = 'up',
  className,
}: LanguageSwitchProps): ReactElement | null {
  const localeContext = useOptionalLocale();
  const locale = localeContext?.locale ?? 'en';
  const copy = useMessages('ui').languageSwitch;
  const [open, setOpen] = useState(false);
  const [betaHint, setBetaHint] = useState(false);
  const betaHintId = useId();
  const down = placement === 'down';
  const [focus, setFocus] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  // A modal <dialog> (the mobile drawer) sits in the browser's top layer,
  // above anything in <body> whatever its z-index, so the list goes into
  // that dialog when the switch is inside one.
  const [host, setHost] = useState<Element | null>(null);
  const listId = useId();
  const headId = useId();

  const current = LANGUAGE_OPTIONS.find((option) => option.code === locale) ?? LANGUAGE_OPTIONS[0];

  useEffect(() => {
    restoreFocusAfterLanguageChange(triggerRef.current);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      // The list lives in a portal, outside the root, so check both.
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
    const frame = requestAnimationFrame(() => listRef.current?.focus());
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      cancelAnimationFrame(frame);
    };
  }, [open, down]);

  function close(): void {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function choose(option: LanguageOption): void {
    if (option.code !== locale) requestRefocus();
    localeContext?.setLocale(option.code);
    close();
  }

  function toggle(): void {
    // Set before opening, so `aria-activedescendant` names the current
    // language on the very first render of the list.
    if (!open) {
      setFocus(indexOf(locale));
      setHost(triggerRef.current?.closest('dialog') ?? null);
      if (triggerRef.current) {
        setPosition(popoverPosition(triggerRef.current.getBoundingClientRect(), down));
      }
    }
    setOpen((value) => !value);
  }

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setFocus((index) => step(index, 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setFocus((index) => step(index, -1));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(LANGUAGE_OPTIONS[focus]);
    } else if (event.key === 'Tab') {
      // The list is portalled to the end of <body>, so letting Tab run would
      // jump past the page; closing puts focus back on the trigger instead.
      event.preventDefault();
      close();
    }
  }

  if (localeContext === null) return null;

  const classes = ['language-switch', open ? 'is-open' : '', className].filter(Boolean).join(' ');

  return (
    <div className={classes} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="language-switch__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={interpolate(copy.current, { name: current.name })}
        onClick={toggle}
      >
        <span className="language-switch__flag-wrap">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={locale}
              className="language-switch__flag-face"
              initial={{ rotateY: -90, opacity: 0 }}
              animate={{ rotateY: 0, opacity: 1 }}
              exit={{ rotateY: 90, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            >
              <LanguageFlag code={current.code} />
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
      {/* On hover or keyboard focus a wider copy of the pill fades in over the
          trigger, anchored to its right edge, and the language's name unrolls
          to the right of the flag (the connection chip's reveal from the Source
          column). Absolutely positioned, so nothing around it reflows, and it
          grows leftwards, so the sidebar's clipped right edge and the login
          page's corner never cut it off. Decorative: the trigger's accessible
          name already says it, and pointer events pass through to the trigger. */}
      <span
        className="language-switch__peek"
        aria-hidden="true"
        // The peek only shows while the list is closed; its chevron matches the
        // closed trigger's (pointing away from where the list opens).
        style={{ '--peek-chevron': down ? '180deg' : '0deg' } as CSSProperties}
      >
        <LanguageFlag code={current.code} />
        <span className="language-switch__reveal">
          <span className="language-switch__reveal-clip">
            <span className="language-switch__reveal-name" lang={current.code}>
              {current.name}
            </span>
          </span>
        </span>
        <svg className="language-switch__chevron" viewBox="0 0 10 10">
          <path
            d="M2 6.5L5 3.5L8 6.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {createPortal(
        <AnimatePresence>
          {open ? (
            <motion.div
              ref={popoverRef}
              style={position}
              className={['language-switch__popover', down ? 'language-switch__popover--down' : '']
                .filter(Boolean)
                .join(' ')}
              // `x: '-50%'` centres the list on the trigger; Motion owns `transform`,
              // so the CSS cannot do it with its own translate.
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
              {/* The Beta option's description for screen readers. Kept outside the
                rows: a row's grid would otherwise give it a cell of its own. */}
              <span id={betaHintId} className="sr-only">
                {copy.betaHint}
              </span>
              <motion.ul
                ref={listRef}
                id={listId}
                className="language-switch__list"
                role="listbox"
                tabIndex={-1}
                aria-labelledby={headId}
                aria-activedescendant={`${listId}-${LANGUAGE_OPTIONS[focus].code}`}
                onKeyDown={onKeyDown}
                initial="hidden"
                animate="show"
                variants={{ show: { transition: { staggerChildren: 0.035, delayChildren: 0.04 } } }}
              >
                {LANGUAGE_OPTIONS.map((option, index) => {
                  const selected = option.code === locale;
                  return (
                    <motion.li
                      key={option.code}
                      id={`${listId}-${option.code}`}
                      role="option"
                      lang={option.code}
                      aria-selected={selected}
                      aria-describedby={option.beta ? betaHintId : undefined}
                      className={['language-switch__option', index === focus ? 'is-focus' : '']
                        .filter(Boolean)
                        .join(' ')}
                      variants={{
                        hidden: { opacity: 0, x: -8 },
                        show: { opacity: 1, x: 0, transition: SPRING },
                      }}
                      onPointerMove={() => setFocus(index)}
                      onClick={() => choose(option)}
                    >
                      {selected ? (
                        <motion.span
                          className="language-switch__selected"
                          layoutId={`${listId}-selected`}
                          transition={SPRING}
                        />
                      ) : null}
                      <LanguageFlag code={option.code} />
                      <span className="language-switch__name">
                        {option.name}
                        <small>{option.code.toUpperCase()}</small>
                      </span>
                      {option.beta ? (
                        <span
                          className="language-switch__beta"
                          onPointerEnter={() => setBetaHint(true)}
                          onPointerLeave={() => setBetaHint(false)}
                        >
                          {copy.beta}
                        </span>
                      ) : null}
                      {/* A hover popover in the list's own motion language:
                          the same spring, scale and blur, centred over the
                          row. Decorative; screen readers get the same
                          sentence through the option's description. */}
                      <AnimatePresence>
                        {option.beta && betaHint ? (
                          <motion.span
                            ref={shrinkToText}
                            className="language-switch__hint"
                            aria-hidden="true"
                            initial={{ opacity: 0, scale: 0.92, x: '-50%', y: 4, filter: 'blur(4px)' }}
                            animate={{
                              opacity: 1,
                              scale: 1,
                              x: '-50%',
                              y: 0,
                              filter: 'blur(0px)',
                              transition: { ...SPRING, delay: 0.12 },
                            }}
                            exit={{
                              opacity: 0,
                              scale: 0.96,
                              x: '-50%',
                              y: 2,
                              filter: 'blur(2px)',
                              transition: { duration: 0.12 },
                            }}
                          >
                            {copy.betaHint}
                          </motion.span>
                        ) : null}
                      </AnimatePresence>
                    </motion.li>
                  );
                })}
              </motion.ul>
            </motion.div>
          ) : null}
        </AnimatePresence>,
        host ?? document.body
      )}
    </div>
  );
}

export interface LanguageToggleProps {
  className?: string;
}

/**
 * The language list as an inline radio group, for a menu (#4021). Same
 * languages, flags and native names as the popover, and the same keyboard
 * model as `ThemeToggle`: arrows move and select, Home / End jump, only the
 * selected option is in the tab order. A language change remounts the app
 * (`LocaleKeyed`), so the choice leaves a note for the menu trigger to take
 * focus back (`restoreFocusAfterLanguageChange`).
 */
export function LanguageToggle({ className }: LanguageToggleProps): ReactElement | null {
  const localeContext = useOptionalLocale();
  const copy = useMessages('ui').languageSwitch;
  const betaHintId = useId();
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // Stable ref callbacks: a fresh one per render loops under React 19 inside
  // Radix's merged refs (see ThemeToggle, #461).
  const setOptionRef = useMemo(
    () =>
      LANGUAGE_OPTIONS.map((_, index) => (el: HTMLButtonElement | null): void => {
        optionRefs.current[index] = el;
      }),
    []
  );

  if (localeContext === null) return null;
  const { locale, setLocale } = localeContext;

  function choose(index: number): void {
    const option = LANGUAGE_OPTIONS[index];
    if (option.code === locale) return;
    requestRefocus();
    setLocale(option.code);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const last = LANGUAGE_OPTIONS.length - 1;
    let next: number | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = step(index, -1);
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = step(index, 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    if (next === null) return;
    event.preventDefault();
    // Stop the menu's own arrow-key roving from taking over.
    event.stopPropagation();
    optionRefs.current[next]?.focus();
    choose(next);
  }

  const classes = ['language-toggle', className].filter(Boolean).join(' ');

  return (
    <div role="radiogroup" aria-label={copy.label} className={classes}>
      <span id={betaHintId} className="sr-only">
        {copy.betaHint}
      </span>
      {LANGUAGE_OPTIONS.map((option, index) => {
        const selected = option.code === locale;
        return (
          <button
            key={option.code}
            ref={setOptionRef[index]}
            type="button"
            role="radio"
            lang={option.code}
            aria-checked={selected}
            aria-describedby={option.beta ? betaHintId : undefined}
            tabIndex={selected ? 0 : -1}
            className={['language-toggle__option', selected ? 'language-toggle__option--active' : '']
              .filter(Boolean)
              .join(' ')}
            onClick={() => choose(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <LanguageFlag code={option.code} />
            <span className="language-toggle__name">{option.name}</span>
            {option.beta ? (
              <span className="language-toggle__beta" title={copy.betaHint}>
                {copy.beta}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

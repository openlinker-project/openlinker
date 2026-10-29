/**
 * LanguageSwitch
 *
 * The operator's language picker (ADR-079): a pill with the current flag and
 * code that opens a list of every language with its flag, code and native
 * name. Native names, not translated ones, so someone who cannot read the
 * current language still finds theirs. Only languages the app ships are
 * listed. The list is centred on the trigger, rendered in a portal so the
 * sidebar's `overflow: hidden` cannot clip it, and opens upward in the sidebar footer
 * and downward in the signed-out corner (`placement`). Motion animates the
 * popover, the sliding selection border and the flag flip; every animation
 * is skipped under `prefers-reduced-motion` through the app's `MotionConfig`.
 *
 * @module shared/ui
 */
import { AnimatePresence, motion } from 'motion/react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import { useCopy } from '../i18n/use-copy';
import { interpolate } from '../i18n/interpolate';
import { useOptionalLocale } from '../i18n/use-locale';
import { LanguageFlag, type LanguageFlagCode } from './language-flag';
import { uiCopy } from './ui.copy';

interface LanguageOption {
  code: LanguageFlagCode;
  /** The language's name in that language. */
  name: string;
}

const LANGUAGE_OPTIONS: readonly LanguageOption[] = [
  { code: 'pl', name: 'Polski' },
  { code: 'en', name: 'English' },
];

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

/** The next option in `direction`, wrapping at either end. */
function step(from: number, direction: 1 | -1): number {
  const count = LANGUAGE_OPTIONS.length;
  return (from + direction + count) % count;
}

export interface LanguageSwitchProps {
  /** `up` in the sidebar footer, `down` in a top corner. */
  placement?: 'up' | 'down';
  className?: string;
}

export function LanguageSwitch({
  placement = 'up',
  className,
}: LanguageSwitchProps): ReactElement | null {
  const localeContext = useOptionalLocale();
  const locale = localeContext?.locale ?? 'en';
  const copy = useCopy(uiCopy).languageSwitch;
  const [open, setOpen] = useState(false);
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
      setOpen(false);
    }
  }

  if (localeContext === null) return null;

  const classes = ['language-switch', className].filter(Boolean).join(' ');

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
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={locale}
            className="language-switch__code"
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -8, opacity: 0 }}
            transition={SPRING}
          >
            {current.code.toUpperCase()}
          </motion.span>
        </AnimatePresence>
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

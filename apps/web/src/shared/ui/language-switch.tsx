/**
 * LanguageSwitch
 *
 * The operator's language picker (ADR-079): a pill with the current flag and
 * code that opens a list of every language with its flag, code and native
 * name. Native names, not translated ones, so someone who cannot read the
 * current language still finds theirs. Languages without a catalog yet are
 * listed as "Soon" and cannot be picked. Opens upward in the sidebar footer
 * and downward in the signed-out corner (`placement`). Motion animates the
 * popover, the sliding selection border and the flag flip; every animation
 * is skipped under `prefers-reduced-motion` through the app's `MotionConfig`.
 *
 * @module shared/ui
 */
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { useCopy } from '../i18n/use-copy';
import { interpolate } from '../i18n/interpolate';
import { useOptionalLocale } from '../i18n/use-locale';
import { isSupportedLocale, type SupportedLocale } from '../i18n/i18n.types';
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
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'ja', name: '日本語' },
];

const SPRING = { type: 'spring', stiffness: 520, damping: 34, mass: 0.7 } as const;

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
  const [focus, setFocus] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const headId = useId();

  const current = LANGUAGE_OPTIONS.find((option) => option.code === locale) ?? LANGUAGE_OPTIONS[0];

  useEffect(() => {
    if (!open) return undefined;
    setFocus(LANGUAGE_OPTIONS.findIndex((option) => option.code === locale));
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    const frame = requestAnimationFrame(() => listRef.current?.focus());
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      cancelAnimationFrame(frame);
    };
  }, [open, locale]);

  function close(): void {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function choose(option: LanguageOption): void {
    if (!isSupportedLocale(option.code)) return;
    localeContext?.setLocale(option.code as SupportedLocale);
    close();
  }

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setFocus((index) => (index + 1) % LANGUAGE_OPTIONS.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setFocus((index) => (index - 1 + LANGUAGE_OPTIONS.length) % LANGUAGE_OPTIONS.length);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(LANGUAGE_OPTIONS[focus]);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  }

  if (localeContext === null) return null;

  const down = placement === 'down';
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
        onClick={() => setOpen((value) => !value)}
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
      <AnimatePresence>
        {open ? (
          <motion.div
            className={['language-switch__popover', down ? 'language-switch__popover--down' : '']
              .filter(Boolean)
              .join(' ')}
            initial={{ opacity: 0, scale: 0.92, y: down ? -6 : 6, filter: 'blur(4px)' }}
            animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.96, y: down ? -4 : 4, filter: 'blur(2px)', transition: { duration: 0.12 } }}
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
                const available = isSupportedLocale(option.code);
                const selected = option.code === locale;
                return (
                  <motion.li
                    key={option.code}
                    id={`${listId}-${option.code}`}
                    role="option"
                    lang={option.code}
                    aria-selected={selected}
                    aria-disabled={!available}
                    className={[
                      'language-switch__option',
                      index === focus ? 'is-focus' : '',
                      available ? '' : 'is-unavailable',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    variants={{ hidden: { opacity: 0, x: -8 }, show: { opacity: 1, x: 0, transition: SPRING } }}
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
                    {available ? null : <span className="language-switch__soon">{copy.soon}</span>}
                  </motion.li>
                );
              })}
            </motion.ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

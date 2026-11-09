/**
 * LanguageSwitch
 *
 * The operator's language picker (ADR-081), built from the shared switch
 * primitives (#4029): a `PeekButton` showing the current flag that slides out
 * the language's native name on hover, opening a `MotionPopover` with an
 * `OptionList` of every shipped language (flag, native name, code). The list
 * opens upward in the sidebar footer and downward in a top bar (`placement`);
 * inside the mobile drawer's `<dialog>` it renders into that dialog.
 *
 * A language not fully translated yet carries a Beta badge whose hint opens on
 * hover; screen readers get the same sentence as the option's description.
 *
 * @module features/language/components
 */
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useState, type ReactElement } from 'react';
import { interpolate } from '../../../shared/i18n/interpolate';
import type { SupportedLocale } from '../../../shared/i18n/i18n.types';
import { useMessages } from '../../../shared/i18n/use-messages';
import { useOptionalLocale } from '../../../shared/i18n/use-locale';
import { LanguageFlag } from '../../../shared/ui/language-flag';
import { MotionPopover, useAnchoredPopover } from '../../../shared/ui/motion-popover';
import { SNAPPY_SPRING } from '../../../shared/ui/motion-presets';
import { OptionList, type OptionListItem } from '../../../shared/ui/option-list';
import { PeekButton } from '../../../shared/ui/peek-button';
import { LANGUAGE_OPTIONS } from '../hooks/use-language-options';

const POPOVER_WIDTH = 200;

/**
 * A language change remounts the routed tree (`LocaleKeyed`), and the switch
 * is part of that tree, so the focused trigger disappears. The choice leaves a
 * short-lived note; the switch that mounts next takes focus back, so a
 * keyboard user is not dropped on <body>.
 */
const REFOCUS_WINDOW_MS = 1500;
let refocusRequestedAt: number | null = null;

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

export interface LanguageSwitchProps {
  /** `up` in the sidebar footer, `down` in a top corner. */
  placement?: 'up' | 'down';
  /**
   * Which way the hover pill grows: `start` (the default) widens leftwards and
   * suits a right-hand edge; `end` widens rightwards, for a switch with a
   * neighbour on its left it must not cover.
   */
  reveal?: 'start' | 'end';
  /** A 40px capsule on touch screens. */
  touchSize?: boolean;
  className?: string;
}

export function LanguageSwitch({
  placement = 'up',
  reveal = 'start',
  touchSize = false,
  className,
}: LanguageSwitchProps): ReactElement | null {
  const localeContext = useOptionalLocale();
  const locale = localeContext?.locale ?? 'en';
  const copy = useMessages('ui').languageSwitch;
  const popover = useAnchoredPopover({ width: POPOVER_WIDTH, placement });
  const [betaHint, setBetaHint] = useState(false);
  const betaHintId = useId();
  const listId = useId();
  const headId = useId();
  const { anchorRef } = popover;

  const current = LANGUAGE_OPTIONS.find((option) => option.code === locale) ?? LANGUAGE_OPTIONS[0];

  useEffect(() => {
    if (refocusRequestedAt === null) return;
    const fresh = Date.now() - refocusRequestedAt < REFOCUS_WINDOW_MS;
    if (!fresh) {
      refocusRequestedAt = null;
      return;
    }
    anchorRef.current?.focus();
    // A hidden twin (the sidebar's, behind the mobile drawer) cannot take focus
    // and leaves the note for the one that can.
    if (document.activeElement === anchorRef.current) refocusRequestedAt = null;
  }, [anchorRef]);

  if (localeContext === null || !current) return null;

  function choose(code: SupportedLocale): void {
    if (code !== locale) refocusRequestedAt = Date.now();
    localeContext?.setLocale(code);
    popover.close();
  }

  const options: OptionListItem<SupportedLocale>[] = LANGUAGE_OPTIONS.map((option) => ({
    value: option.code,
    label: option.name,
    icon: <LanguageFlag code={option.code} />,
    meta: option.code.toUpperCase(),
    lang: option.code,
    'aria-describedby': option.beta ? betaHintId : undefined,
    badge: option.beta ? (
      <span
        className="language-switch__beta"
        onPointerEnter={() => setBetaHint(true)}
        onPointerLeave={() => setBetaHint(false)}
      >
        {copy.beta}
      </span>
    ) : undefined,
    // A hover popover in the list's own motion language: the same spring,
    // scale and blur, centred over the row. Decorative; screen readers get the
    // same sentence through the option's description.
    extra: option.beta ? (
      <AnimatePresence>
        {betaHint ? (
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
              transition: { ...SNAPPY_SPRING, delay: 0.12 },
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
    ) : undefined,
  }));

  return (
    <>
      <PeekButton
        ref={anchorRef}
        className={['language-switch', className].filter(Boolean).join(' ')}
        icon={<LanguageFlag code={current.code} />}
        iconKey={current.code}
        iconSwap="flip"
        label={current.name}
        labelLang={current.code}
        reveal={reveal}
        open={popover.open}
        placement={placement}
        touchSize={touchSize}
        aria-haspopup="listbox"
        aria-expanded={popover.open}
        aria-controls={popover.open ? listId : undefined}
        aria-label={interpolate(copy.current, { name: current.name })}
        onClick={popover.toggle}
      />
      <MotionPopover
        ref={popover.popoverRef}
        open={popover.open}
        position={popover.position}
        host={popover.host}
        placement={placement}
        width={POPOVER_WIDTH}
        title={copy.label}
        titleId={headId}
      >
        {/* The Beta option's description for screen readers. Kept outside the
            rows: a row's grid would otherwise give it a cell of its own. */}
        <span id={betaHintId} className="sr-only">
          {copy.betaHint}
        </span>
        <OptionList
          id={listId}
          options={options}
          value={current.code}
          onSelect={choose}
          onDismiss={popover.close}
          aria-labelledby={headId}
        />
      </MotionPopover>
    </>
  );
}

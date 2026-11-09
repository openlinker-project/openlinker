/**
 * ThemeSwitch
 *
 * The theme picker for a top bar (#4029), the `LanguageSwitch`'s pair: a
 * `PeekButton` with the current mode's icon that slides out its name on hover,
 * opening a `MotionPopover` with a `SegmentedSwitch` of the three modes. The
 * names show while the switch is pointed at (always on a touch screen). It
 * stays open after a choice, so the page can be seen changing behind it;
 * an outside press, Escape or Tab closes it.
 *
 * Reads the theme context optionally: outside `ThemeProvider` (a bare test
 * render) it renders nothing rather than throwing.
 *
 * @module features/appearance/components
 */
import { useContext, useId, type ReactElement } from 'react';
import { interpolate } from '../../../shared/i18n/interpolate';
import { useMessages } from '../../../shared/i18n/use-messages';
import { ThemeContext } from '../../../shared/theme/theme-provider';
import { MotionPopover, useAnchoredPopover } from '../../../shared/ui/motion-popover';
import { PeekButton } from '../../../shared/ui/peek-button';
import { SegmentedSwitch } from '../../../shared/ui/segmented-switch';
import { useThemeOptions } from '../hooks/use-theme-options';
import { ThemeIcon } from './theme-icon';

const POPOVER_WIDTH = 216;

export interface ThemeSwitchProps {
  /** `down` in a top bar, `up` near the bottom of the screen. */
  placement?: 'up' | 'down';
  reveal?: 'start' | 'end';
  /** A 40px capsule on touch screens. */
  touchSize?: boolean;
  className?: string;
}

export function ThemeSwitch({
  placement = 'down',
  reveal = 'start',
  touchSize = false,
  className,
}: ThemeSwitchProps): ReactElement | null {
  const context = useContext(ThemeContext);
  const copy = useMessages('ui').theme;
  const options = useThemeOptions();
  const popover = useAnchoredPopover({ width: POPOVER_WIDTH, placement });
  const groupId = useId();
  const headId = useId();

  if (context === null) return null;
  const { theme, setTheme } = context;
  const name = copy[theme];

  return (
    <>
      <PeekButton
        ref={popover.anchorRef}
        className={['theme-switch', className].filter(Boolean).join(' ')}
        icon={<ThemeIcon theme={theme} />}
        iconKey={theme}
        iconSwap="spin"
        label={name}
        reveal={reveal}
        open={popover.open}
        placement={placement}
        touchSize={touchSize}
        aria-haspopup="dialog"
        aria-expanded={popover.open}
        aria-controls={popover.open ? groupId : undefined}
        aria-label={interpolate(copy.current, { name })}
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
        className="theme-switch__popover"
      >
        <SegmentedSwitch
          id={groupId}
          options={options}
          value={theme}
          onChange={setTheme}
          labels="hover"
          animateIn
          autoFocus
          onDismiss={popover.close}
          aria-labelledby={headId}
        />
      </MotionPopover>
    </>
  );
}

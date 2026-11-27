/**
 * BackgroundGlowToggle
 *
 * On/off for the brand glow behind the app (`DashboardGlow`), in the account
 * menu under the theme. The same `SegmentedSwitch` as the theme and text-size
 * pickers, so the menu speaks one control language; the choice itself lives in
 * `useBackgroundGlow`.
 *
 * @module app
 */
import { useMemo, type ReactElement } from 'react';
import { useMessages } from '../shared/i18n';
import {
  SegmentedSwitch,
  type SegmentedSwitchOption,
  type SegmentedSwitchSize,
} from '../shared/ui/segmented-switch';
import { useBackgroundGlow } from './hooks/use-background-glow';

type GlowChoice = 'on' | 'off';

// Two overlapping orbs, the glow itself; struck through for "off".
function GlowIcon({ off }: { off: boolean }): ReactElement {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <circle cx="6" cy="6.4" r="4.3" />
        <circle cx="10.6" cy="10.2" r="3.4" />
        {off ? <path d="M2 14L14 2" /> : null}
      </g>
    </svg>
  );
}

export function BackgroundGlowToggle({ size }: { size?: SegmentedSwitchSize } = {}): ReactElement {
  const copy = useMessages('app').userMenu;
  const [enabled, setEnabled] = useBackgroundGlow();
  const options = useMemo<SegmentedSwitchOption<GlowChoice>[]>(
    () => [
      { value: 'on', label: copy.backgroundGlowOn, icon: <GlowIcon off={false} /> },
      { value: 'off', label: copy.backgroundGlowOff, icon: <GlowIcon off /> },
    ],
    [copy]
  );
  return (
    <SegmentedSwitch
      options={options}
      value={enabled ? 'on' : 'off'}
      onChange={(next) => setEnabled(next === 'on')}
      labels="always"
      slideThumb
      size={size}
      aria-label={copy.backgroundGlow}
    />
  );
}

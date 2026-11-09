/**
 * Switch primitives demo (#4029)
 *
 * The four primitives the theme and language switches are built from, shown
 * on their own: PeekButton + MotionPopover + OptionList (a dropdown), and
 * SegmentedSwitch in its three `labels` modes.
 *
 * @module pages/dev-ui/sections
 */
import { useState, type ReactElement } from 'react';
import {
  MotionPopover,
  OptionList,
  PeekButton,
  SegmentedSwitch,
  useAnchoredPopover,
  type OptionListItem,
  type SegmentedSwitchLabels,
  type SegmentedSwitchOption,
} from '../../../shared/ui';

type Channel = 'shop' | 'marketplace' | 'pos';

const DOT = (color: string): ReactElement => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="5" fill={color} />
  </svg>
);

const CHANNELS: OptionListItem<Channel>[] = [
  { value: 'shop', label: 'Online shop', meta: 'SHOP', icon: DOT('var(--accent-primary)') },
  { value: 'marketplace', label: 'Marketplace', meta: 'MKT', icon: DOT('var(--status-info)') },
  { value: 'pos', label: 'Point of sale', meta: 'POS', icon: DOT('var(--status-success)') },
];

const SWITCH_OPTIONS: SegmentedSwitchOption<Channel>[] = CHANNELS.map((option) => ({
  value: option.value,
  label: String(option.label),
  icon: option.icon,
}));

function DropdownDemo(): ReactElement {
  const [value, setValue] = useState<Channel>('shop');
  const popover = useAnchoredPopover({ width: 220, placement: 'down' });
  const current = CHANNELS.find((option) => option.value === value) ?? CHANNELS[0];
  return (
    <>
      <PeekButton
        ref={popover.anchorRef}
        icon={current?.icon}
        iconKey={value}
        iconSwap="spin"
        label={current?.label}
        open={popover.open}
        placement="down"
        aria-haspopup="listbox"
        aria-expanded={popover.open}
        aria-label={`Channel: ${String(current?.label)}`}
        onClick={popover.toggle}
      />
      <MotionPopover
        ref={popover.popoverRef}
        open={popover.open}
        position={popover.position}
        host={popover.host}
        placement="down"
        width={220}
        title="Channel"
      >
        <OptionList
          options={CHANNELS}
          value={value}
          onSelect={(next) => {
            setValue(next);
            popover.close();
          }}
          onDismiss={popover.close}
          aria-label="Channel"
        />
      </MotionPopover>
    </>
  );
}

function SwitchDemo({ labels }: { labels: SegmentedSwitchLabels }): ReactElement {
  const [value, setValue] = useState<Channel>('marketplace');
  return (
    <div style={{ width: 240 }}>
      <SegmentedSwitch
        options={SWITCH_OPTIONS}
        value={value}
        onChange={setValue}
        labels={labels}
        aria-label={`Channel (labels: ${labels})`}
      />
    </div>
  );
}

export function SwitchPrimitivesDemo(): ReactElement {
  return (
    <div className="ds-stack">
      <p className="ds-section__sub">
        <code>PeekButton</code> + <code>MotionPopover</code> + <code>OptionList</code>: hover the
        pill to slide out its name, click to open the list.
      </p>
      <div className="ds-row">
        <DropdownDemo />
      </div>
      <p className="ds-section__sub">
        <code>SegmentedSwitch</code> with <code>labels</code> set to <code>always</code>,{' '}
        <code>hover</code> and <code>none</code>.
      </p>
      <div className="ds-row" style={{ alignItems: 'flex-start', gap: 'var(--space-5)' }}>
        <SwitchDemo labels="always" />
        <SwitchDemo labels="hover" />
        <SwitchDemo labels="none" />
      </div>
    </div>
  );
}

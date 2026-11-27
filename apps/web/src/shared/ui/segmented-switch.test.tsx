/**
 * SegmentedSwitch tests (#4029)
 *
 * @module shared/ui
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SegmentedSwitch,
  type SegmentedSwitchLabels,
  type SegmentedSwitchOption,
} from './segmented-switch';

afterEach(cleanup);

type Mode = 'one' | 'two' | 'three';
const OPTIONS: SegmentedSwitchOption<Mode>[] = [
  { value: 'one', label: 'One', icon: <svg /> },
  { value: 'two', label: 'Two', icon: <svg /> },
  { value: 'three', label: 'Three', icon: <svg /> },
];

function Harness({
  labels,
  onDismiss,
}: {
  labels: SegmentedSwitchLabels;
  onDismiss?: () => void;
}): ReactElement {
  const [value, setValue] = useState<Mode>('two');
  return (
    <SegmentedSwitch
      options={OPTIONS}
      value={value}
      onChange={setValue}
      labels={labels}
      onDismiss={onDismiss}
      aria-label="Mode"
    />
  );
}

const checked = (): string | null =>
  screen
    .getAllByRole('radio')
    .find((r) => r.getAttribute('aria-checked') === 'true')
    ?.getAttribute('aria-label') ?? null;

describe('SegmentedSwitch', () => {
  it('should be a radio group with a roving tab stop on the chosen option', () => {
    render(<Harness labels="none" />);
    expect(screen.getByRole('radiogroup', { name: 'Mode' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Two' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'One' })).toHaveAttribute('tabindex', '-1');
  });

  it('should select with click, arrows (wrapping) and Home/End', () => {
    render(<Harness labels="none" />);
    const group = screen.getByRole('radiogroup');
    fireEvent.click(screen.getByRole('radio', { name: 'One' }));
    expect(checked()).toBe('One');
    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(checked()).toBe('Three');
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(checked()).toBe('One');
    fireEvent.keyDown(group, { key: 'End' });
    expect(checked()).toBe('Three');
    fireEvent.keyDown(group, { key: 'Home' });
    expect(checked()).toBe('One');
  });

  it('should always show the names when labels is "always"', () => {
    render(<Harness labels="always" />);
    const names = [...document.querySelectorAll('.segmented-switch__name')].map(
      (n) => n.textContent
    );
    expect(names).toEqual(['One', 'Two', 'Three']);
  });

  it('should show the names only while pointed at when labels is "hover"', () => {
    render(<Harness labels="hover" />);
    expect(document.querySelector('.segmented-switch__caption')).toBeNull();
    fireEvent.pointerEnter(screen.getByRole('radio', { name: 'One' }));
    expect(document.querySelectorAll('.segmented-switch__name')).toHaveLength(3);
  });

  it('should call onDismiss on Escape and Tab', () => {
    const onDismiss = vi.fn();
    render(<Harness labels="none" onDismiss={onDismiss} />);
    const group = screen.getByRole('radiogroup');
    fireEvent.keyDown(group, { key: 'Escape' });
    fireEvent.keyDown(group, { key: 'Tab' });
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });
});

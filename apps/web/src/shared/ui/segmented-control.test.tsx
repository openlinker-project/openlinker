import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';

import { SegmentedControl, type SegmentedControlOption } from './segmented-control';

afterEach(cleanup);

const options: readonly SegmentedControlOption<'small' | 'medium' | 'large'>[] = [
  { value: 'small', label: 'small', hint: 'A' },
  { value: 'medium', label: 'medium', hint: 'B' },
  { value: 'large', label: 'large', hint: 'C' },
];

describe('SegmentedControl', () => {
  it('should render one option button per option', () => {
    render(<SegmentedControl aria-label="Size" options={options} value="medium" onChange={() => {}} />);
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('should mark the active option pressed and the others not', () => {
    render(<SegmentedControl aria-label="Size" options={options} value="medium" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /medium/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /small/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('should call onChange with the option value when clicked', () => {
    const onChange = vi.fn();
    render(<SegmentedControl aria-label="Size" options={options} value="medium" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /large/i }));
    expect(onChange).toHaveBeenCalledWith('large');
  });

  it('should hide the decorative hint from the accessible name', () => {
    render(<SegmentedControl aria-label="Size" options={options} value="medium" onChange={() => {}} />);
    // Accessible name is the label only; the hint is aria-hidden.
    expect(screen.getByRole('button', { name: 'small' })).toBeInTheDocument();
  });

  it('should forward the ref and spread aria props onto the group', () => {
    const ref = { current: null as HTMLDivElement | null };
    render(
      <SegmentedControl
        ref={ref}
        aria-label="Size"
        aria-describedby="size-desc"
        options={options}
        value="small"
        onChange={() => {}}
      />,
    );
    const group = screen.getByRole('group', { name: 'Size' });
    expect(group).toHaveAttribute('aria-describedby', 'size-desc');
    expect(ref.current).toBe(group);
  });

  it('should merge a custom className with the base class', () => {
    render(
      <SegmentedControl
        aria-label="Size"
        className="custom"
        options={options}
        value="small"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('group', { name: 'Size' })).toHaveClass('segmented-control', 'custom');
  });
});

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
  it('should render one radio option per option', () => {
    render(<SegmentedControl aria-label="Size" options={options} value="medium" onChange={() => {}} />);
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('should mark the active option checked and the others not', () => {
    render(<SegmentedControl aria-label="Size" options={options} value="medium" onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: /medium/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /small/i })).toHaveAttribute('aria-checked', 'false');
  });

  it('should give the group a single tab stop via a roving tabindex', () => {
    render(<SegmentedControl aria-label="Size" options={options} value="medium" onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: /medium/i })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: /small/i })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('radio', { name: /large/i })).toHaveAttribute('tabindex', '-1');
  });

  it('should call onChange with the option value when clicked', () => {
    const onChange = vi.fn();
    render(<SegmentedControl aria-label="Size" options={options} value="medium" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: /large/i }));
    expect(onChange).toHaveBeenCalledWith('large');
  });

  it('should move selection to the next option on ArrowRight', () => {
    const onChange = vi.fn();
    render(<SegmentedControl aria-label="Size" options={options} value="medium" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('radio', { name: /medium/i }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('large');
  });

  it('should wrap to the first option on ArrowRight from the last', () => {
    const onChange = vi.fn();
    render(<SegmentedControl aria-label="Size" options={options} value="large" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('radio', { name: /large/i }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('small');
  });

  it('should move selection to the previous option on ArrowLeft', () => {
    const onChange = vi.fn();
    render(<SegmentedControl aria-label="Size" options={options} value="medium" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('radio', { name: /medium/i }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('small');
  });

  it('should hide the decorative hint from the accessible name', () => {
    render(<SegmentedControl aria-label="Size" options={options} value="medium" onChange={() => {}} />);
    // Accessible name is the label only; the hint is aria-hidden.
    expect(screen.getByRole('radio', { name: 'small' })).toBeInTheDocument();
  });

  it('should forward the ref and spread aria props onto the radiogroup', () => {
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
    const group = screen.getByRole('radiogroup', { name: 'Size' });
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
    expect(screen.getByRole('radiogroup', { name: 'Size' })).toHaveClass('segmented-control', 'custom');
  });
});

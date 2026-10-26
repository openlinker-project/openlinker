/**
 * RangeNumberInput — tests
 *
 * The slider and the number box are one value seen two ways, so every test
 * here drives one control and asserts on the other: drag → box, type → slider,
 * keyboard → both, and the cases where the box must NOT move the slider
 * (empty, out of range) until it is settled on blur / Enter.
 *
 * @module apps/web/src/shared/ui
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RangeNumberInput, type RangeNumberMarker } from './range-number-input';

const NAME = 'Products per run';

function Harness({
  initial = 500,
  min = 1,
  max = 20_000,
  step = 50,
  marker = null,
  onChange,
}: {
  initial?: number;
  min?: number;
  max?: number;
  step?: number;
  marker?: RangeNumberMarker | null;
  onChange?: (value: number) => void;
}): ReactElement {
  const [value, setValue] = useState(initial);
  return (
    <>
      <RangeNumberInput
        value={value}
        min={min}
        max={max}
        step={step}
        marker={marker}
        ariaLabel={NAME}
        onChange={(next) => {
          onChange?.(next);
          setValue(next);
        }}
      />
      <button
        type="button"
        onClick={() => {
          setValue(initial);
        }}
      >
        reset
      </button>
    </>
  );
}

function slider(): HTMLInputElement {
  return screen.getByRole('slider', { name: NAME });
}

function box(): HTMLInputElement {
  return screen.getByRole('spinbutton', { name: NAME });
}

describe('RangeNumberInput', () => {
  it('should update the number box live when the slider is dragged, snapped to the step grid', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    fireEvent.change(slider(), { target: { value: '1520' } });

    expect(onChange).toHaveBeenLastCalledWith(1500);
    expect(box()).toHaveValue(1500);
    expect(slider()).toHaveValue('1500');
  });

  it('should keep both range ends reachable by dragging even when they are off the grid', () => {
    render(<Harness />);

    fireEvent.change(slider(), { target: { value: '3' } });
    expect(box()).toHaveValue(1);

    fireEvent.change(slider(), { target: { value: '20000' } });
    expect(box()).toHaveValue(20_000);
  });

  it('should move the slider as soon as a typed number is inside the range', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.clear(box());
    await user.type(box(), '730');

    // Typing is never snapped to the drag grid.
    expect(slider()).toHaveValue('730');
    expect(onChange).toHaveBeenLastCalledWith(730);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should show an error and leave the slider alone when the box is emptied', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.clear(box());

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a whole number from 1 to 20000.');
    expect(slider()).toHaveValue('500');
    expect(onChange).not.toHaveBeenCalled();
    expect(box()).toHaveAttribute('aria-invalid', 'true');
  });

  it('should restore the value in force when an empty box loses focus', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.clear(box());
    await user.tab();

    expect(box()).toHaveValue(500);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should not move the slider for an out-of-range number, and clamp it on blur', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness min={30} max={365} step={5} initial={90} onChange={onChange} />);

    await user.clear(box());
    await user.type(box(), '500');

    // "5" and "500" are out of range; only "50" in between was a valid number.
    expect(screen.getByRole('alert')).toHaveTextContent('Leaving the field sets it to 365.');
    expect(slider()).toHaveValue('50');

    await user.tab();

    expect(box()).toHaveValue(365);
    expect(slider()).toHaveValue('365');
    expect(onChange).toHaveBeenLastCalledWith(365);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should clamp to the minimum on Enter', async () => {
    const user = userEvent.setup();
    render(<Harness min={30} max={365} step={5} initial={90} />);

    await user.clear(box());
    await user.type(box(), '7{Enter}');

    expect(box()).toHaveValue(30);
    expect(slider()).toHaveValue('30');
  });

  it('should step the slider along the grid from the keyboard', () => {
    render(<Harness initial={505} />);

    fireEvent.keyDown(slider(), { key: 'ArrowLeft' });
    expect(box()).toHaveValue(500);

    fireEvent.keyDown(slider(), { key: 'ArrowRight' });
    expect(box()).toHaveValue(550);

    fireEvent.keyDown(slider(), { key: 'PageUp' });
    expect(box()).toHaveValue(1050);

    fireEvent.keyDown(slider(), { key: 'PageDown' });
    expect(box()).toHaveValue(550);

    fireEvent.keyDown(slider(), { key: 'End' });
    expect(box()).toHaveValue(20_000);

    fireEvent.keyDown(slider(), { key: 'ArrowUp' });
    expect(box()).toHaveValue(20_000);

    fireEvent.keyDown(slider(), { key: 'Home' });
    expect(box()).toHaveValue(1);
  });

  it('should adopt a value changed from outside, replacing what was typed', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.clear(box());
    await user.type(box(), '900');
    await user.click(screen.getByRole('button', { name: 'reset' }));

    expect(box()).toHaveValue(500);
    expect(slider()).toHaveValue('500');
  });

  it('should draw the suggested marker on the track and describe the slider with it', () => {
    render(<Harness marker={{ value: 2000, label: 'suggested ≤ 2000' }} />);

    const label = screen.getByText('suggested ≤ 2000');
    expect(slider().getAttribute('aria-describedby')).toContain(label.id);
    expect(document.querySelector('.range-number__tick')).not.toBeNull();
  });

  it('should draw no marker when it coincides with the end of the range', () => {
    render(<Harness min={30} max={365} marker={{ value: 365, label: 'suggested ≤ 365' }} />);

    expect(screen.queryByText('suggested ≤ 365')).not.toBeInTheDocument();
    expect(document.querySelector('.range-number__tick')).toBeNull();
  });

  it('should keep a native step of 1 so no whole number is a step mismatch', () => {
    render(<Harness />);

    expect(slider()).toHaveAttribute('step', '1');
    expect(box()).toHaveAttribute('step', '1');
  });
});

import { act, cleanup, fireEvent, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import {
  CORRECTION_REASON_MAX_LENGTH,
  CorrectionReasonField,
  countCodePoints,
  useCorrectionReason,
} from './correction-reason-field';
import { renderWithProviders } from '../../../test/test-utils';

afterEach(() => cleanup());

function Harness({ onConfirm }: { onConfirm: (ok: boolean, reason?: string) => void }): ReactElement {
  const state = useCorrectionReason();
  return (
    <>
      <CorrectionReasonField state={state} name="test" />
      <button type="button" onClick={() => onConfirm(state.confirmBeforeSubmit(), state.submittedReason)}>
        submit
      </button>
    </>
  );
}

describe('useCorrectionReason', () => {
  it('should refuse the first empty submit and allow the second', () => {
    const { result } = renderHook(() => useCorrectionReason());

    let first = true;
    act(() => {
      first = result.current.confirmBeforeSubmit();
    });
    expect(first).toBe(false);
    expect(result.current.missingWarned).toBe(true);

    let second = false;
    act(() => {
      second = result.current.confirmBeforeSubmit();
    });
    expect(second).toBe(true);
    expect(result.current.submittedReason).toBeUndefined();
  });

  it('should collapse whitespace in the submitted reason', () => {
    const { result } = renderHook(() => useCorrectionReason());
    act(() => {
      result.current.setReason('  Partial \n\n return  ');
    });
    expect(result.current.submittedReason).toBe('Partial return');
  });

  it('should always refuse a reason past the cap, counted in code points', () => {
    const { result } = renderHook(() => useCorrectionReason());
    act(() => {
      result.current.setReason('😀'.repeat(CORRECTION_REASON_MAX_LENGTH));
    });
    expect(result.current.tooLong).toBe(false);

    act(() => {
      result.current.setReason('😀'.repeat(CORRECTION_REASON_MAX_LENGTH + 1));
    });
    let ok = true;
    act(() => {
      ok = result.current.confirmBeforeSubmit();
    });
    expect(ok).toBe(false);
  });
});

describe('CorrectionReasonField', () => {
  it('should label the field as recommended and show a counter', () => {
    renderWithProviders(<Harness onConfirm={() => undefined} />);
    const textarea = screen.getByLabelText(/Reason for correction/i);
    expect(screen.getByText('(recommended)')).toBeTruthy();
    fireEvent.change(textarea, { target: { value: 'abc' } });
    expect(screen.getByText(`3 / ${CORRECTION_REASON_MAX_LENGTH}`)).toBeTruthy();
    expect(textarea.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('should show the warning after an empty submit and clear it once the operator types', () => {
    renderWithProviders(<Harness onConfirm={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'submit' }));
    expect(screen.getByRole('status').textContent).toMatch(/submit again/i);

    fireEvent.change(screen.getByLabelText(/Reason for correction/i), { target: { value: 'x' } });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('should mark the control invalid past the cap', () => {
    renderWithProviders(<Harness onConfirm={() => undefined} />);
    const textarea = screen.getByLabelText(/Reason for correction/i);
    fireEvent.change(textarea, { target: { value: 'a'.repeat(CORRECTION_REASON_MAX_LENGTH + 1) } });
    expect(textarea.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(/at most 256 characters/i)).toBeTruthy();
  });

  it('countCodePoints should count an emoji once', () => {
    expect(countCodePoints('😀a')).toBe(2);
  });
});

import { render } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { TimeDisplay } from './time-display';

const ISO = '2024-06-15T10:30:00.000Z';

describe('TimeDisplay', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a <time> element with the iso as dateTime attribute', () => {
    const { container } = render(<TimeDisplay iso={ISO} />);
    const el = container.querySelector('time');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('dateTime')).toBe(ISO);
  });

  it('renders datetime format by default', () => {
    const { container } = render(<TimeDisplay iso={ISO} />);
    const el = container.querySelector('time');
    // Should contain both date and time portions — not empty
    expect(el?.textContent).toBeTruthy();
  });

  it('renders date-only format when format="date"', () => {
    const { container } = render(<TimeDisplay iso={ISO} format="date" />);
    const el = container.querySelector('time');
    expect(el?.textContent).toBeTruthy();
  });

  it('renders relative format when format="relative"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T10:35:00.000Z')); // 5 min after ISO
    const { container } = render(<TimeDisplay iso={ISO} format="relative" />);
    const el = container.querySelector('time');
    expect(el?.textContent).toBe('5m ago');
  });
});

import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DemoBanner } from './demo-banner';

describe('DemoBanner', () => {
  it('should render the demo notice text', () => {
    render(<DemoBanner />);
    expect(screen.getByRole('note')).toBeInTheDocument();
    expect(screen.getByText(/demo mode/i)).toBeInTheDocument();
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
  });

  it('should apply the demo-banner class', () => {
    render(<DemoBanner />);
    expect(screen.getByRole('note')).toHaveClass('demo-banner');
  });

  it('should merge a custom className', () => {
    render(<DemoBanner className="custom" />);
    expect(screen.getByRole('note')).toHaveClass('demo-banner', 'custom');
  });

  it('should forward ref to the root div', () => {
    const ref = createRef<HTMLDivElement>();
    render(<DemoBanner ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it('should never render an accept/decline consent prompt (#1743)', () => {
    render(<DemoBanner analyticsActive />);
    expect(screen.queryByText(/accept analytics/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /decline/i })).not.toBeInTheDocument();
  });

  it('should not render the analytics status when analyticsActive is false', () => {
    render(<DemoBanner analyticsActive={false} />);
    expect(screen.queryByText(/analytics on/i)).not.toBeInTheDocument();
  });

  it('should render the analytics status with a Disable affordance when analyticsActive is true', () => {
    render(<DemoBanner analyticsActive />);
    expect(screen.getByText(/analytics on/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /disable/i })).toBeInTheDocument();
  });

  it('should call onDisableAnalytics when Disable is clicked', async () => {
    const onDisableAnalytics = vi.fn();
    render(<DemoBanner analyticsActive onDisableAnalytics={onDisableAnalytics} />);
    await userEvent.click(screen.getByRole('button', { name: /disable/i }));
    expect(onDisableAnalytics).toHaveBeenCalledTimes(1);
  });
});

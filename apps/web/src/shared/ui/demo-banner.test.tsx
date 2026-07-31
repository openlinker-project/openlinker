import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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

  it('should never render a consent prompt or an opt-out affordance (#1743, #1938)', () => {
    render(<DemoBanner />);
    expect(screen.queryByText(/accept analytics/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/analytics on/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /disable/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /decline/i })).not.toBeInTheDocument();
  });
});

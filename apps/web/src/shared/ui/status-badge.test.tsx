import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBadge } from './status-badge';

describe('StatusBadge', () => {
  it('renders text with the correct tone class', () => {
    render(<StatusBadge tone="success">healthy</StatusBadge>);

    expect(screen.getByText('healthy')).toBeInTheDocument();
    expect(screen.getByText('healthy').closest('.status-badge')).toHaveClass('status-badge--success');
  });

  it('renders a dot when requested', () => {
    render(<StatusBadge tone="warning" withDot>pending</StatusBadge>);

    expect(screen.getByText('pending').closest('.status-badge')?.querySelector('.status-badge__dot')).not.toBeNull();
  });
});

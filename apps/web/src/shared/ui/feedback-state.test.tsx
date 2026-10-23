import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ACCESS_DENIED_DEFAULT_COPY, AccessDeniedState, ErrorState } from './feedback-state';

afterEach(cleanup);

describe('AccessDeniedState', () => {
  it('should render as a status with the default copy and no button when given no props', () => {
    render(<AccessDeniedState />);

    const state = screen.getByRole('status');
    expect(state).toHaveClass('state-card', 'state-card--denied');
    expect(screen.getByRole('heading', { name: ACCESS_DENIED_DEFAULT_COPY.title })).toBeInTheDocument();
    expect(screen.getByText(ACCESS_DENIED_DEFAULT_COPY.message)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('should render the caller copy and action when they are given', () => {
    render(
      <AccessDeniedState
        title="Packing lives on the bench"
        message="This screen is for supervisors."
        action={<a href="/bench">Go to the pack bench</a>}
      />
    );

    expect(screen.getByRole('heading', { name: 'Packing lives on the bench' })).toBeInTheDocument();
    expect(screen.getByText('This screen is for supervisors.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the pack bench' })).toHaveAttribute('href', '/bench');
  });
});

describe('ErrorState', () => {
  it('should stay an alert when rendered', () => {
    render(<ErrorState title="Broken" message="It broke." />);
    expect(screen.getByRole('alert')).toHaveClass('state-card--error');
  });
});

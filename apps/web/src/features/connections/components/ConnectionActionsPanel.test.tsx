import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders, sampleConnection } from '../../../test/test-utils';
import { ConnectionActionsPanel } from './ConnectionActionsPanel';

describe('ConnectionActionsPanel', () => {
  afterEach(cleanup);

  it('renders edit and disable actions for an active connection', () => {
    renderWithProviders(<ConnectionActionsPanel connection={sampleConnection} />);

    expect(screen.getByRole('link', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disable' })).toBeInTheDocument();
  });

  it('hides disable button when connection is already disabled', () => {
    const disabledConnection = { ...sampleConnection, status: 'disabled' as const };
    renderWithProviders(<ConnectionActionsPanel connection={disabledConnection} />);

    expect(screen.getByRole('link', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disable' })).not.toBeInTheDocument();
  });

  it('links edit action to the correct URL', () => {
    renderWithProviders(<ConnectionActionsPanel connection={sampleConnection} />);

    const editLink = screen.getByRole('link', { name: 'Edit' });
    expect(editLink).toHaveAttribute('href', `/connections/${sampleConnection.id}/edit`);
  });
});

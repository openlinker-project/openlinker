import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/test-utils';
import { SettingsIndexList, SettingsIndexRow } from './settings-index-row';

afterEach(cleanup);

function renderRow(row: React.ReactElement): void {
  renderWithProviders(<SettingsIndexList>{row}</SettingsIndexList>);
}

describe('SettingsIndexRow', () => {
  it('should render the title, description, value, note and a link action', () => {
    renderRow(
      <SettingsIndexRow
        title="Sync pacing"
        description="How hard OpenLinker works your shop."
        value="500"
        note="Products per run"
        action={{ label: 'Adjust pacing', to: '/settings/sync-pacing' }}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Sync pacing' })).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.getByText('Products per run')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Adjust pacing' })).toHaveAttribute(
      'href',
      '/settings/sync-pacing',
    );
  });

  it('should call onClick for a button action', () => {
    const onClick = vi.fn();
    renderRow(<SettingsIndexRow title="Mailer" action={{ label: 'Edit', onClick }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('should offer no action and explain the lock when locked', () => {
    renderRow(
      <SettingsIndexRow
        locked
        title="Mailer"
        description="Outbound mail."
        action={{ label: 'Edit', onClick: vi.fn() }}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Administrators only/ })).toBeInTheDocument();
    expect(screen.getByText('Outbound mail.')).toBeInTheDocument();
  });

  it('should show a skeleton with spoken text while the value loads', () => {
    renderRow(<SettingsIndexRow title="Currency" valueState="loading" stateText="Loading currency" />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading currency');
  });

  it('should mark only the value as failed when the read errors', () => {
    renderRow(
      <>
        <SettingsIndexRow title="Currency" valueState="error" stateText="Could not load." />
        <SettingsIndexRow title="Tags" value="3" />
      </>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load.');
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('should render the value as a toned status chip with a quiet note', () => {
    renderRow(<SettingsIndexRow title="Mailer" value="Console" tone="warning" note="Not for production" />);

    expect(screen.getByText('Console')).toHaveAttribute('data-tone', 'warning');
    expect(screen.getByText('Not for production')).toBeInTheDocument();
  });
});

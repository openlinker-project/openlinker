/**
 * ErliBulkRowSection tests (#1096)
 *
 * The per-row dispatch override is toggle-gated: OFF ⇒ no `dispatchTime` in
 * `platformParams` (the row inherits the batch default at submit); ON ⇒ a
 * `dispatchTime` is emitted. Controlled — assertions are on the `onChange`
 * payload, not internal state.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { renderWithProviders } from '../../../../test/test-utils';
import { ErliBulkRowSection } from './erli-bulk-row-section';
import type { Connection } from '../../../connections';

const connection = {
  id: 'conn_erli',
  name: 'My Erli',
  platformType: 'erli',
  status: 'active',
  config: { defaultDispatchTime: { period: 2, unit: 'day' } },
  credentialsBacked: true,
  enabledCapabilities: ['OfferManager'],
  supportedCapabilities: ['OfferManager'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as Connection;

describe('ErliBulkRowSection', () => {
  it('starts OFF with no override and emits a dispatchTime when toggled on', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <ErliBulkRowSection connection={connection} platformParams={{}} onChange={onChange} />,
    );

    const toggle = screen.getByRole('checkbox');
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as { dispatchTime?: unknown };
    expect(next.dispatchTime).toEqual({ period: 2, unit: 'day' }); // seeded from connection default
  });

  it('shows the toggle ON when the row already carries a dispatch override', () => {
    renderWithProviders(
      <ErliBulkRowSection
        connection={connection}
        platformParams={{ dispatchTime: { period: 5, unit: 'day' } }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('drops dispatchTime when toggled off so the row inherits the batch default', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <ErliBulkRowSection
        connection={connection}
        platformParams={{ dispatchTime: { period: 5, unit: 'day' }, other: 'keep' }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as Record<string, unknown>;
    expect(next).not.toHaveProperty('dispatchTime');
    expect(next.other).toBe('keep'); // unrelated platformParams preserved
  });
});

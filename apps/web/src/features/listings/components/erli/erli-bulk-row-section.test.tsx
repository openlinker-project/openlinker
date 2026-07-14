/**
 * ErliBulkRowSection tests (#1096, #1531)
 *
 * The per-row dispatch and producer overrides are each toggle-gated: OFF ⇒ no
 * key in `platformParams` (the row inherits the batch default at submit); ON ⇒
 * a value is emitted. Controlled — assertions are on the `onChange` payload,
 * not internal state.
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

const dispatchToggle = (): HTMLElement =>
  screen.getByRole('checkbox', { name: /custom dispatch time/i });
const producerToggle = (): HTMLElement =>
  screen.getByRole('checkbox', { name: /custom producer/i });

describe('ErliBulkRowSection', () => {
  it('starts OFF with no override and emits a dispatchTime when toggled on', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <ErliBulkRowSection connection={connection} platformParams={{}} onChange={onChange} />,
    );

    const toggle = dispatchToggle();
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
    expect(dispatchToggle()).toBeChecked();
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

    fireEvent.click(dispatchToggle());
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as Record<string, unknown>;
    expect(next).not.toHaveProperty('dispatchTime');
    expect(next.other).toBe('keep'); // unrelated platformParams preserved
  });

  describe('producer override (#1531)', () => {
    it('starts OFF (inherits batch default) with no producer key present', () => {
      const onChange = vi.fn();
      renderWithProviders(
        <ErliBulkRowSection connection={connection} platformParams={{}} onChange={onChange} />,
      );

      const toggle = producerToggle();
      expect(toggle).not.toBeChecked();
      expect(screen.getByText(/uses the batch default producer/i)).toBeInTheDocument();
    });

    it('emits an empty producer override (opting out of the batch default) when toggled on', () => {
      const onChange = vi.fn();
      renderWithProviders(
        <ErliBulkRowSection connection={connection} platformParams={{}} onChange={onChange} />,
      );

      fireEvent.click(producerToggle());
      expect(onChange).toHaveBeenCalledTimes(1);
      const next = onChange.mock.calls[0][0] as Record<string, unknown>;
      expect(next).toHaveProperty('producer', '');
    });

    it('shows the producer toggle ON when the row already carries a producer override', () => {
      renderWithProviders(
        <ErliBulkRowSection
          connection={connection}
          platformParams={{ producer: '42' }}
          onChange={vi.fn()}
        />,
      );
      expect(producerToggle()).toBeChecked();
    });

    it('resets to the batch default (drops the producer key) via the reset affordance', () => {
      const onChange = vi.fn();
      renderWithProviders(
        <ErliBulkRowSection
          connection={connection}
          platformParams={{ producer: '42', other: 'keep' }}
          onChange={onChange}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: /reset to batch default/i }));
      expect(onChange).toHaveBeenCalledTimes(1);
      const next = onChange.mock.calls[0][0] as Record<string, unknown>;
      expect(next).not.toHaveProperty('producer');
      expect(next.other).toBe('keep'); // unrelated platformParams preserved
    });
  });
});

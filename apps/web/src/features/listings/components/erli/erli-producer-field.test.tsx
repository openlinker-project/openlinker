/**
 * ErliProducerField tests (#1531)
 *
 * Covers the live per-connection fetch, the empty-state direction copy, the
 * options render, and the `onChange` contract (selecting by producer id).
 */
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders, createMockApiClient } from '../../../../test/test-utils';
import { ErliProducerField } from './erli-producer-field';

afterEach(() => {
  cleanup();
});

describe('ErliProducerField', () => {
  it('renders the fetched producers as options', async () => {
    const apiClient = createMockApiClient({
      listings: {
        getResponsibleProducers: vi.fn().mockResolvedValue({
          responsibleProducers: [
            { id: '1', name: 'ACME Sp. z o.o.', kind: 'PRODUCER' },
            { id: '42', name: 'Importer Ltd', kind: 'PRODUCER' },
          ],
        }),
      },
    });

    renderWithProviders(
      <ErliProducerField connectionId="conn_erli_1" value="" onChange={vi.fn()} />,
      { apiClient },
    );

    expect(await screen.findByRole('option', { name: 'ACME Sp. z o.o.' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Importer Ltd' })).toBeInTheDocument();
  });

  it('shows a directive empty state when the account has no producers', async () => {
    const apiClient = createMockApiClient({
      listings: {
        getResponsibleProducers: vi.fn().mockResolvedValue({ responsibleProducers: [] }),
      },
    });

    renderWithProviders(
      <ErliProducerField connectionId="conn_erli_1" value="" onChange={vi.fn()} />,
      { apiClient },
    );

    expect(
      await screen.findByText(/No producers on this Erli account/i),
    ).toBeInTheDocument();
  });

  it('calls onChange with the selected producer id', async () => {
    const onChange = vi.fn();
    const apiClient = createMockApiClient({
      listings: {
        getResponsibleProducers: vi.fn().mockResolvedValue({
          responsibleProducers: [{ id: '42', name: 'Importer Ltd', kind: 'PRODUCER' }],
        }),
      },
    });

    renderWithProviders(
      <ErliProducerField connectionId="conn_erli_1" value="" onChange={onChange} />,
      { apiClient },
    );

    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: '42' } });

    expect(onChange).toHaveBeenCalledWith('42');
  });
});

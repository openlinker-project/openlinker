/**
 * MarketplacePickerModal tests (#1096)
 */
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/test-utils';
import { MarketplacePickerModal } from './marketplace-picker-modal';
import type { Connection } from '../../features/connections';

function conn(id: string, platformType: string, name: string): Connection {
  return {
    id,
    name,
    platformType,
    status: 'active',
    config: {},
    credentialsBacked: true,
    adapterKey: `${platformType}.v1`,
    enabledCapabilities: ['OfferManager'],
    supportedCapabilities: ['OfferManager'],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

describe('MarketplacePickerModal', () => {
  afterEach(cleanup);

  it('lists each OfferManager connection and continues with the chosen one', () => {
    const onContinue = vi.fn();
    renderWithProviders(
      <MarketplacePickerModal
        open
        onOpenChange={vi.fn()}
        productCount={6}
        connections={[conn('c1', 'allegro', 'My Allegro'), conn('c2', 'erli', 'My Erli')]}
        onContinue={onContinue}
      />,
    );

    expect(screen.getByText('My Allegro')).toBeInTheDocument();
    expect(screen.getByText('My Erli')).toBeInTheDocument();

    // Continue is disabled until a marketplace is picked.
    const continueBtn = screen.getByRole('button', { name: /continue/i });
    expect(continueBtn).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: /My Erli/ }));
    expect(continueBtn).toBeEnabled();
    fireEvent.click(continueBtn);

    expect(onContinue).toHaveBeenCalledWith('c2');
  });
});

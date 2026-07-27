/**
 * MarketplacePickerModal tests (#1096, grouped for #1828)
 */
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/test-utils';
import { MarketplacePickerModal } from './marketplace-picker-modal';
import type { Connection } from '../../features/connections';
import type { PublishDestination, PublishDestinationKind } from '../../features/listings';

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

function dest(
  id: string,
  platformType: string,
  name: string,
  kind: PublishDestinationKind,
): PublishDestination {
  return { connection: conn(id, platformType, name), kind };
}

describe('MarketplacePickerModal', () => {
  afterEach(cleanup);

  it('lists each destination and continues with the chosen one', () => {
    const onContinue = vi.fn();
    renderWithProviders(
      <MarketplacePickerModal
        open
        onOpenChange={vi.fn()}
        productCount={6}
        destinations={[
          dest('c1', 'allegro', 'My Allegro', 'marketplace'),
          dest('c2', 'erli', 'My Erli', 'marketplace'),
        ]}
        onContinue={onContinue}
      />,
    );

    expect(screen.getByText('My Allegro')).toBeInTheDocument();
    expect(screen.getByText('My Erli')).toBeInTheDocument();

    // Continue is disabled until a destination is picked.
    const continueBtn = screen.getByRole('button', { name: /continue/i });
    expect(continueBtn).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: /My Erli/ }));
    expect(continueBtn).toBeEnabled();
    fireEvent.click(continueBtn);

    expect(onContinue).toHaveBeenCalledWith('c2');
  });

  it('groups marketplaces and online shops with capability-driven hints', () => {
    renderWithProviders(
      <MarketplacePickerModal
        open
        onOpenChange={vi.fn()}
        productCount={2}
        destinations={[
          dest('c1', 'allegro', 'My Allegro', 'marketplace'),
          dest('c3', 'woocommerce', 'My Shop', 'shop'),
        ]}
        onContinue={vi.fn()}
      />,
    );

    expect(screen.getByText('Marketplaces')).toBeInTheDocument();
    expect(screen.getByText('Online shops')).toBeInTheDocument();
    expect(screen.getByText('Offer marketplace')).toBeInTheDocument();
    expect(screen.getByText('Online shop')).toBeInTheDocument();
  });
});

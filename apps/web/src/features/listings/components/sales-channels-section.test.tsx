/**
 * Tests for SalesChannelsSection (#3962): where a product deleted at the
 * source is still on sale, and putting it back on sale.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../../shared/api/api-error';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { ListingSaleRow, ProductSaleStatusResponse } from '../api/listings.types';
import { SalesChannelsSection, type SalesChannelsVariant } from './sales-channels-section';

const connections = [
  { id: 'c-allegro', name: 'Konto główne', platformType: 'allegro', config: { environment: 'production' } },
  { id: 'c-woo', name: 'Hurtownia', platformType: 'woocommerce', config: {} },
];

const variants: SalesChannelsVariant[] = [{ id: 'v1', sku: 'BLZ-CLS', attributes: null, isStale: true }];

const row = (over: Partial<ListingSaleRow>): ListingSaleRow => ({
  connectionId: 'c-allegro',
  entityType: 'Offer',
  externalId: '14823901',
  externalParentId: null,
  internalVariantId: 'v1',
  channelStatus: 'ended',
  quantity: 0,
  lastCheckedAt: '2026-11-05T10:02:00Z',
  hold: { id: 'h1', method: 'stock_zero', outcome: 'applied', outcomeReason: null, appliedAt: '2026-11-05T09:14:00Z' },
  state: 'off_sale',
  ...over,
});

const status = (over: Partial<ProductSaleStatusResponse>): ProductSaleStatusResponse => ({
  productId: 'p1',
  deletedAtSource: true,
  deletedAt: '2026-11-05T09:14:00Z',
  staleVariantIds: ['v1'],
  staleSkus: ['BLZ-CLS'],
  ordersSinceDeletion: 2,
  checkedAt: '2026-11-05T10:02:00Z',
  rows: [],
  ...over,
});

function setup(response: ProductSaleStatusResponse, extra: Record<string, unknown> = {}) {
  const apiClient = createMockApiClient({
    listings: { getProductSaleStatus: vi.fn().mockResolvedValue(response), ...extra } as never,
    connections: { list: vi.fn().mockResolvedValue(connections) } as never,
  });
  renderWithProviders(
    <SalesChannelsSection productId="p1" variants={variants} sourceName="PrestaShop" canWrite />,
    { apiClient },
  );
  return apiClient;
}

describe('SalesChannelsSection', () => {
  it('should say where the product still sells and why when a channel could not be stopped', async () => {
    setup(
      status({
        rows: [
          row({}),
          row({
            connectionId: 'c-woo',
            entityType: 'ShopProduct',
            externalId: '1207',
            channelStatus: 'published',
            quantity: null,
            hold: { id: 'h2', method: 'none', outcome: 'not_possible', outcomeReason: 'stock_sync_off', appliedAt: '2026-11-05T09:14:00Z' },
            state: 'on_sale',
          }),
        ],
      }),
    );

    expect(await screen.findByText('On sale on 1 of 2 channels')).toBeInTheDocument();
    expect(screen.getByText('Needs action')).toBeInTheDocument();
    expect(screen.getByText('Stock sync is off')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Turn on stock sync' })).toHaveAttribute('href', '/connections/c-woo/edit');
    expect(screen.getByRole('link', { name: '2 orders since deletion' })).toHaveAttribute(
      'href',
      '/orders?search=BLZ-CLS',
    );
  });

  it('should collapse to one line when nothing sells any more', async () => {
    setup(status({ ordersSinceDeletion: 0, rows: [row({})] }));

    expect(await screen.findByText('Off sale on all 1 channel')).toBeInTheDocument();
    expect(screen.queryByText('Konto główne')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show channels' }));
    expect(await screen.findByText('Konto główne')).toBeInTheDocument();
  });

  it('should put only the checked channels back on sale when the product came back', async () => {
    const release = vi.fn().mockResolvedValue({ released: ['h1'], failed: [] });
    setup(
      status({
        deletedAtSource: false,
        staleVariantIds: [],
        staleSkus: [],
        ordersSinceDeletion: null,
        rows: [row({}), row({ connectionId: 'c-woo', entityType: 'ShopProduct', externalId: '482', hold: { id: 'h2', method: 'unpublished', outcome: 'applied', outcomeReason: null, appliedAt: '2026-11-05T09:14:00Z' } })],
      }),
      { releaseSaleHolds: release },
    );

    expect(await screen.findByText('Back in PrestaShop, not on sale anywhere')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Put back on sale on Hurtownia' }));
    await userEvent.click(screen.getByRole('button', { name: 'Put back on sale on 1 channel' }));
    expect(release).toHaveBeenCalledWith('p1', ['h1']);
  });

  it('should render nothing while the product is live and nothing is held', async () => {
    const read = vi
      .fn()
      .mockResolvedValue(status({ deletedAtSource: false, rows: [row({ hold: null, state: 'on_sale' })] }));
    const { container } = renderWithProviders(
      <SalesChannelsSection productId="p1" variants={[]} sourceName="PrestaShop" canWrite />,
      {
        apiClient: createMockApiClient({
          listings: { getProductSaleStatus: read } as never,
          connections: { list: vi.fn().mockResolvedValue(connections) } as never,
        }),
      },
    );
    await waitFor(() => expect(read).toHaveBeenCalledWith('p1'));
    expect(container.querySelector('.sales-channels')).toBeNull();
  });

  const cameBack = (): ProductSaleStatusResponse =>
    status({
      deletedAtSource: false,
      staleVariantIds: [],
      staleSkus: [],
      ordersSinceDeletion: null,
      rows: [row({})],
    });

  it('should say the read failed instead of staying silent when sale status cannot be loaded', async () => {
    const apiClient = createMockApiClient({
      listings: { getProductSaleStatus: vi.fn().mockRejectedValue(new Error('down')) } as never,
      connections: { list: vi.fn().mockResolvedValue(connections) } as never,
    });
    renderWithProviders(
      <SalesChannelsSection productId="p1" variants={variants} sourceName="PrestaShop" canWrite />,
      { apiClient },
    );
    expect(await screen.findByText('Could not check where this product is on sale')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('should not offer to put a product back on sale to a viewer', async () => {
    const apiClient = createMockApiClient({
      listings: { getProductSaleStatus: vi.fn().mockResolvedValue(cameBack()) } as never,
      connections: { list: vi.fn().mockResolvedValue(connections) } as never,
    });
    renderWithProviders(
      <SalesChannelsSection productId="p1" variants={variants} sourceName="PrestaShop" canWrite={false} />,
      { apiClient },
    );
    expect(await screen.findByText('Back in PrestaShop, not on sale anywhere')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Put back on sale/ })).not.toBeInTheDocument();
  });

  it('should show the coded refusal when the product is still deleted at the source', async () => {
    const release = vi
      .fn()
      .mockRejectedValue(new ApiError('refused', 409, { code: 'SALE_HOLD_RELEASE_REFUSED' }));
    setup(cameBack(), { releaseSaleHolds: release });
    await userEvent.click(await screen.findByRole('button', { name: 'Put back on sale on 1 channel' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('still deleted at the source');
  });

  it('should name the channels that could not be put back when the release answers partially', async () => {
    const release = vi
      .fn()
      .mockResolvedValue({ released: [], failed: [{ holdId: 'h1', message: 'x' }] });
    setup(cameBack(), { releaseSaleHolds: release });
    await userEvent.click(await screen.findByRole('button', { name: 'Put back on sale on 1 channel' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Konto główne');
  });

  it('should disable the button while the release is running', async () => {
    const release = vi.fn().mockReturnValue(new Promise(() => undefined));
    setup(cameBack(), { releaseSaleHolds: release });
    await userEvent.click(await screen.findByRole('button', { name: 'Put back on sale on 1 channel' }));
    expect(await screen.findByRole('button', { name: 'Putting back on sale...' })).toBeDisabled();
  });
});

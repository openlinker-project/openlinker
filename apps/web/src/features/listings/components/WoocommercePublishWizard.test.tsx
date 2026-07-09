/**
 * WoocommercePublishWizard Tests
 *
 * Covers the content-only shop-publish wizard (#1044):
 *   - single submit calls shopPublish + onSubmitted with the recordId
 *   - bulk submit calls shopPublishBulk + onSubmitted with the batchId
 *   - stock validation rejects negative / non-integer values
 *
 * @module apps/web/src/features/listings/components
 */
import { screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import { WoocommercePublishWizard } from './WoocommercePublishWizard';
import type { Connection } from '../../connections';

const wooConnection: Connection = {
  id: 'conn_woo_1',
  name: 'Main WooCommerce store',
  platformType: 'woocommerce',
  status: 'active',
  config: {},
  credentialsBacked: true,
  adapterKey: 'woocommerce.restapi.v3',
  enabledCapabilities: ['ProductPublisher'],
  supportedCapabilities: ['ProductPublisher'],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('WoocommercePublishWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('submits a single publish and reports the recordId', async () => {
    const shopPublish = vi
      .fn()
      .mockResolvedValue({ jobId: 'job-1', listingCreationRecordId: 'rec-9' });
    const onSubmitted = vi.fn();
    const apiClient = createMockApiClient({ listings: { shopPublish } });

    renderWithProviders(
      <WoocommercePublishWizard
        connection={wooConnection}
        defaultVariantId="ol_variant_1"
        onCancel={vi.fn()}
        onSubmitted={onSubmitted}
      />,
      { apiClient },
    );

    fireEvent.click(await screen.findByRole('button', { name: /^publish$/i }));

    await waitFor(() => {
      expect(shopPublish).toHaveBeenCalledTimes(1);
    });
    const [connectionId, body] = shopPublish.mock.calls[0];
    expect(connectionId).toBe('conn_woo_1');
    expect(body).toMatchObject({
      internalVariantId: 'ol_variant_1',
      status: 'published',
      stock: 0,
    });
    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledWith({ recordId: 'rec-9' }, 'conn_woo_1');
    });
  });

  it('submits a bulk publish and reports the batchId', async () => {
    const shopPublishBulk = vi.fn().mockResolvedValue({ batchId: 'batch-7', items: [] });
    const onSubmitted = vi.fn();
    const apiClient = createMockApiClient({ listings: { shopPublishBulk } });

    renderWithProviders(
      <WoocommercePublishWizard
        connection={wooConnection}
        defaultVariantIds={['ol_variant_1', 'ol_variant_2', 'ol_variant_3']}
        onCancel={vi.fn()}
        onSubmitted={onSubmitted}
      />,
      { apiClient },
    );

    fireEvent.click(await screen.findByRole('button', { name: /publish 3 products/i }));

    await waitFor(() => {
      expect(shopPublishBulk).toHaveBeenCalledTimes(1);
    });
    const [body] = shopPublishBulk.mock.calls[0];
    expect(body).toMatchObject({
      connectionId: 'conn_woo_1',
      items: [
        { internalVariantId: 'ol_variant_1', stock: 0 },
        { internalVariantId: 'ol_variant_2', stock: 0 },
        { internalVariantId: 'ol_variant_3', stock: 0 },
      ],
      status: 'draft',
    });
    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledWith({ batchId: 'batch-7' }, 'conn_woo_1');
    });
  });

  it('gives each product its own stock/price row in bulk Configure, independent of the others (#1414)', async () => {
    const shopPublishBulk = vi.fn().mockResolvedValue({ batchId: 'batch-7', items: [] });
    const apiClient = createMockApiClient({ listings: { shopPublishBulk } });

    renderWithProviders(
      <WoocommercePublishWizard
        connection={wooConnection}
        defaultVariantIds={['ol_variant_1', 'ol_variant_2']}
        onCancel={vi.fn()}
        onSubmitted={vi.fn()}
      />,
      { apiClient },
    );

    const stockInputs = await screen.findAllByPlaceholderText('master');
    // 2 products × (stock, price) = 4 inputs; stock inputs are the even ones.
    fireEvent.change(stockInputs[0], { target: { value: '12' } });

    fireEvent.click(await screen.findByRole('button', { name: /publish 2 products/i }));

    await waitFor(() => {
      expect(shopPublishBulk).toHaveBeenCalledTimes(1);
    });
    const [body] = shopPublishBulk.mock.calls[0];
    expect(body.items).toEqual([
      { internalVariantId: 'ol_variant_1', stock: 12 },
      { internalVariantId: 'ol_variant_2', stock: 0 },
    ]);
  });

  it('removes a product from the batch via its row remove button', async () => {
    const shopPublishBulk = vi.fn().mockResolvedValue({ batchId: 'batch-7', items: [] });
    const apiClient = createMockApiClient({ listings: { shopPublishBulk } });

    renderWithProviders(
      <WoocommercePublishWizard
        connection={wooConnection}
        defaultVariantIds={['ol_variant_1', 'ol_variant_2']}
        onCancel={vi.fn()}
        onSubmitted={vi.fn()}
      />,
      { apiClient },
    );

    await screen.findByRole('button', { name: /publish 2 products/i });
    fireEvent.click((await screen.findAllByRole('button', { name: /remove.*from batch/i }))[0]);

    fireEvent.click(await screen.findByRole('button', { name: /publish 1 product/i }));

    await waitFor(() => {
      expect(shopPublishBulk).toHaveBeenCalledTimes(1);
    });
    const [body] = shopPublishBulk.mock.calls[0];
    expect(body.items).toEqual([{ internalVariantId: 'ol_variant_2', stock: 0 }]);
  });

  it('shows a searchable multi-select picker and lets the operator check one or more variants when opened without a default variant', async () => {
    const shopPublish = vi
      .fn()
      .mockResolvedValue({ jobId: 'job-1', listingCreationRecordId: 'rec-9' });
    const products = {
      list: vi.fn().mockResolvedValue({
        items: [{ id: 'prod_1', name: 'Red Shirt', sku: 'RS-1', price: 19.99, currency: 'PLN' }],
        total: 1,
        limit: 10,
        offset: 0,
      }),
      getById: vi.fn().mockResolvedValue({
        id: 'prod_1',
        name: 'Red Shirt',
        sku: 'RS-1',
        price: 19.99,
        currency: 'PLN',
        variants: [
          { id: 'ol_variant_9', productId: 'prod_1', sku: 'RS-1-M', ean: null, gtin: null, price: 19.99 },
        ],
      }),
    };
    const apiClient = createMockApiClient({ listings: { shopPublish }, products });

    renderWithProviders(
      <WoocommercePublishWizard
        connection={wooConnection}
        onCancel={vi.fn()}
        onSubmitted={vi.fn()}
      />,
      { apiClient },
    );

    // Continue is disabled until at least one variant is checked.
    expect(
      await screen.findByRole('button', { name: /continue with 0 products/i }),
    ).toBeDisabled();

    fireEvent.click(await screen.findByText('Red Shirt'));
    fireEvent.click(await screen.findByRole('checkbox'));

    const continueButton = await screen.findByRole('button', { name: /continue with 1 product/i });
    expect(continueButton).not.toBeDisabled();
    fireEvent.click(continueButton);

    const publishButton = await screen.findByRole('button', { name: /^publish$/i });
    fireEvent.click(publishButton);

    await waitFor(() => {
      expect(shopPublish).toHaveBeenCalledTimes(1);
    });
    const [, body] = shopPublish.mock.calls[0];
    expect(body).toMatchObject({ internalVariantId: 'ol_variant_9' });
  });

  it('removes a checked variant from the selection tray before continuing', async () => {
    const products = {
      list: vi.fn().mockResolvedValue({
        items: [{ id: 'prod_1', name: 'Red Shirt', sku: 'RS-1', price: 19.99, currency: 'PLN' }],
        total: 1,
        limit: 10,
        offset: 0,
      }),
      getById: vi.fn().mockResolvedValue({
        id: 'prod_1',
        name: 'Red Shirt',
        sku: 'RS-1',
        price: 19.99,
        currency: 'PLN',
        variants: [
          { id: 'ol_variant_9', productId: 'prod_1', sku: 'RS-1-M', ean: null, gtin: null, price: 19.99 },
        ],
      }),
    };
    const apiClient = createMockApiClient({ listings: {}, products });

    renderWithProviders(
      <WoocommercePublishWizard
        connection={wooConnection}
        onCancel={vi.fn()}
        onSubmitted={vi.fn()}
      />,
      { apiClient },
    );

    fireEvent.click(await screen.findByText('Red Shirt'));
    fireEvent.click(await screen.findByRole('checkbox'));
    await screen.findByRole('button', { name: /continue with 1 product/i });

    fireEvent.click(await screen.findByRole('button', { name: /remove.*from batch/i }));

    expect(
      await screen.findByRole('button', { name: /continue with 0 products/i }),
    ).toBeDisabled();
  });

  it('rejects a negative stock value and does not call the API', async () => {
    const shopPublish = vi.fn();
    const apiClient = createMockApiClient({ listings: { shopPublish } });

    renderWithProviders(
      <WoocommercePublishWizard
        connection={wooConnection}
        defaultVariantId="ol_variant_1"
        onCancel={vi.fn()}
        onSubmitted={vi.fn()}
      />,
      { apiClient },
    );

    const stockInput = await screen.findByPlaceholderText('master');
    fireEvent.change(stockInput, { target: { value: '-3' } });
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));

    // The message renders in both the FormErrorSummary and the FieldError.
    expect((await screen.findAllByText(/whole number/i)).length).toBeGreaterThan(0);
    expect(shopPublish).not.toHaveBeenCalled();
  });
});

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
      internalVariantIds: ['ol_variant_1', 'ol_variant_2', 'ol_variant_3'],
      status: 'draft',
    });
    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledWith({ batchId: 'batch-7' }, 'conn_woo_1');
    });
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

    const stockInput = await screen.findByPlaceholderText('0');
    fireEvent.change(stockInput, { target: { value: '-3' } });
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));

    // The message renders in both the FormErrorSummary and the FieldError.
    expect((await screen.findAllByText(/whole number/i)).length).toBeGreaterThan(0);
    expect(shopPublish).not.toHaveBeenCalled();
  });
});

/**
 * PromotionPeek tests (#3935): the channels line agrees with the list row
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../../test/test-utils';
import type { Promotion } from '../api/promotions.types';
import { PromotionPeek } from './promotion-peek';

const allegro = { ...sampleConnection, id: 'c-allegro', name: 'Allegro shop', platformType: 'allegro', enabledCapabilities: ['OrderSource'] };
const erli = { ...sampleConnection, id: 'c-erli', name: 'Erli shop', platformType: 'erli', enabledCapabilities: ['OrderSource'] };

function promotion(conditions: Promotion['conditions']): Promotion {
  return {
    id: 'p1',
    name: 'Free mug',
    isActive: true,
    position: 1,
    effectiveFrom: '2026-11-01T00:00:00.000Z',
    effectiveTo: null,
    conditions,
    benefit: { kind: 'free-gift', productId: 'p-gift', variantId: 'v-gift', quantity: 1, perUnit: null, skipIfPresent: true, documentForm: null },
    combinesWith: { mode: 'all' },
    limits: { unitCap: null, customerLimit: null },
    status: 'active',
    pausedReason: null,
    pausedAt: null,
    unitsGiven: 0,
    effectiveCap: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  } as unknown as Promotion;
}

function mount(p: Promotion): void {
  const apiClient = createMockApiClient({
    connections: { list: vi.fn().mockResolvedValue([allegro, erli]) },
    products: { getVariantCosts: vi.fn().mockResolvedValue([]), listRows: vi.fn().mockResolvedValue({ items: [] }) },
    giftReport: { get: vi.fn().mockResolvedValue({ groups: [], totals: [] }) },
  } as never);
  renderWithProviders(
    <PromotionPeek promotion={p} all={[p]} connections={[allegro, erli]} canWrite onClose={vi.fn()} onSetActive={vi.fn()} />,
    { apiClient },
  );
}

afterEach(cleanup);

describe('PromotionPeek channels', () => {
  it('should show one all-channels chip for a promotion with no channel condition, not every connection', () => {
    mount(promotion([]));

    expect(screen.getByTestId('promotion-peek-all-channels')).toBeInTheDocument();
    expect(screen.queryByText('Allegro shop')).not.toBeInTheDocument();
    expect(screen.queryByText('Erli shop')).not.toBeInTheDocument();
  });

  it('should list only the chosen channels otherwise', () => {
    mount(promotion([{ field: 'sourceConnectionIn', op: 'in', values: ['c-erli'] }] as never));

    expect(screen.queryByTestId('promotion-peek-all-channels')).not.toBeInTheDocument();
    expect(screen.getAllByText('Erli shop').length).toBeGreaterThan(0);
  });
});

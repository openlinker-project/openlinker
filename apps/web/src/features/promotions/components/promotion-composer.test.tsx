/**
 * PromotionComposer tests (#3935, mockup `promotions-detail`)
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../../test/test-utils';
import type { Connection } from '../../connections';
import type { Promotion } from '../api/promotions.types';
import { promotionToForm } from '../lib/promotion-form';
import { PromotionComposer, type PromotionComposerProps } from './promotion-composer';

const allegro: Connection = { ...sampleConnection, id: 'c-allegro', name: 'Allegro shop', platformType: 'allegro', enabledCapabilities: ['OrderSource'] };
const presta: Connection = { ...sampleConnection, id: 'c-presta', name: 'PrestaShop', platformType: 'prestashop', enabledCapabilities: ['OrderSource'] };

const SAVED: Promotion = {
  id: 'r1',
  name: 'Spoon with the set',
  isActive: true,
  position: 1,
  effectiveFrom: '2026-11-01T00:00:00.000Z',
  effectiveTo: null,
  conditions: [{ field: 'containsProduct', op: 'eq', value: 'v-set' }],
  benefit: { kind: 'free-gift', productId: 'p-spoon', variantId: 'v-spoon', quantity: 1, perUnit: null, skipIfPresent: true },
  combinesWith: { mode: 'all' },
  limits: { unitCap: null, customerLimit: null },
  status: 'active',
  pausedReason: null,
  pausedAt: null,
  unitsGiven: 0,
  effectiveCap: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};
const OTHER: Promotion = { ...SAVED, id: 'r2', name: 'Mug for 200', position: 2, benefit: { ...SAVED.benefit, variantId: 'v-mug' } };

const NAMES = new Map([['v-set', 'Morning set'], ['v-spoon', 'Spoon']]);

function mount(overrides: Partial<PromotionComposerProps> = {}, promotion: Promotion = SAVED): PromotionComposerProps {
  const props: PromotionComposerProps = {
    initial: promotionToForm(promotion, NAMES),
    promotion,
    all: [promotion, OTHER],
    canWrite: true,
    saving: false,
    savedCount: 0,
    saveError: null,
    onSave: vi.fn(),
    onResume: vi.fn(),
    onCopy: vi.fn(),
    ...overrides,
  };
  const apiClient = createMockApiClient({
    connections: { list: vi.fn().mockResolvedValue([allegro, presta]) },
    products: { getVariantCosts: vi.fn().mockResolvedValue([]), listRows: vi.fn().mockResolvedValue({ items: [], total: 0 }) },
  } as never);
  renderWithProviders(<PromotionComposer {...props} />, { apiClient });
  return props;
}

afterEach(cleanup);

describe('PromotionComposer', () => {
  it('should save a complete promotion as on, and as paused on request', () => {
    const props = mount();

    fireEvent.click(screen.getByTestId('promotion-primary'));
    fireEvent.click(screen.getByTestId('promotion-pause'));

    expect(props.onSave).toHaveBeenNthCalledWith(1, expect.objectContaining({ name: 'Spoon with the set' }), true);
    expect(props.onSave).toHaveBeenNthCalledWith(2, expect.objectContaining({ name: 'Spoon with the set' }), false);
  });

  it('should draw what is missing instead of saving when a required field is empty', async () => {
    const props = mount();

    fireEvent.change(screen.getByTestId('promotion-gift-qty'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('promotion-primary'));

    expect(props.onSave).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId('promotion-gift-qty').closest('.form-field')).toHaveClass('is-invalid'),
    );
  });

  it('should read the promotion back in one sentence that follows the form', async () => {
    mount();

    const readback = screen.getByTestId('promotion-readback');
    expect(readback).toHaveTextContent('contains Morning set');
    expect(readback).toHaveTextContent('we add a gift: Spoon, 1 pcs.');

    fireEvent.change(screen.getByTestId('promotion-gift-qty'), { target: { value: '3' } });
    fireEvent.change(screen.getByTestId('promotion-unit-cap'), { target: { value: '100' } });

    await waitFor(() => expect(readback).toHaveTextContent('Spoon, 3 pcs.'));
    expect(readback).toHaveTextContent('Limit is 100 pcs.');
  });

  it('should offer the other promotions only for "stacks only with selected"', async () => {
    mount();

    expect(screen.queryByTestId('promotion-combine-r2')).toBeInTheDocument();
    const list = screen.getByTestId('promotion-combine-r2').closest('.pm-cm-list');
    expect(list).not.toHaveClass('is-open');

    fireEvent.click(screen.getByTestId('promotion-combine-selected'));
    expect(list).toHaveClass('is-open');

    fireEvent.click(screen.getByTestId('promotion-combine-r2').querySelector('input') as HTMLElement);
    await waitFor(() =>
      expect(screen.getByTestId('promotion-readback')).toHaveTextContent('Stacks only with: Mug for 200.'),
    );
  });

  it('should open an amount field for the custom document price and send it', async () => {
    const props = mount();

    fireEvent.click(screen.getByTestId('promotion-doc-custom-price'));
    fireEvent.change(screen.getByTestId('promotion-doc-price'), { target: { value: '2.50' } });
    fireEvent.click(screen.getByTestId('promotion-primary'));

    await waitFor(() => expect(props.onSave).toHaveBeenCalled());
    const saved = (props.onSave as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(saved).toMatchObject({ documentForm: 'custom-price', documentUnitPrice: '2.50' });
  });

  it('should rename the promotion from its title', () => {
    mount();

    fireEvent.click(screen.getByLabelText('Change the promotion name'));
    const input = screen.getByLabelText('Promotion name');
    fireEvent.change(input, { target: { value: 'Spoon for sets' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByTestId('promotion-title')).toHaveTextContent('Spoon for sets');
    expect(screen.getByTestId<HTMLInputElement>('promotion-name').value).toBe('Spoon for sets');
  });

  it('should disable every control for a role that cannot write', () => {
    mount({ canWrite: false });

    expect(screen.getByTestId('promotion-primary')).toBeDisabled();
    expect(screen.getByTestId('promotion-name')).toBeDisabled();
    expect(screen.getByTestId('promotion-readonly-notice')).toBeInTheDocument();
  });

  it('should offer to resume a promotion that paused at its limit', () => {
    const props = mount(
      {},
      { ...SAVED, status: 'paused', pausedReason: 'unit-cap', unitsGiven: 100, effectiveCap: 100, limits: { unitCap: 100, customerLimit: null } },
    );

    fireEvent.change(screen.getByTestId('promotion-resume-units'), { target: { value: '25' } });
    fireEvent.click(screen.getByTestId('promotion-resume'));

    expect(props.onResume).toHaveBeenCalledWith(25);
  });
});

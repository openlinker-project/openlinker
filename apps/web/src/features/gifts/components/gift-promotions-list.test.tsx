/**
 * GiftPromotionsList tests (#3940, mockup M31 `promotions/list`, `viewer-readonly`)
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, sampleConnection } from '../../../test/test-utils';
import type { GiftRule } from '../api/gifts.types';
import { GiftPromotionsList } from './gift-promotions-list';

function rule(overrides: Partial<GiftRule>): GiftRule {
  return {
    id: 'r1',
    name: 'Spoon with the morning set',
    isActive: true,
    position: 1,
    effectiveFrom: '2026-11-01T00:00:00.000Z',
    effectiveTo: '2026-11-30T23:59:59.000Z',
    conditions: [],
    gift: {
      productId: 'p',
      variantId: 'v',
      quantity: 1,
      perUnit: null,
      unitCap: 200,
      skipIfPresent: true,
      doNotCombine: false,
      customerLimit: null,
    },
    status: 'active',
    pausedReason: null,
    pausedAt: null,
    unitsGiven: 40,
    effectiveCap: 200,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

const RULES: GiftRule[] = [
  rule({ id: 'spoon' }),
  rule({
    id: 'sample',
    name: 'Coffee sample from 150',
    status: 'paused',
    pausedReason: 'gift-out-of-stock',
    unitsGiven: 120,
    effectiveCap: null,
    gift: { ...(rule({}).gift as NonNullable<GiftRule['gift']>), doNotCombine: true, unitCap: null },
  }),
  rule({ id: 'bag', name: 'Gift bag', status: 'paused', pausedReason: 'unit-cap', unitsGiven: 50, effectiveCap: 50 }),
];

afterEach(cleanup);

describe('GiftPromotionsList', () => {
  it('should list the promotions in the order given, each with its state and what it gave', () => {
    renderWithProviders(
      <GiftPromotionsList rules={RULES} connections={[sampleConnection]} canWrite moving={false} onReorder={vi.fn()} />,
    );

    expect(screen.getByTestId('gift-rule-pos-spoon')).toHaveTextContent('1');
    expect(screen.getByTestId('gift-rule-pos-bag')).toHaveTextContent('3');
    expect(screen.getByTestId('gift-rule-status-spoon')).toHaveTextContent('Active');
    expect(screen.getByTestId('gift-rule-given-spoon')).toHaveTextContent('40 of 200 pcs');
    expect(screen.getByTestId('gift-rule-given-sample')).toHaveTextContent('120 pcs');
  });

  it('should say why a promotion paused itself, in its own row', () => {
    renderWithProviders(
      <GiftPromotionsList rules={RULES} connections={[]} canWrite moving={false} onReorder={vi.fn()} />,
    );

    expect(screen.getByTestId('gift-rule-status-sample')).toHaveTextContent('Paused: gift out of stock');
    expect(screen.getByTestId('gift-rule-reason-sample')).toHaveTextContent('resumes on its own');
    expect(screen.getByTestId('gift-rule-status-bag')).toHaveTextContent('Paused: piece limit');
    expect(screen.getByTestId('gift-rule-reason-bag')).toHaveTextContent('Given 50 of 50 pcs.');
  });

  it('should mark a promotion that does not combine with others', () => {
    renderWithProviders(
      <GiftPromotionsList rules={RULES} connections={[]} canWrite moving={false} onReorder={vi.fn()} />,
    );

    expect(screen.getByTestId('gift-rule-nostack-sample')).toBeInTheDocument();
    expect(screen.queryByTestId('gift-rule-nostack-spoon')).not.toBeInTheDocument();
  });

  it('should send the whole new order when a promotion is moved down', () => {
    const onReorder = vi.fn();
    renderWithProviders(
      <GiftPromotionsList rules={RULES} connections={[]} canWrite moving={false} onReorder={onReorder} />,
    );

    fireEvent.click(screen.getByTestId('gift-rule-down-spoon'));

    expect(onReorder).toHaveBeenCalledWith(['sample', 'spoon', 'bag']);
  });

  it('should disable Up on the first row and Down on the last', () => {
    renderWithProviders(
      <GiftPromotionsList rules={RULES} connections={[]} canWrite moving={false} onReorder={vi.fn()} />,
    );

    expect(screen.getByTestId('gift-rule-up-spoon')).toBeDisabled();
    expect(screen.getByTestId('gift-rule-down-bag')).toBeDisabled();
  });

  it('should show no order controls to a read-only role', () => {
    renderWithProviders(
      <GiftPromotionsList rules={RULES} connections={[]} canWrite={false} moving={false} onReorder={vi.fn()} />,
    );

    expect(screen.queryByTestId('gift-rule-up-spoon')).not.toBeInTheDocument();
    expect(screen.getByTestId('gift-rule-link-spoon')).toBeInTheDocument();
  });
});

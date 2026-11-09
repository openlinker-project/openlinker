/**
 * GiftPromotionsList tests (#3940, mockup M31 `promotions/list`, `viewer-readonly`)
 */
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

function renderList(overrides: Partial<React.ComponentProps<typeof GiftPromotionsList>> = {}): {
  props: React.ComponentProps<typeof GiftPromotionsList>;
} {
  const props: React.ComponentProps<typeof GiftPromotionsList> = {
    rules: RULES,
    connections: [],
    canWrite: true,
    moving: false,
    onReorder: vi.fn(),
    onSetActive: vi.fn(),
    onDelete: vi.fn(),
    busy: false,
    ...overrides,
  };
  renderWithProviders(<GiftPromotionsList {...props} />);
  return { props };
}

async function openMenu(id: string): Promise<void> {
  await userEvent.setup().click(screen.getByTestId(`gift-rule-menu-${id}`));
}

describe('GiftPromotionsList', () => {
  it('should list the promotions in the order given, each with its state and what it gave', () => {
    renderList({ connections: [sampleConnection] });

    expect(screen.getByTestId('gift-rule-pos-spoon')).toHaveTextContent('1');
    expect(screen.getByTestId('gift-rule-pos-bag')).toHaveTextContent('3');
    expect(screen.getByTestId('gift-rule-status-spoon')).toHaveTextContent('Active');
    expect(screen.getByTestId('gift-rule-given-spoon')).toHaveTextContent('40 of 200 pcs');
    expect(screen.getByTestId('gift-rule-given-sample')).toHaveTextContent('120 pcs');
  });

  it('should draw a progress bar only where the promotion has a limit', () => {
    renderList();

    expect(within(screen.getByTestId('gift-rule-given-spoon')).getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '40',
    );
    expect(within(screen.getByTestId('gift-rule-given-sample')).queryByRole('progressbar')).toBeNull();
  });

  it('should say why a promotion paused itself, in its own row', () => {
    renderList();

    expect(screen.getByTestId('gift-rule-status-sample')).toHaveTextContent('Paused: gift out of stock');
    expect(screen.getByTestId('gift-rule-reason-sample')).toHaveTextContent('resumes on its own');
    expect(screen.getByTestId('gift-rule-status-bag')).toHaveTextContent('Paused: piece limit');
    expect(screen.getByTestId('gift-rule-reason-bag')).toHaveTextContent('Given 50 of 50 pcs.');
  });

  it('should mark a promotion that does not combine with others', () => {
    renderList();

    expect(screen.getByTestId('gift-rule-nostack-sample')).toBeInTheDocument();
    expect(screen.queryByTestId('gift-rule-nostack-spoon')).not.toBeInTheDocument();
  });

  it('should send the whole new order when a promotion is moved down from its menu', async () => {
    const { props } = renderList();

    await openMenu('spoon');
    await userEvent.setup().click(await screen.findByTestId('gift-rule-down-spoon'));

    expect(props.onReorder).toHaveBeenCalledWith(['sample', 'spoon', 'bag']);
  });

  it('should disable Move up on the first row and Move down on the last', async () => {
    renderList();

    await openMenu('spoon');
    expect(await screen.findByTestId('gift-rule-up-spoon')).toHaveAttribute('aria-disabled', 'true');
    await userEvent.setup().keyboard('{Escape}');
    await openMenu('bag');
    expect(await screen.findByTestId('gift-rule-down-bag')).toHaveAttribute('aria-disabled', 'true');
  });

  it('should pause an active promotion from its menu', async () => {
    const { props } = renderList();

    await openMenu('spoon');
    await userEvent.setup().click(await screen.findByTestId('gift-rule-toggle-spoon'));

    expect(props.onSetActive).toHaveBeenCalledWith(expect.objectContaining({ id: 'spoon' }), false);
  });

  it('should ask before deleting, and delete only after the confirm', async () => {
    const { props } = renderList();
    const user = userEvent.setup();

    await openMenu('bag');
    await user.click(await screen.findByTestId('gift-rule-delete-bag'));
    expect(props.onDelete).not.toHaveBeenCalled();

    await user.click(await screen.findByRole('button', { name: 'Delete promotion' }));

    await waitFor(() => expect(props.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'bag' })));
  });

  it('should keep the row menu reachable but its changes disabled for a read-only role', async () => {
    renderList({ canWrite: false });

    expect(screen.getByTestId('gift-rule-link-spoon')).toBeInTheDocument();
    await openMenu('spoon');
    expect(await screen.findByTestId('gift-rule-up-spoon')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('gift-rule-down-spoon')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('gift-rule-delete-spoon')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('gift-rule-toggle-spoon')).toHaveAttribute('aria-disabled', 'true');
  });
});

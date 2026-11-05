/**
 * GiftRuleComposer tests (#3940, mockup M31 `promotions/composer-*`, `more-options`,
 * `paused-out-of-stock`, `limit-reached`, `ended`, `edited-open-orders`, `viewer-readonly`)
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../../test/test-utils';
import type { Connection } from '../../connections';
import type { GiftRule } from '../api/gifts.types';
import { emptyGiftRuleForm, ruleToForm } from '../lib/gift-rule-form';
import { GiftRuleComposer, type GiftRuleComposerProps } from './gift-rule-composer';

const allegro: Connection = { ...sampleConnection, id: 'c-allegro', name: 'Allegro shop', platformType: 'allegro', enabledCapabilities: ['OrderSource'] };
const presta: Connection = { ...sampleConnection, id: 'c-presta', name: 'PrestaShop', platformType: 'prestashop', enabledCapabilities: ['OrderSource'] };

const SAVED: GiftRule = {
  id: 'r1',
  name: 'Spoon with the set',
  isActive: true,
  position: 1,
  effectiveFrom: '2026-11-01T00:00:00.000Z',
  effectiveTo: null,
  conditions: [{ field: 'containsProduct', op: 'eq', value: 'v-set' }],
  gift: { productId: 'p-spoon', variantId: 'v-spoon', quantity: 1, perUnit: null, unitCap: null, skipIfPresent: true, doNotCombine: false, customerLimit: null },
  status: 'active',
  pausedReason: null,
  pausedAt: null,
  unitsGiven: 0,
  effectiveCap: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

function mount(overrides: Partial<GiftRuleComposerProps> = {}, rule: GiftRule | null = null, canWrite = true): GiftRuleComposerProps {
  const props: GiftRuleComposerProps = {
    initial: rule ? ruleToForm(rule, new Map([['v-set', 'Morning set'], ['v-spoon', 'Spoon']])) : emptyGiftRuleForm('product'),
    rule,
    canWrite,
    saving: false,
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
  renderWithProviders(<GiftRuleComposer {...props} />, { apiClient });
  return props;
}

afterEach(cleanup);

describe('GiftRuleComposer', () => {
  it('should not offer to turn a new promotion on while it is incomplete', () => {
    mount();

    expect(screen.getByTestId('gift-composer-primary')).toBeDisabled();
  });

  it('should save a complete promotion as on, and as a draft on request', () => {
    const props = mount({}, null);
    // A saved rule gives a complete form without driving the pickers.
    cleanup();
    const complete = mount({ initial: ruleToForm(SAVED, new Map([['v-set', 'Morning set'], ['v-spoon', 'Spoon']])) }, null);

    fireEvent.click(screen.getByTestId('gift-composer-primary'));
    fireEvent.click(screen.getByTestId('gift-composer-save-draft'));

    expect(complete.onSave).toHaveBeenNthCalledWith(1, expect.objectContaining({ name: 'Spoon with the set' }), true);
    expect(complete.onSave).toHaveBeenNthCalledWith(2, expect.objectContaining({ name: 'Spoon with the set' }), false);
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it('should hide every option but the defaults summary until More options is opened', () => {
    mount({}, SAVED);

    expect(screen.getByTestId('gift-composer-more-summary')).toHaveTextContent(
      'combines with others, no piece limit, pauses when the gift runs out',
    );
    expect(screen.queryByTestId('gift-composer-opt-no-stack')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'More options' }));

    expect(screen.getByTestId('gift-composer-opt-no-stack')).toBeInTheDocument();
    expect(screen.getByTestId('gift-composer-opt-skip-present')).toBeChecked();
    expect(screen.getByTestId('gift-composer-opt-doc-form')).toBeInTheDocument();
  });

  it('should give every channel one marker and warn about a double gift where a shop knows gifts', async () => {
    mount({}, SAVED);

    expect(await screen.findByTestId('gift-composer-channel-marker-c-allegro')).toHaveTextContent('Through OpenLinker');
    expect(screen.getByTestId('gift-composer-channel-marker-c-presta')).toHaveTextContent('The shop can also give gifts');
    expect(screen.getByTestId('gift-composer-prestashop-warning')).toBeInTheDocument();
  });

  it('should state what the customer pays and that the cost is unknown when none is recorded', async () => {
    mount({}, SAVED);

    await waitFor(() => expect(screen.getByTestId('gift-composer-who-pays')).toHaveTextContent('Customer pays'));
    expect(screen.getByTestId('gift-composer-who-pays')).toHaveTextContent('no purchase cost recorded');
  });

  it('should tell the operator a change does not touch orders already placed', () => {
    mount({}, SAVED);

    expect(screen.getByTestId('gift-composer-edit-alert')).toHaveTextContent('Orders already placed keep the gift they got');
  });

  it('should say a promotion paused itself for stock, with no resume by hand', () => {
    mount({}, { ...SAVED, status: 'paused', pausedReason: 'gift-out-of-stock' });

    expect(screen.getByTestId('gift-composer-selfpause-alert')).toHaveTextContent('the gift is out of stock');
    expect(screen.queryByTestId('gift-composer-resume')).not.toBeInTheDocument();
  });

  it('should resume a promotion that hit its limit with the units the operator adds', () => {
    const props = mount({}, { ...SAVED, status: 'paused', pausedReason: 'unit-cap', unitsGiven: 50, effectiveCap: 50 });

    expect(screen.getByTestId('gift-composer-selfpause-alert')).toHaveTextContent('Given 50 of 50 pcs');
    fireEvent.change(screen.getByTestId('gift-composer-resume-units'), { target: { value: '30' } });
    fireEvent.click(screen.getByTestId('gift-composer-resume'));

    expect(props.onResume).toHaveBeenCalledWith(30);
  });

  it('should extend an ended promotion with a new end date', () => {
    const props = mount({}, { ...SAVED, status: 'ended', effectiveFrom: '2026-10-01T00:00:00.000Z', effectiveTo: '2026-10-31T23:59:59.000Z' });

    expect(screen.getByTestId('gift-composer-ended-alert')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('gift-composer-extend-to'), { target: { value: '2026-12-31' } });
    fireEvent.click(screen.getByTestId('gift-composer-extend'));

    expect(props.onSave).toHaveBeenCalledWith(expect.anything(), true, { to: '2026-12-31' });
  });

  it('should copy a saved promotion', () => {
    const props = mount({}, SAVED);

    fireEvent.click(screen.getByTestId('gift-composer-copy'));

    expect(props.onCopy).toHaveBeenCalled();
  });

  it('should be read-only for a role that cannot write', () => {
    mount({}, SAVED, false);

    expect(screen.getByTestId('gift-rule-readonly-notice')).toBeInTheDocument();
    expect(screen.getByTestId('gift-composer-primary')).toBeDisabled();
    expect(screen.getByTestId('gift-composer-name')).toBeDisabled();
  });
});

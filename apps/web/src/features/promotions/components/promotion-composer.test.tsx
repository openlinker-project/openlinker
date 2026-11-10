/**
 * GiftRuleComposer tests (#3940, mockup M31 `promotions/composer-*`, `more-options`,
 * `paused-out-of-stock`, `limit-reached`, `ended`, `edited-open-orders`, `viewer-readonly`)
 */
import { cleanup, fireEvent, screen, waitFor, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

let rendered: RenderResult | null = null;
const rerenderComposer = (props: GiftRuleComposerProps): void => rendered?.rerender(<GiftRuleComposer {...props} />);

function mount(
  overrides: Partial<GiftRuleComposerProps> = {},
  rule: GiftRule | null = null,
  canWrite = true,
  products: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
): GiftRuleComposerProps {
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
    products: {
      getVariantCosts: vi.fn().mockResolvedValue([]),
      listRows: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      ...products,
    },
    ...extra,
  } as never);
  rendered = renderWithProviders(<GiftRuleComposer {...props} />, { apiClient });
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

  it('should fold the rarely used options under More options with a one-line summary', () => {
    mount({}, SAVED);

    const more = screen.getByTestId('gift-composer-more');
    expect(more).toHaveTextContent(
      'combines with others · skips when the gift is already there · no limit per customer',
    );
    expect(more.querySelector('details')).not.toHaveAttribute('open');
    expect(screen.getByTestId('gift-composer-opt-no-stack')).toBeInTheDocument();
    expect(screen.getByTestId('gift-composer-opt-skip-present')).toBeChecked();
    expect(screen.getByTestId('gift-composer-opt-doc-form')).toBeInTheDocument();
  });

  it('should describe the promotion in one plain sentence that follows the form', async () => {
    mount({}, SAVED);

    const sentence = screen.getByTestId('gift-rule-summary-text');
    expect(sentence).toHaveTextContent('contains Morning set');
    expect(sentence).toHaveTextContent('we add a gift: Spoon, 1 pcs.');

    fireEvent.change(screen.getByTestId('gift-composer-gift-qty'), { target: { value: '3' } });
    fireEvent.change(screen.getByTestId('gift-composer-opt-unit-cap'), { target: { value: '100' } });

    await waitFor(() => expect(sentence).toHaveTextContent('Spoon, 3 pcs. The limit is 100 pcs.'));
  });

  it('should ask for the missing parts instead of a sentence while the form is incomplete', () => {
    mount();

    expect(screen.getByTestId('gift-rule-summary-text')).toHaveTextContent('Fill in the form');
  });

  it('should show the results of a saved promotion from the gift report, matched by its own id', async () => {
    const group = (ruleRef: string, units: number, orders: number, costNet: number): Record<string, unknown> => ({
      key: ruleRef,
      giftSource: 'rule',
      ruleRef,
      ruleName: ruleRef,
      productId: 'p-spoon',
      variantId: 'v-spoon',
      sku: null,
      name: null,
      currency: 'PLN',
      units,
      orders,
      paidGross: 0,
      costNet,
      unknownCostUnits: 0,
    });
    mount({}, SAVED, true, {}, {
      giftReport: {
        getGiftReport: vi.fn().mockResolvedValue({
          groups: [group('r1', 34, 30, 143), group('someone-else', 500, 400, 9999)],
          totals: [],
        }),
      },
    });

    await waitFor(() => expect(screen.getByTestId('gift-rule-results-orders')).toHaveTextContent('30'));
    expect(screen.getByTestId('gift-rule-results-given')).toHaveTextContent('34 pcs');
    expect(screen.getByTestId('gift-rule-results-cost')).toHaveTextContent('143');
    expect(screen.getByTestId('gift-rule-results-cost')).not.toHaveTextContent('9');
    expect(screen.getByTestId('gift-rule-results-average')).toHaveTextContent('4.21');
  });

  it('should say the results could not be loaded rather than show zero', async () => {
    mount({}, SAVED, true, {}, { giftReport: { getGiftReport: vi.fn().mockRejectedValue(new Error('boom')) } });

    expect(await screen.findByTestId('gift-rule-results-failed')).toBeInTheDocument();
    expect(screen.queryByTestId('gift-rule-results-given')).not.toBeInTheDocument();
  });

  it('should not draw results or the runs tab for a promotion that is not saved yet', () => {
    mount();

    expect(screen.queryByTestId('gift-rule-results')).not.toBeInTheDocument();
    expect(screen.queryByTestId('gift-rule-tab-runs')).not.toBeInTheDocument();
    expect(screen.getByTestId('gift-composer-test-input')).toBeInTheDocument();
  });

  it('should offer a saved promotion its test and its recent runs in one card', async () => {
    const listRuns = vi.fn().mockResolvedValue({
      runs: [],
      limit: 20,
      hasMore: false,
      recordingAvailable: true,
      note: null,
    });
    mount({}, SAVED, true, {}, { automations: { listRuns } });
    const user = userEvent.setup();

    expect(screen.getByTestId('gift-composer-test-input')).toBeInTheDocument();
    expect(listRuns).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('gift-rule-tab-runs'));

    await waitFor(() => expect(listRuns).toHaveBeenCalledWith('r1'));
  });

  it('should give every channel one marker and warn about a double gift where a shop knows gifts', async () => {
    mount({}, SAVED);

    expect(await screen.findByTestId('gift-composer-channel-marker-c-allegro')).toHaveTextContent('Through OpenLinker');
    expect(screen.getByTestId('gift-composer-channel-marker-c-presta')).toHaveTextContent('The shop can also give gifts');
    expect(screen.getByTestId('gift-composer-prestashop-warning')).toBeInTheDocument();
  });

  it('should state what the customer pays and that the cost is unknown when none is recorded', async () => {
    mount({}, SAVED);

    await waitFor(() =>
      expect(screen.getByTestId('gift-composer-who-pays')).toHaveTextContent('no purchase cost recorded'),
    );
    expect(screen.getByTestId('gift-composer-who-pays')).toHaveTextContent('Customer pays');
  });

  it('should not claim the cost is unrecorded while the read is pending or after it failed', async () => {
    mount({}, SAVED, true, { getVariantCosts: vi.fn().mockReturnValue(new Promise(() => undefined)) });
    expect(screen.getByTestId('gift-composer-who-pays')).toHaveTextContent('checking the purchase cost');
    expect(screen.getByTestId('gift-composer-who-pays')).not.toHaveTextContent('no purchase cost recorded');
    cleanup();

    mount({}, SAVED, true, { getVariantCosts: vi.fn().mockRejectedValue(new Error('403')) });
    await waitFor(() =>
      expect(screen.getByTestId('gift-composer-who-pays')).toHaveTextContent('could not be read'),
    );
    expect(screen.getByTestId('gift-composer-who-pays')).not.toHaveTextContent('no purchase cost recorded');
  });

  it('should say a cost in another currency is in another currency instead of printing it in the basket currency', async () => {
    mount({}, SAVED, true, {
      getVariantCosts: vi.fn().mockResolvedValue([
        { variantId: 'v-spoon', netUnitCost: '1.50', costCurrency: 'EUR', costUpdatedAt: null, costUpdatedByUserId: null },
      ]),
    });

    await waitFor(() => expect(screen.getByTestId('gift-composer-who-pays')).toHaveTextContent('another currency (EUR)'));
    expect(screen.getByTestId('gift-composer-who-pays')).not.toHaveTextContent('1.50');
  });

  it('should keep what the operator typed when the parent re-renders with the same starting values', () => {
    const props = mount({}, SAVED);
    const input = screen.getByTestId('gift-composer-name');
    fireEvent.change(input, { target: { value: 'My own name' } });
    expect(input).toHaveValue('My own name');

    // A failed save re-renders the page; its `initial` is rebuilt with identical content.
    rerenderComposer({ ...props, initial: { ...props.initial }, rule: { ...SAVED }, saveError: 'boom' });

    expect(screen.getByTestId('gift-composer-name')).toHaveValue('My own name');
  });

  it('should render a delete action in the menu that asks first', async () => {
    const onDelete = vi.fn();
    mount({ onDelete }, SAVED);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('gift-composer-menu'));
    await user.click(await screen.findByTestId('gift-composer-delete'));
    expect(onDelete).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: 'Delete promotion' }));
    expect(onDelete).toHaveBeenCalled();
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

  it('should copy a saved promotion from the menu', async () => {
    const props = mount({}, SAVED);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('gift-composer-menu'));
    await user.click(await screen.findByTestId('gift-composer-copy'));

    expect(props.onCopy).toHaveBeenCalled();
  });

  it('should be read-only for a role that cannot write', () => {
    mount({}, SAVED, false);

    expect(screen.getByTestId('gift-rule-readonly-notice')).toBeInTheDocument();
    expect(screen.getByTestId('gift-composer-primary')).toBeDisabled();
    expect(screen.getByTestId('gift-composer-name')).toBeDisabled();
  });
});

/**
 * GiftLineTag tests (#3940, mockup M31 `order-gift-tag-*`)
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../../test/test-utils';
import { GiftLineTag } from './gift-line-tag';

afterEach(cleanup);

function mount(props: Partial<Parameters<typeof GiftLineTag>[0]> = {}, config: Record<string, unknown> = {}): void {
  const apiClient = createMockApiClient({
    connections: { list: vi.fn().mockResolvedValue([{ ...sampleConnection, id: 'docs', name: 'inFakt', config }]) },
  } as never);
  renderWithProviders(
    <GiftLineTag lineKey="LYZ-KAW" gift={{ source: 'ol-rule' }} currency="PLN" costNet={2} {...props} />,
    { apiClient },
  );
}

describe('GiftLineTag', () => {
  it('should say who decided it, who pays and what it costs', async () => {
    mount();

    fireEvent.click(screen.getByTestId('order-gift-tag-LYZ-KAW'));

    expect(await screen.findByTestId('order-gift-tag-LYZ-KAW-popover')).toHaveTextContent('A gift promotion in OpenLinker added it');
    expect(screen.getByTestId('order-gift-cost-LYZ-KAW')).toHaveTextContent('Customer pays');
    expect(screen.getByTestId('order-gift-cost-LYZ-KAW')).toHaveTextContent('Costs you');
  });

  it('should say the cost is not recorded rather than show zero', async () => {
    mount({ costNet: null });

    fireEvent.click(screen.getByTestId('order-gift-tag-LYZ-KAW'));

    expect(await screen.findByTestId('order-gift-cost-LYZ-KAW')).toHaveTextContent('Cost not recorded');
  });

  it('should name a gift from the channel and one added by hand differently', async () => {
    mount({ gift: { source: 'channel' } });
    fireEvent.click(screen.getByTestId('order-gift-tag-LYZ-KAW'));
    expect(await screen.findByTestId('order-gift-tag-LYZ-KAW-popover')).toHaveTextContent('sales channel');
  });

  it('should name the gift own form as coming from the rule', async () => {
    mount({ gift: { source: 'ol-rule', documentForm: 'priced-in' } });

    fireEvent.click(screen.getByTestId('order-gift-tag-LYZ-KAW'));

    expect(await screen.findByTestId('order-gift-doc-form-LYZ-KAW')).toHaveTextContent('from the rule');
  });

  it('should fall back to the OpenLinker default when the gift and no connection say anything', async () => {
    mount();

    fireEvent.click(screen.getByTestId('order-gift-tag-LYZ-KAW'));

    expect(await screen.findByTestId('order-gift-doc-form-LYZ-KAW')).toHaveTextContent('OpenLinker default');
  });

  it('should use the connection that issues the document when it overrides the form', async () => {
    mount({ documentConnectionId: 'docs' }, { giftOnDocuments: { form: 'omit' } });

    fireEvent.click(screen.getByTestId('order-gift-tag-LYZ-KAW'));

    await waitFor(() =>
      expect(screen.getByTestId('order-gift-doc-form-LYZ-KAW')).toHaveTextContent('inFakt'),
    );
  });

  it('should not claim the cost is unrecorded while the cost read is pending, failed or not available', async () => {
    for (const [costState, text] of [
      ['loading', 'checking the purchase cost'],
      ['failed', 'could not be read'],
    ] as const) {
      mount({ costNet: undefined, costState });
      fireEvent.click(screen.getByTestId('order-gift-tag-LYZ-KAW'));
      const cost = await screen.findByTestId('order-gift-cost-LYZ-KAW');
      expect(cost).toHaveTextContent(text);
      expect(cost).not.toHaveTextContent('Cost not recorded');
      cleanup();
    }
    mount({ costNet: undefined, costState: 'unavailable' });
    fireEvent.click(screen.getByTestId('order-gift-tag-LYZ-KAW'));
    expect(await screen.findByTestId('order-gift-cost-LYZ-KAW')).not.toHaveTextContent('Cost not recorded');
  });
});

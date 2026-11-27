import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { BundleReturnPicker } from './bundle-return-picker';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { BundleReturnPreview } from '../api/returns.types';

const preview = (overrides: Partial<BundleReturnPreview> = {}): BundleReturnPreview => ({
  isBundle: true,
  paidPerUnitGross: 100,
  components: [
    {
      variantId: 'v-a',
      sku: 'KUB',
      perUnit: 1,
      standaloneUnitPriceGross: 40,
      shareGross: 40,
      shareBasis: 'price',
    },
    {
      variantId: 'v-b',
      sku: 'KAW',
      perUnit: 1,
      standaloneUnitPriceGross: 60,
      shareGross: 60,
      shareBasis: 'price',
    },
  ],
  splitRefusal: null,
  splitRefusalVariantIds: [],
  returnedShareGross: 100,
  allegroRefundHintGross: null,
  ...overrides,
});

function renderPicker(getBundleReturnPreview: Mock) {
  const onSelectionChange = vi.fn();
  const onBlockedChange = vi.fn();
  renderWithProviders(
    <BundleReturnPicker
      currency="PLN"
      lineId="line-1"
      onBlockedChange={onBlockedChange}
      onSelectionChange={onSelectionChange}
      quantity={1}
      returnId="ret-1"
    />,
    { apiClient: createMockApiClient({ returns: { getBundleReturnPreview } }) }
  );
  return { onSelectionChange, onBlockedChange };
}

describe('BundleReturnPicker', () => {
  it('should report blocked while the preview is pending, so a missing preview never restocks the whole set', async () => {
    const get = vi.fn().mockReturnValue(new Promise(() => undefined));
    const { onBlockedChange } = renderPicker(get);

    await waitFor(() => expect(onBlockedChange).toHaveBeenCalledWith(true));
    expect(onBlockedChange).not.toHaveBeenCalledWith(false);
  });

  it('should show an error and keep the submit blocked when the preview fails', async () => {
    const get = vi.fn().mockRejectedValue(new Error('boom'));
    const { onBlockedChange } = renderPicker(get);

    expect(await screen.findByTestId('return-component-preview-error')).toBeInTheDocument();
    expect(onBlockedChange).toHaveBeenLastCalledWith(true);
  });

  it('should render nothing for a line that is not a bundle', async () => {
    const get = vi.fn().mockResolvedValue(preview({ isBundle: false, components: [] }));
    renderPicker(get);

    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByTestId('return-component-picker')).toBeNull();
  });

  it('should treat every component ticked as the whole bundle', async () => {
    const get = vi.fn().mockResolvedValue(preview());
    const { onSelectionChange } = renderPicker(get);

    await screen.findByTestId('return-component-picker');
    expect(onSelectionChange).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByTestId('return-component-state-KUB')).toHaveTextContent(
      'Back in the warehouse'
    );
  });

  it('should report only the ticked components as the selection', async () => {
    const get = vi.fn().mockResolvedValue(preview());
    const { onSelectionChange } = renderPicker(get);

    await screen.findByTestId('return-component-picker');
    await userEvent.click(screen.getAllByRole('checkbox')[0]);

    await waitFor(() => expect(onSelectionChange).toHaveBeenLastCalledWith(['v-b']));
    expect(screen.getByTestId('return-component-state-KUB')).toHaveTextContent(
      'Stays with the customer'
    );
  });

  it('should block a partial return and name the component when the price cannot be split', async () => {
    const get = vi.fn().mockImplementation((_r, _l, selection: { returnedVariantIds?: string[] }) =>
      Promise.resolve(
        selection.returnedVariantIds === undefined
          ? preview()
          : preview({
              splitRefusal: 'no-split-basis',
              splitRefusalVariantIds: ['v-a'],
              components: preview().components.map((c) => ({ ...c, shareGross: null })),
            })
      )
    );
    const { onBlockedChange } = renderPicker(get);

    await screen.findByTestId('return-component-picker');
    await userEvent.click(screen.getAllByRole('checkbox')[0]);

    const note = await screen.findByTestId('return-component-no-split-note');
    expect(note).toHaveTextContent('KUB');
    await waitFor(() => expect(onBlockedChange).toHaveBeenLastCalledWith(true));
  });

  it('should block when no component is ticked', async () => {
    const get = vi.fn().mockResolvedValue(preview());
    const { onBlockedChange } = renderPicker(get);

    await screen.findByTestId('return-component-picker');
    for (const box of screen.getAllByRole('checkbox')) {
      await userEvent.click(box);
    }

    await waitFor(() => expect(onBlockedChange).toHaveBeenLastCalledWith(true));
  });
});

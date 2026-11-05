/**
 * AddGiftDialog tests (#3940, mockup M31 `order/add-gift*`)
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../shared/api/api-error';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { AddGiftDialog } from './add-gift-dialog';

const SPOON = { id: 'p-spoon', name: 'Coffee spoon', sku: 'LYZ-KAW', price: 12, currency: 'PLN' };

function api(overrides: { addGiftToOrder?: ReturnType<typeof vi.fn> } = {}): ReturnType<typeof createMockApiClient> {
  return createMockApiClient({
    gifts: { addGiftToOrder: overrides.addGiftToOrder ?? vi.fn().mockResolvedValue({ dryRun: false, changeId: 'c1', gift: { lineKey: 'op-gift:c1', salesDocumentExists: false, reserved: true, onPickList: true } }) },
    products: {
      listRows: vi.fn().mockResolvedValue({ items: [SPOON], total: 1 }),
      getById: vi.fn().mockResolvedValue({ ...SPOON, variants: [{ id: 'v-spoon', productId: 'p-spoon', sku: 'LYZ-KAW', attributes: null, price: 12 }] }),
      getVariantCosts: vi.fn().mockResolvedValue([{ variantId: 'v-spoon', netUnitCost: '2.0000', costCurrency: 'PLN', costUpdatedAt: null, costUpdatedByUserId: null }]),
    },
  } as never);
}

function open(apiClient: ReturnType<typeof createMockApiClient>, props: { parcelClosed?: boolean; hasSalesDocument?: boolean } = {}): void {
  renderWithProviders(
    <AddGiftDialog
      open
      onOpenChange={vi.fn()}
      internalOrderId="ol_order_1"
      orderLabel="f2a90b64"
      currency="PLN"
      parcelClosed={props.parcelClosed ?? false}
      hasSalesDocument={props.hasSalesDocument ?? false}
    />,
    { apiClient },
  );
}

async function pickSpoon(): Promise<void> {
  fireEvent.change(screen.getByTestId('order-gift-dialog-search'), { target: { value: 'spoon' } });
  fireEvent.click(await screen.findByTestId('order-gift-dialog-search-result-LYZ-KAW'));
  await screen.findByText('Coffee spoon');
}

afterEach(cleanup);

describe('AddGiftDialog', () => {
  it('should add the picked product with its quantity and document form', async () => {
    const addGiftToOrder = vi.fn().mockResolvedValue({ dryRun: false, changeId: 'c1', gift: { lineKey: 'op-gift:c1', salesDocumentExists: false, reserved: true, onPickList: true } });
    open(api({ addGiftToOrder }));

    await pickSpoon();
    fireEvent.change(screen.getByTestId('order-gift-dialog-qty'), { target: { value: '2' } });
    fireEvent.change(screen.getByTestId('order-gift-dialog-doc-form'), { target: { value: 'priced-in' } });
    fireEvent.click(screen.getByTestId('order-gift-dialog-submit'));

    await waitFor(() =>
      expect(addGiftToOrder).toHaveBeenCalledWith('ol_order_1', { variantId: 'v-spoon', quantity: 2, documentForm: 'priced-in' }),
    );
  });

  it('should state what the customer pays and what the gift costs the seller', async () => {
    open(api());

    await pickSpoon();

    await waitFor(() => expect(screen.getByTestId('order-gift-dialog-cost')).toHaveTextContent('Costs you'));
    expect(screen.getByTestId('order-gift-dialog-cost')).toHaveTextContent('Customer pays');
  });

  it('should not offer to submit before a product is picked', () => {
    open(api());

    expect(screen.getByTestId('order-gift-dialog-submit')).toBeDisabled();
  });

  it('should refuse once the parcel is closed and offer nothing to submit', async () => {
    open(api(), { parcelClosed: true });

    expect(screen.getByTestId('order-gift-dialog-refused-closed')).toBeInTheDocument();
    expect(screen.getByTestId('order-gift-dialog-submit')).toBeDisabled();
  });

  it('should warn once when a sales document already exists and still allow the add', async () => {
    open(api(), { hasSalesDocument: true });

    expect(screen.getAllByTestId('order-gift-dialog-warning-document')).toHaveLength(1);
    await pickSpoon();
    expect(screen.getByTestId('order-gift-dialog-submit')).toBeEnabled();
  });

  it('should turn a server refusal about the parcel into the closed-parcel notice', async () => {
    const addGiftToOrder = vi
      .fn()
      .mockRejectedValue(new ApiError('This order is already packed.', 409, { error: 'ORDER_PACKED', message: 'This order is already packed.' }));
    open(api({ addGiftToOrder }));

    await pickSpoon();
    fireEvent.click(screen.getByTestId('order-gift-dialog-submit'));

    expect(await screen.findByTestId('order-gift-dialog-refused-closed')).toBeInTheDocument();
  });
});

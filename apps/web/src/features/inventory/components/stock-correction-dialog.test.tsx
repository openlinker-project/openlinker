import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../shared/api/api-error';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { CorrectionTarget, CorrectStockResult } from '../api/inventory-correction.types';
import type { StockViewVariant } from '../api/inventory.types';
import { StockCorrectionDialog } from './stock-correction-dialog';
import { buildStockRows } from '../lib/stock-row';
import { StockActions } from './stock-variant-detail';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const readyTarget: CorrectionTarget = {
  kind: 'ready',
  reason: null,
  productId: 'p1',
  productVariantId: 'v1',
  connectionId: 'conn_ps',
  connectionName: 'PrestaShop - Ceramika Nowak',
  platformType: 'prestashop',
  currentQuantity: 6,
};

function stock(overrides: Partial<StockViewVariant> = {}): StockViewVariant {
  return {
    productVariantId: 'v1',
    sku: 'KCN-350-GRY',
    attributes: { color: 'Szary' },
    masterAvailable: 6,
    masterReserved: 0,
    availableToPromise: 4,
    provenance: 'computed',
    observedAt: null,
    stalenessMs: null,
    olHeldNotReflected: null,
    heldCounted: 2,
    heldRecordedOnly: 0,
    livePositionCount: 1,
    isStaleSync: false,
    positions: [],
    holds: [],
    channels: [
      {
        connectionId: 'c1',
        connectionName: 'Allegro',
        platformType: 'allegro',
        rule: { stockSafetyBuffer: 2, stockZeroThreshold: 0 },
        willPublish: { quantity: 2, provenance: 'computed' },
        channelShows: { quantity: null, observedAt: null },
      },
      {
        connectionId: 'c2',
        connectionName: 'Erli',
        platformType: 'erli',
        rule: { stockSafetyBuffer: 0, stockZeroThreshold: 5 },
        willPublish: { quantity: 0, provenance: 'computed' },
        channelShows: { quantity: null, observedAt: null },
      },
    ],
    ...overrides,
  };
}

const adjustTarget = {
  variant: { id: 'v1', sku: 'KCN-350-GRY', attributes: { color: 'Szary' } },
  stock: stock(),
};

function result(overrides: Partial<CorrectStockResult> = {}): CorrectStockResult {
  return {
    status: 'applied',
    movementId: 'm1',
    requestedDelta: 3,
    quantityBefore: 6,
    quantityAfter: 9,
    adjustmentOutcome: { disposition: 'applied', idempotency: 'honoured', appliedAt: null },
    master: { connectionId: 'conn_ps', connectionName: 'PrestaShop - Ceramika Nowak', platformType: 'prestashop' },
    refusal: null,
    deduplicated: false,
    ...overrides,
  };
}

function renderDialog(
  inventory: {
    getCorrectionTarget?: ReturnType<typeof vi.fn>;
    correctStock?: ReturnType<typeof vi.fn>;
  },
  target: typeof adjustTarget | null = adjustTarget,
) {
  const api = createMockApiClient({
    inventory: {
      getCorrectionTarget: inventory.getCorrectionTarget ?? vi.fn().mockResolvedValue(readyTarget),
      correctStock: inventory.correctStock ?? vi.fn().mockResolvedValue(result()),
    } as never,
  });
  renderWithProviders(<StockCorrectionDialog target={target} onClose={() => undefined} />, { apiClient: api });
  return api;
}

describe('StockCorrectionDialog', () => {
  it('should preview what each channel publishes from available to promise', async () => {
    renderDialog({});
    await screen.findByTestId('stock-correction-dialog');

    await userEvent.type(screen.getByTestId('stock-correction-quantity'), '9');

    expect(screen.getByTestId('stock-correction-preview-atp')).toHaveTextContent('7');
    expect(screen.getByTestId('stock-correction-preview-allegro')).toHaveTextContent('5');
    expect(screen.getByTestId('stock-correction-preview-erli')).toHaveTextContent('7');
    expect(screen.getByTestId('stock-correction-diff')).toHaveTextContent('6 → 9');
  });

  it('should show Not known for channels when the reserved count is unknown', async () => {
    renderDialog({}, { ...adjustTarget, stock: stock({ heldCounted: null }) });
    await screen.findByTestId('stock-correction-dialog');

    await userEvent.type(screen.getByTestId('stock-correction-quantity'), '9');

    expect(screen.getByTestId('stock-correction-preview-atp')).toHaveTextContent('Not known');
    expect(screen.getByTestId('stock-correction-preview-allegro')).toHaveTextContent('Not known');
    expect(screen.getByTestId('stock-correction-preview-allegro')).not.toHaveTextContent(/\b[0-9]+\s*$/);
  });

  it('should replace the form with the named refusal when OpenLinker will not guess the master', async () => {
    renderDialog({
      getCorrectionTarget: vi.fn().mockResolvedValue({
        ...readyTarget,
        kind: 'refused',
        reason: 'ambiguous-inventory-master',
        connectionId: null,
        connectionName: null,
      }),
    });

    expect(await screen.findByTestId('stock-correction-target-refused')).toHaveTextContent(
      'Two connections claim this stock, so OpenLinker will not guess which one to change.',
    );
    expect(screen.queryByTestId('stock-correction-quantity')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stock-correction-submit')).not.toBeInTheDocument();
  });

  it('should gate a large change on the checkbox and send confirmLargeChange only when ticked', async () => {
    const correctStock = vi.fn().mockResolvedValue(result({ requestedDelta: 14, quantityAfter: 20 }));
    renderDialog({ correctStock });
    await screen.findByTestId('stock-correction-dialog');

    await userEvent.type(screen.getByTestId('stock-correction-quantity'), '20');

    expect(screen.getByTestId('stock-correction-large-change')).toBeInTheDocument();
    expect(screen.getByTestId('stock-correction-submit')).toBeDisabled();

    await userEvent.click(screen.getByTestId('stock-correction-large-change-confirm'));
    expect(screen.getByTestId('stock-correction-submit')).toBeEnabled();
    await userEvent.click(screen.getByTestId('stock-correction-submit'));

    await waitFor(() => expect(correctStock).toHaveBeenCalledTimes(1));
    expect(correctStock.mock.calls[0]?.[1]).toMatchObject({ mode: 'set', quantity: 20, confirmLargeChange: true });
  });

  it('should not send confirmLargeChange for an ordinary change', async () => {
    const correctStock = vi.fn().mockResolvedValue(result());
    renderDialog({ correctStock });
    await screen.findByTestId('stock-correction-dialog');

    await userEvent.type(screen.getByTestId('stock-correction-quantity'), '7');
    await userEvent.click(screen.getByTestId('stock-correction-submit'));

    await waitFor(() => expect(correctStock).toHaveBeenCalledTimes(1));
    expect(correctStock.mock.calls[0]?.[1]).not.toHaveProperty('confirmLargeChange');
  });

  it('should keep the same idempotency key when the server asks for confirmation', async () => {
    const correctStock = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('Confirm', 409, { code: 'confirmation-required' }))
      .mockResolvedValueOnce(result());
    renderDialog({ correctStock });
    await screen.findByTestId('stock-correction-dialog');

    // 4 of 6 is under both client thresholds' reach only if the server says so.
    await userEvent.type(screen.getByTestId('stock-correction-quantity'), '7');
    await userEvent.click(screen.getByTestId('stock-correction-submit'));

    const block = await screen.findByTestId('stock-correction-large-change');
    expect(block).toBeInTheDocument();
    expect(screen.getByTestId('stock-correction-submit')).toBeDisabled();

    await userEvent.click(screen.getByTestId('stock-correction-large-change-confirm'));
    await userEvent.click(screen.getByTestId('stock-correction-submit'));

    await waitFor(() => expect(correctStock).toHaveBeenCalledTimes(2));
    const first = correctStock.mock.calls[0]?.[1] as { idempotencyKey: string };
    const second = correctStock.mock.calls[1]?.[1] as { idempotencyKey: string; confirmLargeChange?: boolean };
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second.confirmLargeChange).toBe(true);
  });

  it('should show the server figures in the large-change block', async () => {
    const correctStock = vi.fn().mockRejectedValueOnce(
      new ApiError('Confirm', 409, {
        code: 'confirmation-required',
        requestedDelta: 120,
        currentQuantity: 300,
        absoluteThresholdUnits: 50,
        relativeThreshold: 0.5,
      }),
    );
    renderDialog({ correctStock });
    await screen.findByTestId('stock-correction-dialog');
    await userEvent.type(screen.getByTestId('stock-correction-quantity'), '7');
    await userEvent.click(screen.getByTestId('stock-correction-submit'));

    const block = await screen.findByTestId('stock-correction-large-change');
    expect(block).toHaveTextContent('+120 units');
    expect(block).toHaveTextContent('current count of 300');
    expect(block).toHaveTextContent('more than 50 units');
    expect(block).toHaveTextContent('50% of the current count');
  });

  it('should put the mode test ids on the clickable option', async () => {
    renderDialog({});
    await screen.findByTestId('stock-correction-dialog');
    expect(screen.getByTestId('stock-correction-mode-delta')).toHaveAttribute('role', 'radio');
    expect(screen.getByTestId('stock-correction-mode-set')).toHaveAttribute('role', 'radio');
  });

  it('should show no confirmation time when the master reported none', async () => {
    renderDialog({});
    await screen.findByTestId('stock-correction-dialog');
    await userEvent.type(screen.getByTestId('stock-correction-quantity'), '9');
    await userEvent.click(screen.getByTestId('stock-correction-submit'));

    expect(await screen.findByTestId('stock-correction-confirmed')).toBeInTheDocument();
    expect(screen.queryByTestId('stock-correction-applied-at')).not.toBeInTheDocument();
    expect(screen.getByTestId('stock-correction-applied-channels')).toHaveTextContent(
      'Allegro will publish 5, Erli will publish 7',
    );
  });

  it('should show the master time only when the master reported one', async () => {
    renderDialog({
      correctStock: vi.fn().mockResolvedValue(
        result({
          adjustmentOutcome: { disposition: 'applied', idempotency: 'honoured', appliedAt: '2026-09-26T08:41:00.000Z' },
        }),
      ),
    });
    await screen.findByTestId('stock-correction-dialog');
    await userEvent.type(screen.getByTestId('stock-correction-quantity'), '9');
    await userEvent.click(screen.getByTestId('stock-correction-submit'));

    expect(await screen.findByTestId('stock-correction-applied-at')).toBeInTheDocument();
  });

  it('should show the adapter sentence verbatim when the master refuses', async () => {
    renderDialog({
      correctStock: vi.fn().mockResolvedValue(
        result({
          status: 'refused',
          quantityAfter: null,
          refusal: { reason: 'master-refused', detail: 'Advanced Stock Management is on for this product.' },
        }),
      ),
    });
    await screen.findByTestId('stock-correction-dialog');
    await userEvent.type(screen.getByTestId('stock-correction-quantity'), '9');
    await userEvent.click(screen.getByTestId('stock-correction-submit'));

    expect(await screen.findByTestId('stock-correction-refused-reason')).toHaveTextContent(
      'Advanced Stock Management is on for this product.',
    );
    expect(screen.getByTestId('stock-correction-refused')).toHaveTextContent('Not applied');
  });

  it('should offer no retry when the outcome is in doubt', async () => {
    renderDialog({
      correctStock: vi.fn().mockResolvedValue(result({ status: 'in_doubt', quantityAfter: null })),
    });
    await screen.findByTestId('stock-correction-dialog');
    await userEvent.type(screen.getByTestId('stock-correction-quantity'), '9');
    await userEvent.click(screen.getByTestId('stock-correction-submit'));

    const inDoubt = await screen.findByTestId('stock-correction-in-doubt');
    expect(inDoubt).toHaveTextContent("couldn't confirm");
    expect(screen.queryByRole('button', { name: /try again|retry|save/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('stock-correction-close')).toBeInTheDocument();
  });

  it('should keep the form and name the problem when the server answers contended', async () => {
    renderDialog({
      correctStock: vi.fn().mockRejectedValue(new ApiError('busy', 409, { code: 'contended' })),
    });
    await screen.findByTestId('stock-correction-dialog');
    await userEvent.type(screen.getByTestId('stock-correction-quantity'), '9');
    await userEvent.click(screen.getByTestId('stock-correction-submit'));

    expect(await screen.findByTestId('stock-correction-error')).toHaveTextContent('being applied right now');
    expect(screen.getByTestId('stock-correction-quantity')).toBeInTheDocument();
  });

  it('should require a note when the reason is Other', async () => {
    const correctStock = vi.fn().mockResolvedValue(result());
    renderDialog({ correctStock });
    await screen.findByTestId('stock-correction-dialog');

    await userEvent.type(screen.getByTestId('stock-correction-quantity'), '9');
    await userEvent.selectOptions(screen.getByTestId('stock-correction-reason'), 'other');
    await userEvent.click(screen.getByTestId('stock-correction-submit'));

    expect(await screen.findByText('Say what happened when the reason is Other')).toBeInTheDocument();
    expect(correctStock).not.toHaveBeenCalled();
  });
});

describe('StockCorrectionDialog outcomes and guards', () => {
  it('should show the count the dialog started from, not a question mark, when the master refuses', async () => {
    renderDialog({
      correctStock: vi.fn().mockResolvedValue(
        result({ status: 'refused', quantityBefore: null, quantityAfter: null, requestedDelta: 3, refusal: null }),
      ),
    });
    await screen.findByTestId('stock-correction-dialog');
    await userEvent.type(screen.getByTestId('stock-correction-quantity'), '9');
    await userEvent.click(screen.getByTestId('stock-correction-submit'));

    const refused = await screen.findByTestId('stock-correction-refused');
    expect(refused).toHaveTextContent('Attempted: 6 → 9');
    expect(refused).not.toHaveTextContent('?');
  });

  it('should show the count the dialog started from, not a question mark, when the outcome is in doubt', async () => {
    renderDialog({
      correctStock: vi.fn().mockResolvedValue(
        result({ status: 'in_doubt', quantityBefore: null, quantityAfter: null, requestedDelta: 3 }),
      ),
    });
    await screen.findByTestId('stock-correction-dialog');
    await userEvent.type(screen.getByTestId('stock-correction-quantity'), '9');
    await userEvent.click(screen.getByTestId('stock-correction-submit'));

    const inDoubt = await screen.findByTestId('stock-correction-in-doubt');
    expect(inDoubt).toHaveTextContent('Sent: 6 → 9');
    expect(inDoubt).not.toHaveTextContent('?');
  });

  it('should show the operator target, not the server delta, when a set-mode correction is refused', async () => {
    renderDialog({
      correctStock: vi.fn().mockResolvedValue(
        result({ status: 'refused', quantityBefore: null, quantityAfter: null, requestedDelta: 2, refusal: null }),
      ),
    });
    await screen.findByTestId('stock-correction-dialog');
    await userEvent.type(screen.getByTestId('stock-correction-quantity'), '9');
    await userEvent.click(screen.getByTestId('stock-correction-submit'));

    expect(await screen.findByTestId('stock-correction-refused')).toHaveTextContent('Attempted: 6 → 9');
  });

  it('should warn but not block when a removal is larger than the stock OpenLinker shows', async () => {
    renderDialog({});
    await screen.findByTestId('stock-correction-dialog');

    await userEvent.click(screen.getByTestId('stock-correction-mode-delta'));
    await userEvent.type(screen.getByTestId('stock-correction-delta'), '-7');

    // The mirror can lag the master; the server judges against a fresh read.
    expect(screen.getByText(/OpenLinker shows only 6 in PrestaShop - Ceramika Nowak\./)).toBeInTheDocument();
    expect(screen.queryByText(/remove at most/)).toBeNull();
    expect(screen.getByTestId('stock-correction-diff')).toHaveTextContent('6 → 0');
  });

  it('should allow removing exactly the stock that is there', async () => {
    renderDialog({});
    await screen.findByTestId('stock-correction-dialog');

    await userEvent.click(screen.getByTestId('stock-correction-mode-delta'));
    await userEvent.type(screen.getByTestId('stock-correction-delta'), '-6');

    expect(screen.getByTestId('stock-correction-submit')).toBeEnabled();
  });

  it('should name the master count when the server refuses with insufficient-stock', async () => {
    renderDialog({
      correctStock: vi.fn().mockRejectedValue(new ApiError('no', 409, { code: 'insufficient-stock', currentQuantity: 5 })),
    });
    await screen.findByTestId('stock-correction-dialog');
    await userEvent.type(screen.getByTestId('stock-correction-quantity'), '2');
    await userEvent.click(screen.getByTestId('stock-correction-submit'));

    expect(await screen.findByTestId('stock-correction-error')).toHaveTextContent(
      'PrestaShop - Ceramika Nowak has only 5, so nothing changed.',
    );
  });

  it('should not claim a read happened when the master cannot be reached', async () => {
    renderDialog({
      correctStock: vi.fn().mockRejectedValue(new ApiError('down', 409, { code: 'master-unreadable' })),
    });
    await screen.findByTestId('stock-correction-dialog');
    await userEvent.type(screen.getByTestId('stock-correction-quantity'), '9');
    await userEvent.click(screen.getByTestId('stock-correction-submit'));

    const error = await screen.findByTestId('stock-correction-error');
    expect(error).toHaveTextContent('Nothing changed');
    expect(error).toHaveTextContent('PrestaShop - Ceramika Nowak');
  });

  it('should leave out the "within a minute" promise when the product has no channels', async () => {
    renderDialog({}, { ...adjustTarget, stock: stock({ channels: [] }) });
    await screen.findByTestId('stock-correction-dialog');
    await userEvent.type(screen.getByTestId('stock-correction-quantity'), '9');

    expect(screen.queryByText(/usually catch up within a minute/i)).not.toBeInTheDocument();
  });

  it('should keep the "within a minute" promise when the product has channels', async () => {
    renderDialog({});
    await screen.findByTestId('stock-correction-dialog');
    await userEvent.type(screen.getByTestId('stock-correction-quantity'), '9');

    expect(screen.getByText(/usually catch up within a minute/i)).toBeInTheDocument();
  });
});


describe('Adjust stock entry point', () => {
  it('should not open the dialog for a view-only session', async () => {
    const onAdjust = vi.fn();
    const variant = { id: 'v1', sku: 'KCN-350-GRY', attributes: null };
    const rows = buildStockRows({
      variants: [variant],
      inventoryItems: [],
      stockByVariant: new Map([['v1', stock()]]),
      pending: false,
      restricted: false,
      canAdjust: false,
      fallbackMasterName: null,
    });
    renderWithProviders(
      <StockActions
        row={rows.get('v1')!}
        stock={{ rows, channelsStatus: 'ok', canAdjust: false, onAdjust }}
      />,
      { apiClient: createMockApiClient({}) },
    );

    const button = await screen.findByTestId('stock-adjust-KCN-350-GRY');
    expect(button).toBeDisabled();
    expect(screen.getByTestId('stock-adjust-hint-KCN-350-GRY')).toHaveTextContent(
      'Only admins and operators can change stock.',
    );
    await userEvent.click(button);
    expect(onAdjust).not.toHaveBeenCalled();
  });
});

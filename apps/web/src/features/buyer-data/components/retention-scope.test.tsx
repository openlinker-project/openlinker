/**
 * RetentionScope tests (#4289)
 *
 * The scope ties the master switch to the plan for the rules on screen, so what
 * is pinned is that: the debounced, abortable plan request, "never a zero while
 * counting", the lock until the plan is fresh, and the histogram failing without
 * taking the inputs with it.
 */
import { useState, type ReactElement } from 'react';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { BuyerDataRules } from '../api/buyer-data.types';
import { RetentionScope } from './retention-scope';

const RULES: BuyerDataRules = {
  enabled: false,
  hideAfterDays: 90,
  eraseAfterDays: 365,
  mode: 'personal-data',
};

const PREVIEW = {
  toHide: 300,
  toErase: 100,
  alreadyHiddenDueForErase: 0,
  total: 300,
  totalOrders: 1000,
  skippedProtected: 4,
  skippedByReason: { openReturn: 3, hold: 1, invoicePending: 0 },
  samples: [],
};

function Harness({ connectionId }: { connectionId?: string }): ReactElement {
  const [rules, setRules] = useState(RULES);
  return (
    <>
      <RetentionScope
        name="t"
        rules={rules}
        savedEnabled={false}
        onChange={setRules}
        connectionId={connectionId}
      />
      <output data-testid="rules">{JSON.stringify(rules)}</output>
    </>
  );
}

afterEach(cleanup);

describe('RetentionScope (#4289)', () => {
  it('should lock the switch until the plan is calculated, then unlock it', async () => {
    renderWithProviders(<Harness />, {
      apiClient: createMockApiClient({
        buyerData: { preview: vi.fn().mockResolvedValue(PREVIEW) },
      }),
    });

    const sw = screen.getByRole('switch', { name: 'Turn on the rules' });
    expect(sw).toBeDisabled();
    await waitFor(() => expect(sw).toBeEnabled());
    expect(await screen.findByTestId('plan-stays')).toHaveTextContent('700');
    expect(screen.getByTestId('plan-hidden')).toHaveTextContent('200');
    expect(screen.getByTestId('plan-erased')).toHaveTextContent('100');
  });

  it('should never show a zero while the first plan is on its way', () => {
    const preview = vi.fn().mockReturnValue(new Promise(() => undefined));
    renderWithProviders(<Harness />, {
      apiClient: createMockApiClient({ buyerData: { preview } }),
    });

    expect(screen.getByTestId('plan-stays')).not.toHaveTextContent('0');
    expect(screen.getAllByLabelText('Calculating…').length).toBeGreaterThan(0);
  });

  it('should send the scope and abort the previous request when the rules change', async () => {
    const signals: AbortSignal[] = [];
    const preview = vi.fn().mockImplementation((_input: unknown, signal?: AbortSignal) => {
      if (signal !== undefined) signals.push(signal);
      // The first answer never arrives, so the second request has to abort it.
      return signals.length === 1 ? new Promise(() => undefined) : Promise.resolve(PREVIEW);
    });
    renderWithProviders(<Harness connectionId="conn-9" />, {
      apiClient: createMockApiClient({ buyerData: { preview } }),
    });

    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    expect(preview.mock.calls[0]?.[0]).toMatchObject({
      connectionId: 'conn-9',
      hideAfterDays: 90,
      eraseAfterDays: 365,
    });

    const hide = await screen.findByTestId('age-strip-handle-hide');
    hide.focus();
    await userEvent.keyboard('{ArrowRight}');

    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
    expect(preview.mock.calls[1]?.[0]).toMatchObject({ hideAfterDays: 180 });
    expect(signals[0]?.aborted).toBe(true);
  });

  it('should keep the inputs working and say so when the strip cannot load', async () => {
    const ageHistogram = vi.fn().mockRejectedValue(new Error('boom'));
    renderWithProviders(<Harness />, {
      apiClient: createMockApiClient({ buyerData: { ageHistogram } }),
    });

    expect(await screen.findByTestId('age-strip-error')).toBeInTheDocument();
    expect(screen.getByTestId('period-input-t-hide')).toBeInTheDocument();
  });

  it('should reflect a typed period on the strip and in the rules', async () => {
    renderWithProviders(<Harness />, { apiClient: createMockApiClient() });

    const input = within(screen.getByTestId('period-input-t-hide')).getByRole('spinbutton');
    await userEvent.clear(input);
    await userEvent.type(input, '6');
    // 6 months = 180 days, the unit stays months.
    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId('rules').textContent ?? '')).toMatchObject({
        hideAfterDays: 180,
      })
    );
    expect(screen.getByTestId('age-strip-handle-hide')).toHaveAttribute('aria-valuenow', '180');
  });

  it('should turn a cut off with the never checkbox and back on', async () => {
    renderWithProviders(<Harness />, { apiClient: createMockApiClient() });

    await userEvent.click(screen.getByTestId('period-never-t-erase'));
    expect(JSON.parse(screen.getByTestId('rules').textContent ?? '')).toMatchObject({
      eraseAfterDays: 0,
    });
    await userEvent.click(screen.getByTestId('period-never-t-erase'));
    expect(JSON.parse(screen.getByTestId('rules').textContent ?? '')).toMatchObject({
      eraseAfterDays: 365,
    });
  });
});

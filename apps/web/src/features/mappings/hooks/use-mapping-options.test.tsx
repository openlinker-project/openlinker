/**
 * useMappingOptions tests (#472 / #474)
 *
 * Verifies the parameterised `getMappingOptions(connectionId, side, kind)`
 * call shape and that #474's acceptance criterion holds — Allegro delivery
 * methods reach the dropdown bundle as `{value, label}` pairs (label is the
 * human-readable rate-method name, not a bare UUID).
 *
 * @module apps/web/src/features/mappings/hooks
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import type {
  MappingOption,
  MappingOptionKind,
  MappingSide,
} from '../api/mappings.types';
import { useMappingOptions } from './use-mapping-options';

function wrapper(
  apiClient: ReturnType<typeof createMockApiClient>,
): (props: { children: ReactNode }) => ReactElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }) => (
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}

const ALLEGRO_DELIVERY_METHODS: MappingOption[] = [
  { value: 'paczkomat-uuid-1', label: 'Allegro Paczkomaty InPost' },
  { value: 'courier-uuid-2', label: 'Allegro Kurier DPD' },
];

const ALLEGRO_ORDER_STATUSES: MappingOption[] = [
  { value: 'BOUGHT', label: 'Bought (awaiting payment)' },
  { value: 'READY_FOR_PROCESSING', label: 'Ready for processing (paid)' },
];

const PS_CARRIERS: MappingOption[] = [
  { value: '7', label: 'Click and collect' },
  { value: '12', label: 'DPD home delivery' },
];

describe('useMappingOptions', () => {
  it('issues one request per (side, kind) pair and bundles them by domain key', async () => {
    const getMappingOptions = vi.fn(
      (_connectionId: string, side: MappingSide, kind: MappingOptionKind) => {
        const key = `${side}/${kind}` as const;
        switch (key) {
          case 'source/order-statuses':
            return Promise.resolve(ALLEGRO_ORDER_STATUSES);
          case 'source/delivery-methods':
            return Promise.resolve(ALLEGRO_DELIVERY_METHODS);
          case 'destination/carriers':
            return Promise.resolve(PS_CARRIERS);
          default:
            return Promise.resolve<MappingOption[]>([]);
        }
      },
    );
    const apiClient = createMockApiClient({ mappings: { getMappingOptions } });

    const { result } = renderHook(() => useMappingOptions('conn-1'), {
      wrapper: wrapper(apiClient),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // All 6 pairs requested exactly once.
    expect(getMappingOptions).toHaveBeenCalledTimes(6);
    expect(getMappingOptions).toHaveBeenCalledWith('conn-1', 'source', 'order-statuses');
    expect(getMappingOptions).toHaveBeenCalledWith('conn-1', 'source', 'delivery-methods');
    expect(getMappingOptions).toHaveBeenCalledWith('conn-1', 'source', 'payment-methods');
    expect(getMappingOptions).toHaveBeenCalledWith('conn-1', 'destination', 'order-statuses');
    expect(getMappingOptions).toHaveBeenCalledWith('conn-1', 'destination', 'carriers');
    expect(getMappingOptions).toHaveBeenCalledWith('conn-1', 'destination', 'payment-methods');

    // #474 acceptance: delivery-method labels reach the bundle as human strings.
    expect(result.current.options.allegroDeliveryMethods).toEqual(ALLEGRO_DELIVERY_METHODS);
    expect(result.current.options.allegroOrderStatuses).toEqual(ALLEGRO_ORDER_STATUSES);
    expect(result.current.options.prestashopCarriers).toEqual(PS_CARRIERS);
    expect(result.current.options.allegroPaymentProviders).toEqual([]);
    expect(result.current.options.prestashopPaymentModules).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('surfaces the first error when any side fails to load', async () => {
    const failure = new Error('Adapter does not implement SourceOptionsReader');
    const getMappingOptions = vi.fn(
      (_connectionId: string, side: MappingSide, kind: MappingOptionKind) => {
        if (side === 'source' && kind === 'delivery-methods') {
          return Promise.reject(failure);
        }
        return Promise.resolve<MappingOption[]>([]);
      },
    );
    const apiClient = createMockApiClient({ mappings: { getMappingOptions } });

    const { result } = renderHook(() => useMappingOptions('conn-1'), {
      wrapper: wrapper(apiClient),
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toContain('SourceOptionsReader');
  });
});

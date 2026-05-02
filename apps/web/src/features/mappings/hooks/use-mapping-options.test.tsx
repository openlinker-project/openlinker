/**
 * useMappingOptions tests (#472 / #474 / #484)
 *
 * Verifies the parameterised `getMappingOptions(connectionId, side, kind)`
 * call shape, #474's delivery-method label hydration, and #484's per-bundle
 * error isolation — a single failed query must not poison the other five.
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
    expect(result.current.errors).toEqual({});
  });

  it('isolates per-bundle errors so one failed query does not block the others (#484)', async () => {
    const failure = new Error('Adapter does not implement SourceOptionsReader');
    const getMappingOptions = vi.fn(
      (_connectionId: string, side: MappingSide, kind: MappingOptionKind) => {
        if (side === 'source' && kind === 'delivery-methods') {
          return Promise.reject(failure);
        }
        if (side === 'destination' && kind === 'carriers') {
          return Promise.resolve(PS_CARRIERS);
        }
        return Promise.resolve<MappingOption[]>([]);
      },
    );
    const apiClient = createMockApiClient({ mappings: { getMappingOptions } });

    const { result } = renderHook(() => useMappingOptions('conn-1'), {
      wrapper: wrapper(apiClient),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // The failing query lands in `errors` under its bundle key…
    expect(result.current.errors.allegroDeliveryMethods?.message).toContain(
      'SourceOptionsReader',
    );
    // …and only that key — the other five must not be marked as errored.
    expect(result.current.errors.allegroOrderStatuses).toBeUndefined();
    expect(result.current.errors.allegroPaymentProviders).toBeUndefined();
    expect(result.current.errors.prestashopOrderStatuses).toBeUndefined();
    expect(result.current.errors.prestashopCarriers).toBeUndefined();
    expect(result.current.errors.prestashopPaymentModules).toBeUndefined();
    // The successful sibling query still hydrates its bundle.
    expect(result.current.options.prestashopCarriers).toEqual(PS_CARRIERS);
  });

  it('reports both keys when two queries fail in parallel (#484)', async () => {
    const sourceFailure = new Error('source/payment-methods failed');
    const destinationFailure = new Error('destination/payment-methods failed');
    const getMappingOptions = vi.fn(
      (_connectionId: string, side: MappingSide, kind: MappingOptionKind) => {
        if (kind === 'payment-methods' && side === 'source') {
          return Promise.reject(sourceFailure);
        }
        if (kind === 'payment-methods' && side === 'destination') {
          return Promise.reject(destinationFailure);
        }
        return Promise.resolve<MappingOption[]>([]);
      },
    );
    const apiClient = createMockApiClient({ mappings: { getMappingOptions } });

    const { result } = renderHook(() => useMappingOptions('conn-1'), {
      wrapper: wrapper(apiClient),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(Object.keys(result.current.errors).sort()).toEqual([
      'allegroPaymentProviders',
      'prestashopPaymentModules',
    ]);
    expect(result.current.errors.allegroPaymentProviders).toBe(sourceFailure);
    expect(result.current.errors.prestashopPaymentModules).toBe(destinationFailure);
  });
});

/**
 * RoutingRulesPanel tests (#836)
 *
 * @module apps/web/src/features/mappings/components
 */

import type { ComponentProps } from 'react';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../../test/test-utils';
import { RoutingRulesPanel } from './routing-rules-panel';
import type { MappingsApi } from '../api/mappings.api';
import type {
  CandidateProcessor,
  MappingOption,
  RoutingRule,
} from '../api/mappings.types';
import type { Connection } from '../../connections';

const DELIVERY_METHODS: MappingOption[] = [
  { value: 'm1', label: 'InPost Paczkomat' },
  { value: 'm2', label: 'Kurier24' },
];

const CANDIDATES: CandidateProcessor[] = [
  { processorKind: 'omp_fulfilled', processorConnectionId: 'conn_ps' },
  { processorKind: 'source_brokered', processorConnectionId: 'conn_allegro' },
  { processorKind: 'ol_managed_carrier', processorConnectionId: 'conn_inpost' },
];

const CONNECTIONS: Connection[] = [
  { ...sampleConnection, id: 'conn_ps', name: 'My Shop' },
  { ...sampleConnection, id: 'conn_allegro', name: 'Allegro Main' },
  { ...sampleConnection, id: 'conn_inpost', name: 'InPost' },
];

interface RoutingMocks {
  rules?: RoutingRule[];
  candidates?: CandidateProcessor[];
  replace?: ReturnType<typeof vi.fn>;
}

function buildApiClient(mocks: RoutingMocks = {}): ReturnType<typeof createMockApiClient> {
  return createMockApiClient({
    mappings: {
      getRoutingRules: vi.fn().mockResolvedValue(mocks.rules ?? []),
      getRoutingCandidates: vi.fn().mockResolvedValue(mocks.candidates ?? CANDIDATES),
      replaceRoutingRules: (mocks.replace ??
        vi.fn().mockResolvedValue([])) as MappingsApi['replaceRoutingRules'],
    },
    connections: {
      list: vi.fn().mockResolvedValue(CONNECTIONS),
    },
  });
}

function renderPanel(
  apiClient: ReturnType<typeof createMockApiClient>,
  props: Partial<ComponentProps<typeof RoutingRulesPanel>> = {},
): void {
  renderWithProviders(
    <RoutingRulesPanel
      connectionId="conn_1"
      deliveryMethods={DELIVERY_METHODS}
      deliveryMethodsLoading={false}
      deliveryMethodsError={null}
      {...props}
    />,
    { apiClient },
  );
}

describe('RoutingRulesPanel', () => {
  afterEach(cleanup);

  it('shows the loading state while delivery methods load', () => {
    renderPanel(buildApiClient(), { deliveryMethodsLoading: true });
    expect(screen.getByText('Loading fulfillment routing')).toBeInTheDocument();
  });

  it('shows the error state when delivery methods fail to load', async () => {
    renderPanel(buildApiClient(), { deliveryMethodsError: new Error('boom') });
    // The panel's own queries settle first; once they do, the injected
    // delivery-methods error wins over the (loaded) empty data.
    expect(
      await screen.findByText('Unable to load routing configuration'),
    ).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('shows the empty state when the source reports no delivery methods', async () => {
    renderPanel(buildApiClient(), { deliveryMethods: [] });
    expect(
      await screen.findByText(/reported no delivery methods to route/i),
    ).toBeInTheDocument();
  });

  it('defaults every method to the OMP and offers only non-OMP divert options', async () => {
    renderPanel(buildApiClient());

    const select = await screen.findByRole('combobox', {
      name: /Fulfillment processor for InPost Paczkomat/i,
    });
    // Default selection is rule-absence.
    expect(select).toHaveValue('__default__');

    const optionLabels = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent ?? '');
    // Default option is data-driven from the omp_fulfilled candidate's connection.
    expect(optionLabels.some((l) => /My Shop.*default/.test(l))).toBe(true);
    // omp_fulfilled is the default — never offered as an explicit divert option.
    expect(optionLabels.some((l) => l.includes('Order-management platform'))).toBe(false);
    // The two non-OMP candidates ARE offered.
    expect(optionLabels.some((l) => l.includes('Marketplace-brokered'))).toBe(true);
    expect(optionLabels.some((l) => l.includes('OpenLinker-managed carrier'))).toBe(true);
  });

  it('persists only diverted methods via the replace-all mutation', async () => {
    const replace = vi.fn().mockResolvedValue([]);
    renderPanel(buildApiClient({ replace }));

    const select = await screen.findByRole('combobox', {
      name: /Fulfillment processor for InPost Paczkomat/i,
    });
    fireEvent.change(select, { target: { value: 'source_brokered::conn_allegro' } });

    expect(await screen.findByText('Unsaved changes')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save routing' }));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('conn_1', {
        items: [
          {
            sourceDeliveryMethodId: 'm1',
            processorKind: 'source_brokered',
            processorConnectionId: 'conn_allegro',
          },
        ],
      });
    });
  });

  it('pre-populates a saved rule and stays clean until edited', async () => {
    const rules: RoutingRule[] = [
      {
        id: 'r1',
        sourceConnectionId: 'conn_1',
        sourceDeliveryMethodId: 'm1',
        processorKind: 'ol_managed_carrier',
        processorConnectionId: 'conn_inpost',
      },
    ];
    renderPanel(buildApiClient({ rules }));

    const select = await screen.findByRole('combobox', {
      name: /Fulfillment processor for InPost Paczkomat/i,
    });
    await waitFor(() => {
      expect(select).toHaveValue('ol_managed_carrier::conn_inpost');
    });
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  describe('routing-split bar (#1739)', () => {
    function legendEntry(container: HTMLElement, label: string): HTMLElement {
      const entry = Array.from(
        container.querySelectorAll<HTMLElement>('.routing-split__key'),
      ).find((el) => (el.textContent ?? '').includes(label));
      if (!entry) throw new Error(`No legend entry for ${label}`);
      return entry;
    }

    it('counts saved rules per processor with the rest in the default bucket', async () => {
      const rules: RoutingRule[] = [
        {
          id: 'r1',
          sourceConnectionId: 'conn_1',
          sourceDeliveryMethodId: 'm1',
          processorKind: 'ol_managed_carrier',
          processorConnectionId: 'conn_inpost',
        },
      ];
      const { container } = renderWithProviders(
        <RoutingRulesPanel
          connectionId="conn_1"
          deliveryMethods={DELIVERY_METHODS}
          deliveryMethodsLoading={false}
          deliveryMethodsError={null}
        />,
        { apiClient: buildApiClient({ rules }) },
      );

      await screen.findByRole('combobox', {
        name: /Fulfillment processor for InPost Paczkomat/i,
      });
      await waitFor(() => {
        expect(legendEntry(container, 'InPost')).toHaveTextContent('1');
      });
      // m2 has no rule → default bucket, labeled from the omp candidate.
      expect(legendEntry(container, 'My Shop')).toHaveTextContent('1');
    });

    it('recomputes the split live when a selection changes, before saving', async () => {
      const { container } = renderWithProviders(
        <RoutingRulesPanel
          connectionId="conn_1"
          deliveryMethods={DELIVERY_METHODS}
          deliveryMethodsLoading={false}
          deliveryMethodsError={null}
        />,
        { apiClient: buildApiClient() },
      );

      const select = await screen.findByRole('combobox', {
        name: /Fulfillment processor for InPost Paczkomat/i,
      });
      await waitFor(() => {
        expect(legendEntry(container, 'My Shop')).toHaveTextContent('2');
      });

      fireEvent.change(select, { target: { value: 'ol_managed_carrier::conn_inpost' } });

      expect(legendEntry(container, 'InPost')).toHaveTextContent('1');
      expect(legendEntry(container, 'My Shop')).toHaveTextContent('1');
      // Live preview only — nothing saved yet.
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    });

    it('renders Erli-shaped string method ids and saves their rules through the same flow', async () => {
      const erliMethods: MappingOption[] = [
        { value: 'erliPaczkomat', label: 'ERLI InPost Paczkomaty 24/7' },
        { value: 'dpdCod', label: 'Kurier DPD Pobranie' },
      ];
      const replace = vi.fn().mockResolvedValue([]);
      renderPanel(buildApiClient({ replace }), { deliveryMethods: erliMethods });

      const select = await screen.findByRole('combobox', {
        name: /Fulfillment processor for ERLI InPost Paczkomaty/i,
      });
      fireEvent.change(select, { target: { value: 'ol_managed_carrier::conn_inpost' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save routing' }));

      await waitFor(() => {
        expect(replace).toHaveBeenCalledWith('conn_1', {
          items: [
            {
              sourceDeliveryMethodId: 'erliPaczkomat',
              processorKind: 'ol_managed_carrier',
              processorConnectionId: 'conn_inpost',
            },
          ],
        });
      });
    });
  });
});

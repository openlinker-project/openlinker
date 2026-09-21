/**
 * StockAndPricingSection tests (#2610, #3206/#3207)
 *
 * @module features/connections/components
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test harness wraps RHF with a flexible form type */
import type { ReactElement } from 'react';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import type { PaginatedInventoryLocations } from '../../inventory';
import { StockAndPricingSection } from './stock-and-pricing-section';

interface HarnessProps {
  configIsParseable?: boolean;
  syncStockPolicyToJson?: () => void;
  syncPricingRuleToJson?: () => void;
  syncStockLocationOverrideToJson?: () => void;
  initialStockPolicy?: { safetyBuffer?: string; zeroThreshold?: string };
  initialPricingRule?: { type?: string; percent?: string; rounding?: string };
  initialStockLocationOverride?: string;
  pricingRuleManagedElsewhere?: { href: string };
}

function Harness({
  configIsParseable = true,
  syncStockPolicyToJson = (): void => {},
  syncPricingRuleToJson = (): void => {},
  syncStockLocationOverrideToJson = (): void => {},
  initialStockPolicy,
  initialPricingRule,
  initialStockLocationOverride,
  pricingRuleManagedElsewhere,
}: HarnessProps): ReactElement {
  const form = useForm<any>({
    defaultValues: {
      stockPolicy: initialStockPolicy ?? { safetyBuffer: '', zeroThreshold: '' },
      pricingRule: initialPricingRule ?? { type: '', percent: '', rounding: '' },
      stockLocationOverride: initialStockLocationOverride ?? '',
    },
  });
  return (
    <StockAndPricingSection
      form={form as any}
      configIsParseable={configIsParseable}
      syncStockPolicyToJson={syncStockPolicyToJson}
      syncPricingRuleToJson={syncPricingRuleToJson}
      syncStockLocationOverrideToJson={syncStockLocationOverrideToJson}
      pricingRuleManagedElsewhere={pricingRuleManagedElsewhere}
    />
  );
}

// Hoisted to a stable reference (#3334) — `useForm({ errors })` re-syncs
// form state via an effect keyed on this object's identity, so a fresh
// literal recreated every `ErroredHarness` render causes react-hook-form to
// re-sync on every render, which re-renders `ErroredHarness`, which creates
// a new literal again: an infinite render loop with no thrown error and no
// console output (never trips React's "Maximum update depth exceeded"),
// which only reads as CI going silent until the job's timeout kills it.
const UNKNOWN_LOCATION_FORM_ERRORS = {
  stockLocationOverride: {
    type: 'server',
    message: 'config.stockLocationOverride names an unknown location: ol_location_1',
  },
};

const ONE_ACTIVE_LOCATION: PaginatedInventoryLocations = {
  items: [
    {
      id: 'ol_location_1',
      code: 'WH1',
      name: 'Main warehouse',
      kind: 'warehouse',
      ownerConnectionId: null,
      externalRef: null,
      status: 'active',
      countryIso2: null,
      postcode: null,
      latitude: null,
      longitude: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  total: 1,
  page: 1,
  limit: 200,
};

describe('StockAndPricingSection', () => {
  afterEach(cleanup);

  it('hides both groups by default', () => {
    renderWithProviders(<Harness />);
    expect(screen.getByLabelText('Publish less stock than you hold')).not.toBeChecked();
    expect(screen.queryByLabelText('Units to hold back')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('How to set the price')).not.toBeInTheDocument();
  });

  it('hydrates the stock group open when a buffer is stored', () => {
    renderWithProviders(<Harness initialStockPolicy={{ safetyBuffer: '3', zeroThreshold: '' }} />);
    expect(screen.getByLabelText('Publish less stock than you hold')).toBeChecked();
    expect(screen.getByLabelText('Units to hold back')).toHaveValue('3');
  });

  it('hydrates the stock group open on an explicit stored 0 — a 0 is a real value, not unset', () => {
    renderWithProviders(<Harness initialStockPolicy={{ safetyBuffer: '0', zeroThreshold: '' }} />);
    expect(screen.getByLabelText('Publish less stock than you hold')).toBeChecked();
    expect(screen.getByLabelText('Units to hold back')).toHaveValue('0');
  });

  it('states the published quantity for the worked example', () => {
    renderWithProviders(<Harness initialStockPolicy={{ safetyBuffer: '4', zeroThreshold: '' }} />);
    expect(screen.getByText(/10 units/)).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
  });

  it('states 0 for the worked example when the threshold bites', () => {
    renderWithProviders(<Harness initialStockPolicy={{ safetyBuffer: '4', zeroThreshold: '8' }} />);
    // Two zeros now: the 10-unit example, and the low-stock case the floor is
    // actually about.
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1);
  });

  it('states a low-stock case so a floor demonstrates something (#2610)', () => {
    renderWithProviders(<Harness initialStockPolicy={{ safetyBuffer: '0', zeroThreshold: '5' }} />);
    expect(screen.getByText('4 units')).toBeInTheDocument();
  });

  it('clears both stock knobs and re-syncs when the group is switched off', () => {
    const syncStockPolicyToJson = vi.fn();
    renderWithProviders(
      <Harness
        initialStockPolicy={{ safetyBuffer: '4', zeroThreshold: '2' }}
        syncStockPolicyToJson={syncStockPolicyToJson}
      />,
    );
    fireEvent.click(screen.getByLabelText('Publish less stock than you hold'));
    expect(screen.queryByLabelText('Units to hold back')).not.toBeInTheDocument();
    expect(syncStockPolicyToJson).toHaveBeenCalled();
  });

  it('states the published price for a markup', () => {
    renderWithProviders(
      <Harness initialPricingRule={{ type: 'markup', percent: '25', rounding: 'none' }} />,
    );
    expect(screen.getByText('100.00')).toBeInTheDocument();
    expect(screen.getByText('125.00')).toBeInTheDocument();
  });

  it('states the published price for a margin', () => {
    renderWithProviders(
      <Harness initialPricingRule={{ type: 'margin', percent: '25', rounding: 'none' }} />,
    );
    expect(screen.getByText('133.33')).toBeInTheDocument();
  });

  it('hides the percentage field for a passthrough rule', () => {
    renderWithProviders(
      <Harness initialPricingRule={{ type: 'passthrough', percent: '', rounding: 'none' }} />,
    );
    expect(screen.getByLabelText('How to set the price')).toHaveValue('passthrough');
    expect(screen.queryByLabelText('Percentage')).not.toBeInTheDocument();
  });

  it('disables every control when the raw config JSON is unparseable', () => {
    renderWithProviders(<Harness configIsParseable={false} initialStockPolicy={{ safetyBuffer: '4' }} />);
    expect(screen.getByLabelText('Units to hold back')).toBeDisabled();
    expect(screen.getByLabelText('Publish less stock than you hold')).toBeDisabled();
  });

  describe('pricingRuleManagedElsewhere (#3149/#3166 review)', () => {
    it('replaces the editable pricing-rule fields with a read-only pointer', () => {
      renderWithProviders(
        <Harness
          initialPricingRule={{ type: 'margin', percent: '22', rounding: 'endingIn99' }}
          pricingRuleManagedElsewhere={{ href: '/connections/dest-1/pricing-sync' }}
        />,
      );
      expect(
        screen.queryByLabelText('Publish a different price than your catalogue'),
      ).not.toBeInTheDocument();
      expect(screen.queryByLabelText('How to set the price')).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Manage pricing & sync' })).toHaveAttribute(
        'href',
        '/connections/dest-1/pricing-sync',
      );
    });

    it('leaves the stock-publish-policy half untouched', () => {
      renderWithProviders(
        <Harness
          initialStockPolicy={{ safetyBuffer: '4', zeroThreshold: '' }}
          pricingRuleManagedElsewhere={{ href: '/connections/dest-1/pricing-sync' }}
        />,
      );
      expect(screen.getByLabelText('Publish less stock than you hold')).toBeChecked();
      expect(screen.getByLabelText('Units to hold back')).toHaveValue('4');
    });
  });

  describe('stock-location override (#3206/#3207)', () => {
    it('does not render the group when no inventory_locations row exists', async () => {
      // The default mock apiClient's `inventory.listLocations` resolves an
      // empty page (see test-utils.tsx) - the AC-1 gate.
      renderWithProviders(<Harness />);
      await waitFor(() =>
        expect(
          screen.queryByLabelText("Assign a location to this connection's stock"),
        ).not.toBeInTheDocument(),
      );
    });

    it('renders the group, closed by default, once at least one location exists', async () => {
      const apiClient = createMockApiClient({
        inventory: { listLocations: vi.fn().mockResolvedValue(ONE_ACTIVE_LOCATION) },
      });
      renderWithProviders(<Harness />, { apiClient });

      const toggle = await screen.findByLabelText("Assign a location to this connection's stock");
      expect(toggle).not.toBeChecked();
      expect(screen.queryByLabelText('Location')).not.toBeInTheDocument();
    });

    it('hydrates the group open with the stored location selected', async () => {
      const apiClient = createMockApiClient({
        inventory: { listLocations: vi.fn().mockResolvedValue(ONE_ACTIVE_LOCATION) },
      });
      renderWithProviders(<Harness initialStockLocationOverride="ol_location_1" />, { apiClient });

      const toggle = await screen.findByLabelText("Assign a location to this connection's stock");
      expect(toggle).toBeChecked();
      expect(await screen.findByLabelText('Location')).toHaveValue('ol_location_1');
    });

    it('renders a retired location so a stored-but-now-inactive value keeps its real name', async () => {
      const apiClient = createMockApiClient({
        inventory: {
          listLocations: vi.fn().mockResolvedValue({
            ...ONE_ACTIVE_LOCATION,
            items: [{ ...ONE_ACTIVE_LOCATION.items[0], status: 'inactive' as const }],
          }),
        },
      });
      renderWithProviders(<Harness initialStockLocationOverride="ol_location_1" />, { apiClient });

      await screen.findByLabelText("Assign a location to this connection's stock");
      expect(screen.getByRole('option', { name: /Main warehouse \(WH1\) — inactive/ })).toBeInTheDocument();
    });

    it('states the assertion-not-detection copy when the group is open', async () => {
      const apiClient = createMockApiClient({
        inventory: { listLocations: vi.fn().mockResolvedValue(ONE_ACTIVE_LOCATION) },
      });
      renderWithProviders(<Harness initialStockLocationOverride="ol_location_1" />, { apiClient });

      await screen.findByLabelText("Assign a location to this connection's stock");
      expect(screen.getByText(/attesting that all of this connection's currently un-located stock/)).toBeInTheDocument();
      expect(screen.getByText(/if you operate more than one physical warehouse/)).toBeInTheDocument();
    });

    it('sets the value and re-syncs on selection', async () => {
      const syncStockLocationOverrideToJson = vi.fn();
      const apiClient = createMockApiClient({
        inventory: { listLocations: vi.fn().mockResolvedValue(ONE_ACTIVE_LOCATION) },
      });
      renderWithProviders(
        <Harness syncStockLocationOverrideToJson={syncStockLocationOverrideToJson} />,
        { apiClient },
      );

      fireEvent.click(await screen.findByLabelText("Assign a location to this connection's stock"));
      fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'ol_location_1' } });

      expect(screen.getByLabelText('Location')).toHaveValue('ol_location_1');
      expect(syncStockLocationOverrideToJson).toHaveBeenCalled();
    });

    it('clears the value and re-syncs when the group is switched off', async () => {
      const syncStockLocationOverrideToJson = vi.fn();
      const apiClient = createMockApiClient({
        inventory: { listLocations: vi.fn().mockResolvedValue(ONE_ACTIVE_LOCATION) },
      });
      renderWithProviders(
        <Harness
          initialStockLocationOverride="ol_location_1"
          syncStockLocationOverrideToJson={syncStockLocationOverrideToJson}
        />,
        { apiClient },
      );

      const toggle = await screen.findByLabelText("Assign a location to this connection's stock");
      fireEvent.click(toggle);
      expect(screen.queryByLabelText('Location')).not.toBeInTheDocument();
      expect(syncStockLocationOverrideToJson).toHaveBeenCalled();
    });

    it('surfaces a field-level error passed via form state', async () => {
      const apiClient = createMockApiClient({
        inventory: { listLocations: vi.fn().mockResolvedValue(ONE_ACTIVE_LOCATION) },
      });
      function ErroredHarness(): ReactElement {
        const form = useForm<any>({
          defaultValues: { stockLocationOverride: 'ol_location_1' },
          errors: UNKNOWN_LOCATION_FORM_ERRORS,
        });
        return (
          <StockAndPricingSection
            form={form as any}
            configIsParseable
            syncStockPolicyToJson={() => {}}
            syncPricingRuleToJson={() => {}}
            syncStockLocationOverrideToJson={() => {}}
          />
        );
      }
      renderWithProviders(<ErroredHarness />, { apiClient });

      await screen.findByLabelText("Assign a location to this connection's stock");
      expect(
        await screen.findByText('config.stockLocationOverride names an unknown location: ol_location_1'),
      ).toBeInTheDocument();
    });

    it('disables the toggle when the raw config JSON is unparseable', async () => {
      const apiClient = createMockApiClient({
        inventory: { listLocations: vi.fn().mockResolvedValue(ONE_ACTIVE_LOCATION) },
      });
      renderWithProviders(<Harness configIsParseable={false} />, { apiClient });

      expect(
        await screen.findByLabelText("Assign a location to this connection's stock"),
      ).toBeDisabled();
    });
  });
});

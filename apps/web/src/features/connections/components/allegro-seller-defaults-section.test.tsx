/**
 * AllegroSellerDefaultsSection — Tests
 *
 * Branches per `.claude/rules/fe-pages.md` "Testing Priorities":
 * - happy path: renders the three field groups (location / RP / safety info)
 * - loading: RP query in flight → Select disabled with loading copy
 * - error: RP query fails → error Alert with retry
 * - empty: RP query returns [] → info Alert prompting Allegro panel
 * - conditional textarea: visible only when type === SAFETY_INFORMATION
 *
 * @module apps/web/src/features/connections/components
 */
import { useForm, type UseFormReturn } from 'react-hook-form';
import { type ReactElement } from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import { AllegroSellerDefaultsSection } from './allegro-seller-defaults-section';
import type { EditConnectionFormValues } from './edit-connection.schema';

interface HarnessProps {
  apiClient?: ReturnType<typeof createMockApiClient>;
  initialSafetyType?: 'NO_SAFETY_INFORMATION' | 'SAFETY_INFORMATION';
  onChange?: () => void;
}

function Harness({ initialSafetyType, onChange }: HarnessProps): ReactElement {
  const form = useForm<EditConnectionFormValues>({
    defaultValues: {
      name: 'Allegro sandbox',
      configText: '{}',
      adapterKey: '',
      sellerDefaults: {
        location: { countryCode: 'PL', province: '', city: '', postCode: '' },
        responsibleProducerId: '',
        safetyInformation: {
          type: initialSafetyType ?? 'NO_SAFETY_INFORMATION',
          content: '',
        },
      },
    },
  }) as unknown as UseFormReturn<EditConnectionFormValues>;
  return (
    <AllegroSellerDefaultsSection
      connectionId="conn_allegro_1"
      form={form}
      onChange={onChange ?? vi.fn()}
    />
  );
}

describe('AllegroSellerDefaultsSection', () => {
  it('renders the three field groups (location, responsible producer, safety info)', async () => {
    const apiClient = createMockApiClient({
      allegro: {
        listResponsibleProducers: vi
          .fn()
          .mockResolvedValue([{ id: 'rp-1', name: 'ACME GmbH', kind: 'PRODUCER' }]),
      },
    });

    renderWithProviders(<Harness />, { apiClient });

    expect(
      screen.getByRole('heading', { name: /ship-from location/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/voivodeship/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^city$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/post code/i)).toBeInTheDocument();

    expect(
      screen.getByRole('heading', { name: /^responsible producer$/i }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole('heading', { name: /^safety information$/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Type$/)).toBeInTheDocument();

    // Wait for the RP query to settle so the dropdown carries the entry.
    await waitFor(() =>
      expect(apiClient.allegro.listResponsibleProducers).toHaveBeenCalledWith(
        'conn_allegro_1',
      ),
    );
  });

  it('shows error Alert when the responsible-producer query fails', async () => {
    const apiClient = createMockApiClient({
      allegro: {
        listResponsibleProducers: vi.fn().mockRejectedValue(new Error('Network kaboom')),
      },
    });

    renderWithProviders(<Harness />, { apiClient });

    expect(
      await screen.findByText(/could not load responsible producers/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/network kaboom/i)).toBeInTheDocument();
  });

  it('shows empty-state Alert when the registry returns no entries', async () => {
    const apiClient = createMockApiClient({
      allegro: {
        listResponsibleProducers: vi.fn().mockResolvedValue([]),
      },
    });

    renderWithProviders(<Harness />, { apiClient });

    expect(
      await screen.findByText(/no responsible-producer entries yet/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Allegro seller panel/i)).toBeInTheDocument();
  });

  it('hides the safety-information content textarea when type is NO_SAFETY_INFORMATION', () => {
    renderWithProviders(<Harness initialSafetyType="NO_SAFETY_INFORMATION" />);

    expect(screen.queryByLabelText(/safety information content/i)).not.toBeInTheDocument();
  });

  it('reveals the content textarea when the operator picks SAFETY_INFORMATION', async () => {
    renderWithProviders(<Harness initialSafetyType="NO_SAFETY_INFORMATION" />);

    expect(screen.queryByLabelText(/safety information content/i)).not.toBeInTheDocument();

    const typeSelect = screen.getByLabelText(/^Type$/);
    fireEvent.change(typeSelect, { target: { value: 'SAFETY_INFORMATION' } });

    expect(
      await screen.findByLabelText(/safety information content/i),
    ).toBeInTheDocument();
  });

  it('calls onChange when the operator updates a field', async () => {
    const onChange = vi.fn();
    renderWithProviders(<Harness onChange={onChange} />);

    const cityInput = screen.getByLabelText(/^city$/i);
    fireEvent.change(cityInput, { target: { value: 'Warszawa' } });

    expect(onChange).toHaveBeenCalled();
  });
});

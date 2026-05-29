/**
 * AllegroExtraSection — component tests (#839)
 *
 * Covers the capability-conditional Allegro Delivery info subsection (AC-8):
 * present when the connection declares `ShippingProviderManager`, hidden
 * otherwise.
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useForm } from 'react-hook-form';
import type { ReactElement } from 'react';

import { renderWithProviders } from '../../../test/test-utils';
import { AllegroExtraSection } from './allegro-extra-section';
import type { Connection } from '../../../features/connections';
import type { ExtraConfigSectionProps } from '../../../shared/plugins';

afterEach(cleanup);

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-allegro-1',
    platformType: 'allegro',
    name: 'Allegro Main',
    status: 'active',
    config: {},
    credentialsBacked: true,
    enabledCapabilities: [],
    supportedCapabilities: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Minimal harness: react-hook-form requires a real `useForm` instance for
 * the `form` prop on `ExtraConfigSectionProps`. We render a wrapper that
 * mounts the form, then passes it through.
 */
function Harness({
  connection,
}: {
  connection: Connection;
}): ReactElement {
  // The EditConnectionFormValues shape is private to the connections
  // feature and shaped as a TS-only seam for the plugin contract. We
  // mount a minimal `useForm` and cast through `ExtraConfigSectionProps['form']`
  // so the test doesn't depend on the schema's internal field set —
  // AllegroExtraSection's gate logic doesn't read any form value.
  const form = useForm();
  return (
    <AllegroExtraSection
      connection={connection}
      form={form as unknown as ExtraConfigSectionProps['form']}
      configIsParseable
      syncSellerDefaultsToJson={vi.fn()}
    />
  );
}

describe('AllegroExtraSection — Allegro Delivery subsection (#839 AC-8)', () => {
  it('should render the Allegro Delivery info when the connection declares ShippingProviderManager', () => {
    const connection = makeConnection({
      supportedCapabilities: ['OrderSource', 'OfferManager', 'ShippingProviderManager'],
    });

    renderWithProviders(<Harness connection={connection} />);

    expect(screen.getByText('Allegro Delivery')).toBeInTheDocument();
    expect(screen.getByText(/No configuration needed/i)).toBeInTheDocument();
  });

  it('should hide the Allegro Delivery info when ShippingProviderManager is not declared', () => {
    const connection = makeConnection({
      supportedCapabilities: ['OrderSource', 'OfferManager'],
    });

    renderWithProviders(<Harness connection={connection} />);

    expect(screen.queryByText('Allegro Delivery')).not.toBeInTheDocument();
    expect(screen.queryByText(/No configuration needed/i)).not.toBeInTheDocument();
  });
});
